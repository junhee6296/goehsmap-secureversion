'use strict';

require('dotenv').config({ path: process.env.SYNC_ENV_FILE || '.env.sync', quiet: true });

const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const { rateLimit } = require('express-rate-limit');

const app = express();
const ROOT_DIR = __dirname;
const PORT = Number.parseInt(process.env.PORT || '3001', 10);
const MAP_SHEET_ID = String(process.env.MAP_SHEET_ID || '').trim();
const SHEET_GIDS = Object.freeze({
    general: String(process.env.MAP_GENERAL_GID || '1290947643'),
    legend: String(process.env.MAP_LEGEND_GID || '882261582'),
    help: String(process.env.MAP_HELP_GID || '1120810254'),
    shared: String(process.env.MAP_SHARED_GID || '1582242290')
});
const GOOGLE_SHEETS_ORIGIN = 'https://docs.google.com';
const CACHE_TTL_MS = 5 * 60 * 1000;
const STALE_TTL_MS = 60 * 60 * 1000;
const MAX_SHEET_BYTES = 5 * 1024 * 1024;
const responseCache = new Map();
const inflightRequests = new Map();

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

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 120,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: '요청이 많습니다. 잠시 후 다시 시도해 주세요.' }
});
app.use('/api', apiLimiter);

function setHtmlCacheHeaders(res) {
    res.setHeader('Cache-Control', 'no-store');
}

function sendRootFile(res, fileName) {
    setHtmlCacheHeaders(res);
    res.sendFile(path.join(ROOT_DIR, fileName), { dotfiles: 'deny' });
}

app.get(['/', '/index.html'], (req, res) => sendRootFile(res, 'index.html'));
app.get('/share', (req, res) => sendRootFile(res, 'share.html'));
app.get('/share.html', (req, res) => res.redirect(301, '/share'));

const staticOptions = {
    dotfiles: 'deny',
    etag: true,
    immutable: true,
    maxAge: '7d',
    fallthrough: false
};
app.use('/css', express.static(path.join(ROOT_DIR, 'css'), staticOptions));
app.use('/js', express.static(path.join(ROOT_DIR, 'js'), staticOptions));
app.use('/source', express.static(path.join(ROOT_DIR, 'source'), staticOptions));
app.use('/vendor/leaflet', express.static(path.join(ROOT_DIR, 'node_modules', 'leaflet', 'dist'), staticOptions));
app.use('/vendor/markercluster', express.static(path.join(ROOT_DIR, 'node_modules', 'leaflet.markercluster', 'dist'), staticOptions));

app.get('/data/hwao.geojson', (req, res) => res.sendFile(path.join(ROOT_DIR, 'data', 'hwao.geojson'), { dotfiles: 'deny' }));
app.get('/data/hwao_boundary.geojson', (req, res) => res.sendFile(path.join(ROOT_DIR, 'data', 'hwao_boundary.geojson'), { dotfiles: 'deny' }));
app.get('/robots.txt', (req, res) => res.sendFile(path.join(ROOT_DIR, 'robots.txt'), { dotfiles: 'deny' }));
app.get('/sitemap.xml', (req, res) => res.sendFile(path.join(ROOT_DIR, 'sitemap.xml'), { dotfiles: 'deny' }));
app.get('/.well-known/security.txt', (req, res) => res.sendFile(path.join(ROOT_DIR, '.well-known', 'security.txt'), { dotfiles: 'allow' }));

function cellValue(cell) {
    if (cell?.v !== undefined && cell?.v !== null) return cell.v;
    return cell?.f ?? '';
}

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
    const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(1000000, Math.round(parsed)));
}

function cleanCoordinate(value, min, max) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : null;
}

function cleanColor(value, fallback = '#333333') {
    const color = cleanText(value, 16);
    return /^#[0-9a-f]{6}$/i.test(color) ? color : fallback;
}

function cleanPublicUrl(value) {
    const raw = cleanText(value, 500);
    if (!raw) return '';
    try {
        const normalized = raw.startsWith('www.') ? `https://${raw}` : raw;
        const parsed = new URL(normalized);
        return ['http:', 'https:'].includes(parsed.protocol) ? parsed.href : '';
    } catch (error) {
        return '';
    }
}

function findColumn(table, labels, fallbackIndex) {
    const normalizedLabels = labels.map(label => String(label).toLowerCase());
    const index = (table.cols || []).findIndex(column => normalizedLabels.includes(cleanText(column?.label, 100).toLowerCase()));
    return index >= 0 ? index : fallbackIndex;
}

function getCell(row, index) {
    return index === null || index === undefined ? '' : cellValue(row?.c?.[index]);
}

function isEducationOffice(type, name) {
    const normalizedType = cleanText(type, 100).replace(/\s+/g, '');
    const normalizedName = cleanText(name, 200).replace(/\s+/g, '');
    return normalizedType.includes('교육지원청') || normalizedName.includes('교육지원청');
}

function parseGviz(text) {
    if (typeof text !== 'string' || text.length > MAX_SHEET_BYTES) throw new Error('Invalid sheet response size');
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('Invalid sheet response');
    const parsed = JSON.parse(text.slice(start, end + 1));
    if (parsed?.status !== 'ok' || !parsed?.table || !Array.isArray(parsed.table.rows)) {
        throw new Error('Sheet query failed');
    }
    return parsed.table;
}

async function fetchSheet(gid) {
    if (!MAP_SHEET_ID) throw new Error('MAP_SHEET_ID is not configured');
    if (!Object.values(SHEET_GIDS).includes(String(gid))) throw new Error('Sheet is not allowlisted');

    const url = new URL(`/spreadsheets/d/${encodeURIComponent(MAP_SHEET_ID)}/gviz/tq`, GOOGLE_SHEETS_ORIGIN);
    url.searchParams.set('tqx', 'out:json');
    url.searchParams.set('gid', String(gid));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            redirect: 'error',
            headers: { 'User-Agent': 'goehsschoolmap-public-data-proxy/1.0' }
        });
        if (!response.ok) throw new Error(`Sheet request failed (${response.status})`);
        const declaredLength = Number(response.headers.get('content-length') || 0);
        if (declaredLength > MAX_SHEET_BYTES) throw new Error('Sheet response too large');
        return parseGviz(await response.text());
    } finally {
        clearTimeout(timer);
    }
}

function sanitizeSchools(table) {
    const columns = {
        lat: findColumn(table, ['x'], 1),
        lng: findColumn(table, ['y'], 2),
        type: findColumn(table, ['type'], 3),
        name: findColumn(table, ['name'], 4),
        address: findColumn(table, ['adrs', 'address'], 5),
        students: findColumn(table, ['stdnt_cnt'], 6),
        teachers: findColumn(table, ['tchr_cnt'], 7),
        classes: findColumn(table, ['class_cnt'], 8),
        specialClasses: findColumn(table, ['sdc'], 9),
        color: findColumn(table, ['color'], 11),
        url: findColumn(table, ['hp_adress', 'homepage'], 13),
        establish: findColumn(table, ['establish'], 15),
        specialBusiness: findColumn(table, ['special_bs'], 19)
    };

    return table.rows.flatMap(row => {
        const type = cleanText(getCell(row, columns.type), 80);
        const name = cleanText(getCell(row, columns.name), 160);
        const lat = cleanCoordinate(getCell(row, columns.lat), 36.5, 38.0);
        const lng = cleanCoordinate(getCell(row, columns.lng), 126.0, 128.0);
        if (!type || !name || lat === null || lng === null || isEducationOffice(type, name)) return [];

        const classCount = cleanCount(getCell(row, columns.classes));
        return [{
            lat,
            lng,
            type,
            name,
            address: cleanText(getCell(row, columns.address), 300),
            establish: cleanText(getCell(row, columns.establish), 30),
            studentCount: cleanCount(getCell(row, columns.students)),
            teacherCount: cleanCount(getCell(row, columns.teachers)),
            classCount,
            specialClassCount: type.includes('특수') ? classCount : cleanCount(getCell(row, columns.specialClasses)),
            color: cleanColor(getCell(row, columns.color)),
            url: cleanPublicUrl(getCell(row, columns.url)),
            specialBusiness: cleanSchoolTags(getCell(row, columns.specialBusiness))
        }];
    });
}

function sanitizeLegend(table) {
    return table.rows.flatMap(row => {
        const type = cleanText(getCell(row, 1), 80);
        if (!type || type === '공유학교' || type.includes('교육지원청')) return [];
        return [{
            type,
            symbol: cleanText(getCell(row, 2), 8) || '●',
            color: cleanColor(getCell(row, 3))
        }];
    });
}

function sanitizeHelp(table) {
    const row = table.rows.find(item => cleanText(getCell(item, 0), 100) !== 'header_text') || table.rows[0];
    if (!row) return null;
    return {
        headerText: cleanText(getCell(row, 0), 160) || '경기도화성오산교육지원청 학교 지도',
        updateDate: cleanText(getCell(row, 1), 80) || '-',
        title: cleanText(getCell(row, 2), 160) || '사용 방법 안내',
        subtitle: cleanText(getCell(row, 3), 100) || '도움말',
        content: cleanText(getCell(row, 4), 4000) || '내용 없음',
        contact: cleanText(getCell(row, 5), 200) || '-'
    };
}

function sanitizeSharedPrograms(table) {
    const columns = {
        lat: findColumn(table, ['x'], 0),
        lng: findColumn(table, ['y'], 1),
        type: findColumn(table, ['type'], 2),
        name: findColumn(table, ['name'], 3),
        address: findColumn(table, ['adrs', 'address'], 4),
        duration: findColumn(table, ['duration'], 5),
        target: findColumn(table, ['target'], 6),
        place: findColumn(table, ['place'], 7),
        activity: findColumn(table, ['activity'], 8)
    };

    return table.rows.flatMap(row => {
        const lat = cleanCoordinate(getCell(row, columns.lat), 36.5, 38.0);
        const lng = cleanCoordinate(getCell(row, columns.lng), 126.0, 128.0);
        const name = cleanText(getCell(row, columns.name), 200);
        if (!name || lat === null || lng === null) return [];
        return [{
            lat,
            lng,
            type: cleanText(getCell(row, columns.type), 80) || '공유학교',
            name,
            address: cleanText(getCell(row, columns.address), 300),
            duration: cleanText(getCell(row, columns.duration), 200),
            target: cleanText(getCell(row, columns.target), 200),
            place: cleanText(getCell(row, columns.place), 300),
            activity: cleanText(getCell(row, columns.activity), 1000)
        }];
    });
}

async function cached(key, loader) {
    const now = Date.now();
    const current = responseCache.get(key);
    if (current && now - current.loadedAt < CACHE_TTL_MS) return current.value;
    if (inflightRequests.has(key)) return inflightRequests.get(key);

    const request = loader()
        .then(value => {
            responseCache.set(key, { value, loadedAt: Date.now() });
            return value;
        })
        .catch(error => {
            if (current && now - current.loadedAt < STALE_TTL_MS) return current.value;
            throw error;
        })
        .finally(() => inflightRequests.delete(key));

    inflightRequests.set(key, request);
    return request;
}

app.get('/api/map-data', async (req, res) => {
    try {
        const data = await cached('map-data', async () => {
            const [schoolsTable, legendTable, helpTable] = await Promise.all([
                fetchSheet(SHEET_GIDS.general),
                fetchSheet(SHEET_GIDS.legend),
                fetchSheet(SHEET_GIDS.help)
            ]);
            return {
                schools: sanitizeSchools(schoolsTable),
                legend: sanitizeLegend(legendTable),
                help: sanitizeHelp(helpTable)
            };
        });
        res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
        res.json(data);
    } catch (error) {
        console.error('Public map data refresh failed:', error.message);
        res.status(503).json({ error: '지도 데이터를 불러올 수 없습니다.' });
    }
});

app.get('/api/share-data', async (req, res) => {
    try {
        const data = await cached('share-data', async () => {
            const [programTable, helpTable] = await Promise.all([
                fetchSheet(SHEET_GIDS.shared),
                fetchSheet(SHEET_GIDS.help)
            ]);
            return {
                programs: sanitizeSharedPrograms(programTable),
                help: sanitizeHelp(helpTable)
            };
        });
        res.setHeader('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
        res.json(data);
    } catch (error) {
        console.error('Public shared-school data refresh failed:', error.message);
        res.status(503).json({ error: '공유학교 데이터를 불러올 수 없습니다.' });
    }
});

app.get('/api/colors', (req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.json({
        general: {
            dongtanFill: '#e9c40e',
            byeongjeomFill: '#473198',
            hyohoengFill: '#3299e7',
            manseFill: '#a9d1ec',
            hwaseongBorder: '#0047AB',
            osanFill: '#FF6392',
            osanBorder: '#e7733d'
        },
        shared: {
            hwaseongFill: '#4A90E2',
            hwaseongBorder: '#0047AB',
            osanFill: '#FF6392',
            osanBorder: '#e7733d'
        }
    });
});

app.get('/api/latest-commit', (req, res) => {
    const configured = String(process.env.BUILD_TIMESTAMP || '').trim();
    const iso = configured && !Number.isNaN(Date.parse(configured)) ? new Date(configured).toISOString() : null;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ success: Boolean(iso), iso });
});

app.get('/healthz', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ status: 'ok' });
});

app.use((req, res) => {
    res.status(404).type('text/plain').send('요청한 페이지를 찾을 수 없습니다.');
});

app.use((error, req, res, next) => {
    if (error?.status === 404) return res.status(404).type('text/plain').send('요청한 파일을 찾을 수 없습니다.');
    console.error('Unhandled request error:', error.message);
    if (res.headersSent) return next(error);
    res.status(500).json({ error: '서버 오류가 발생했습니다.' });
});

if (require.main === module) {
    app.listen(PORT, '127.0.0.1', () => {
        console.log(`Secure school map is listening on http://127.0.0.1:${PORT}`);
    });
}

module.exports = app;
