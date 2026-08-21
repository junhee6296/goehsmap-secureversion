'use strict';

require('dotenv').config({ quiet: true });

const fs = require('node:fs/promises');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const { rateLimit } = require('express-rate-limit');

const app = express();
const ROOT_DIR = __dirname;
const PORT = Number.parseInt(process.env.PORT || '3001', 10);
const MAX_DATA_BYTES = 5 * 1024 * 1024;
const MAP_DATA_FILE = path.join(ROOT_DIR, 'data', 'public-map-data.json');
const SHARE_DATA_FILE = path.join(ROOT_DIR, 'data', 'public-share-data.json');
const fileCache = new Map();

app.disable('x-powered-by');
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            baseUri: ["'self'"],
            connectSrc: ["'self'"],
            fontSrc: ["'self'", 'data:'],
            formAction: ["'self'"],
            frameAncestors: ["'none'"],
            imgSrc: ["'self'", 'data:', 'blob:', 'https://*.tile.openstreetmap.org'],
            objectSrc: ["'none'"],
            scriptSrc: ["'self'"],
            scriptSrcAttr: ["'none'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            upgradeInsecureRequests: null
        }
    },
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    xFrameOptions: { action: 'deny' }
}));
app.use((req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    res.setHeader('X-Robots-Tag', 'noarchive');
    next();
});
app.use(compression());
app.use('/api', rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: '요청이 많습니다. 잠시 후 다시 시도해 주세요.' }
}));

function cleanText(value, maxLength = 300) {
    return String(value ?? '')
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
        .trim()
        .slice(0, maxLength);
}

function cleanSchoolTags(value) {
    return cleanText(value, 700)
        .split(/[,，\n]+/)
        .map(item => item.trim())
        .filter(item => item && item.replace(/\s+/g, '').toUpperCase() !== '#N/A')
        .join(', ');
}

function cleanCount(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(1000000, Math.round(number))) : 0;
}

function cleanCoordinate(value, min, max) {
    const number = Number(value);
    return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function cleanColor(value, fallback = '#333333') {
    const color = cleanText(value, 16);
    return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function cleanUrl(value) {
    const raw = cleanText(value, 500);
    if (!raw) return '';
    try {
        const parsed = new URL(raw);
        return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
    } catch (error) {
        return '';
    }
}

function isEducationOffice(type, name) {
    return cleanText(type, 100).replace(/\s+/g, '').includes('교육지원청') ||
        cleanText(name, 200).replace(/\s+/g, '').includes('교육지원청');
}

function sanitizeSchool(record) {
    const type = cleanText(record?.type, 80);
    const name = cleanText(record?.name, 160);
    const lat = cleanCoordinate(record?.lat, 36.5, 38.0);
    const lng = cleanCoordinate(record?.lng, 126.0, 128.0);
    if (!type || !name || lat === null || lng === null || isEducationOffice(type, name)) return null;
    return {
        lat,
        lng,
        type,
        name,
        address: cleanText(record.address, 300),
        establish: cleanText(record.establish, 30),
        studentCount: cleanCount(record.studentCount),
        teacherCount: cleanCount(record.teacherCount),
        classCount: cleanCount(record.classCount),
        specialClassCount: cleanCount(record.specialClassCount),
        color: cleanColor(record.color),
        url: cleanUrl(record.url),
        specialBusiness: cleanSchoolTags(record.specialBusiness)
    };
}

function sanitizeHelp(help) {
    if (!help || typeof help !== 'object') return null;
    return {
        headerText: cleanText(help.headerText, 160),
        updateDate: cleanText(help.updateDate, 80),
        title: cleanText(help.title, 160),
        subtitle: cleanText(help.subtitle, 100),
        content: cleanText(help.content, 4000),
        contact: cleanText(help.contact, 200)
    };
}

function sanitizeMapData(data) {
    return {
        generatedAt: cleanText(data?.generatedAt, 80),
        schools: Array.isArray(data?.schools) ? data.schools.map(sanitizeSchool).filter(Boolean) : [],
        legend: Array.isArray(data?.legend) ? data.legend.flatMap(item => {
            const type = cleanText(item?.type, 80);
            if (!type || type.includes('교육지원청')) return [];
            return [{ type, symbol: cleanText(item.symbol, 8) || '●', color: cleanColor(item.color) }];
        }) : [],
        help: sanitizeHelp(data?.help)
    };
}

function sanitizeShareData(data) {
    return {
        generatedAt: cleanText(data?.generatedAt, 80),
        programs: Array.isArray(data?.programs) ? data.programs.flatMap(record => {
            const lat = cleanCoordinate(record?.lat, 36.5, 38.0);
            const lng = cleanCoordinate(record?.lng, 126.0, 128.0);
            const name = cleanText(record?.name, 200);
            if (!name || lat === null || lng === null) return [];
            return [{
                lat,
                lng,
                type: cleanText(record.type, 80) || '공유학교',
                name,
                address: cleanText(record.address, 300),
                duration: cleanText(record.duration, 200),
                target: cleanText(record.target, 200),
                place: cleanText(record.place, 300),
                activity: cleanText(record.activity, 1000)
            }];
        }) : [],
        help: sanitizeHelp(data?.help)
    };
}

async function readPublicData(fileName, sanitizer) {
    const stat = await fs.stat(fileName);
    if (stat.size > MAX_DATA_BYTES) throw new Error('Public data file is too large');
    const cached = fileCache.get(fileName);
    if (cached?.mtimeMs === stat.mtimeMs) return cached.value;
    const parsed = JSON.parse(await fs.readFile(fileName, 'utf8'));
    const value = sanitizer(parsed);
    fileCache.set(fileName, { mtimeMs: stat.mtimeMs, value });
    return value;
}

function sendRootFile(res, fileName) {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(ROOT_DIR, fileName), { dotfiles: 'deny' });
}

app.get(['/', '/index.html'], (req, res) => sendRootFile(res, 'index.html'));
app.get('/share', (req, res) => sendRootFile(res, 'share.html'));
app.get('/share.html', (req, res) => res.redirect(301, '/share'));
app.get('/SECURITY', (req, res) => res.type('text/markdown').sendFile(path.join(ROOT_DIR, 'SECURITY.md'), { dotfiles: 'deny' }));

const staticOptions = { dotfiles: 'deny', etag: true, immutable: true, maxAge: '7d', fallthrough: false };
const PUBLIC_CSS = new Set(['base.css', 'dashboard.css', 'header.css', 'legend.css', 'marker.css', 'popup.css', 'share.css', 'tooltip.css', 'ui.css']);
const PUBLIC_JS = new Set(['config.js', 'main.js', 'map.js', 'notice.js', 'search.js', 'share_main.js', 'utils.js']);
app.get('/css/:file', (req, res) => {
    if (!PUBLIC_CSS.has(req.params.file)) return res.status(404).type('text/plain').send('요청한 파일을 찾을 수 없습니다.');
    res.sendFile(path.join(ROOT_DIR, 'css', req.params.file), staticOptions);
});
app.get('/js/:file', (req, res) => {
    if (!PUBLIC_JS.has(req.params.file)) return res.status(404).type('text/plain').send('요청한 파일을 찾을 수 없습니다.');
    res.sendFile(path.join(ROOT_DIR, 'js', req.params.file), staticOptions);
});
app.use('/source', express.static(path.join(ROOT_DIR, 'source'), staticOptions));
app.use('/vendor/leaflet', express.static(path.join(ROOT_DIR, 'node_modules', 'leaflet', 'dist'), staticOptions));
app.use('/vendor/markercluster', express.static(path.join(ROOT_DIR, 'node_modules', 'leaflet.markercluster', 'dist'), staticOptions));

app.get('/data/hwao.geojson', (req, res) => res.sendFile(path.join(ROOT_DIR, 'data', 'hwao.geojson'), { dotfiles: 'deny' }));
app.get('/data/hwao_boundary.geojson', (req, res) => res.sendFile(path.join(ROOT_DIR, 'data', 'hwao_boundary.geojson'), { dotfiles: 'deny' }));
app.get('/robots.txt', (req, res) => res.sendFile(path.join(ROOT_DIR, 'robots.txt'), { dotfiles: 'deny' }));
app.get('/sitemap.xml', (req, res) => res.sendFile(path.join(ROOT_DIR, 'sitemap.xml'), { dotfiles: 'deny' }));
app.get('/.well-known/security.txt', (req, res) => res.sendFile(path.join(ROOT_DIR, '.well-known', 'security.txt'), { dotfiles: 'allow' }));

app.get('/api/map-data', async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
        res.json(await readPublicData(MAP_DATA_FILE, sanitizeMapData));
    } catch (error) {
        console.error('Public map data read failed:', error.message);
        res.status(503).json({ error: '지도 데이터를 불러올 수 없습니다.' });
    }
});

app.get('/api/share-data', async (req, res) => {
    try {
        res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
        res.json(await readPublicData(SHARE_DATA_FILE, sanitizeShareData));
    } catch (error) {
        console.error('Public shared-school data read failed:', error.message);
        res.status(503).json({ error: '공유학교 데이터를 불러올 수 없습니다.' });
    }
});

app.get('/api/colors', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.json({
        general: { dongtanFill: '#e9c40e', byeongjeomFill: '#473198', hyohoengFill: '#3299e7', manseFill: '#a9d1ec', hwaseongBorder: '#0047AB', osanFill: '#FF6392', osanBorder: '#e7733d' },
        shared: { hwaseongFill: '#4A90E2', hwaseongBorder: '#0047AB', osanFill: '#FF6392', osanBorder: '#e7733d' }
    });
});

app.get('/api/latest-commit', (req, res) => {
    const configured = cleanText(process.env.BUILD_TIMESTAMP, 80);
    const iso = configured && !Number.isNaN(Date.parse(configured)) ? new Date(configured).toISOString() : null;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: Boolean(iso), iso });
});

app.get('/healthz', (req, res) => res.set('Cache-Control', 'no-store').json({ status: 'ok' }));
app.use((req, res) => res.status(404).type('text/plain').send('요청한 페이지를 찾을 수 없습니다.'));
app.use((error, req, res, next) => {
    if (error?.status === 404) return res.status(404).type('text/plain').send('요청한 파일을 찾을 수 없습니다.');
    console.error('Unhandled request error:', error.message);
    if (res.headersSent) return next(error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

if (require.main === module) {
    app.listen(PORT, '127.0.0.1', () => console.log(`Secure school map is listening on http://127.0.0.1:${PORT}`));
}

module.exports = app;
