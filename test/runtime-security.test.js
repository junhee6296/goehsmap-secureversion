'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const app = require('../runtime');

const SCHOOL_FIELDS = [
    'lat', 'lng', 'type', 'name', 'address', 'establish', 'studentCount', 'teacherCount',
    'classCount', 'specialClassCount', 'color', 'url', 'specialBusiness'
].sort();

test('배포 API는 허용 필드만 반환하고 민감 경로를 차단한다', async (t) => {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => server.close());

    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await fetch(`${base}/api/map-data`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy') || '', /default-src 'self'/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');

    const body = await response.text();
    assert.doesNotMatch(body, /"principal"|"vice_principal"|"chief_of_administration"/i);
    const data = JSON.parse(body);
    assert.ok(data.schools.length > 0);
    assert.deepEqual(Object.keys(data.schools[0]).sort(), SCHOOL_FIELDS);
    assert.equal(data.schools.some(item => String(item.type).includes('교육지원청') || String(item.name).includes('교육지원청')), false);

    for (const pathname of ['/login', '/admin', '/server.js', '/app.js', '/runtime.js', '/.env', '/package.json', '/school-age', '/js/school-age.js', '/data/public-map-data.json']) {
        const blocked = await fetch(`${base}${pathname}`);
        assert.equal(blocked.status, 404, pathname);
    }
});
