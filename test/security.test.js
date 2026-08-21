'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

process.env.MAP_SHEET_ID = 'test-sheet';
process.env.TRUST_PROXY = '0';

function gviz(table) {
    return `google.visualization.Query.setResponse(${JSON.stringify({ status: 'ok', table })});`;
}

const generalTable = {
    cols: [
        { label: 'num' }, { label: 'x' }, { label: 'y' }, { label: 'type' }, { label: 'name' },
        { label: 'adrs' }, { label: 'stdnt_cnt' }, { label: 'tchr_cnt' }, { label: 'class_cnt' },
        { label: 'SDC' }, { label: 'shape' }, { label: 'color' }, { label: 'region' },
        { label: 'hp_adress' }, { label: '' }, { label: 'establish' }, { label: 'principal' },
        { label: 'vice principal' }, { label: 'chief of administration' }, { label: 'special_bs' }
    ],
    rows: [
        { c: [{ v: 0 }, { v: 37.18 }, { v: 127.06 }, { v: '교육지원청' }, { v: '화성오산교육지원청' }, { v: '주소' }, null, null, null, null, null, { v: '#370BC7' }, null, { v: 'https://example.com' }, null, { v: '교육지원청' }, { v: '비공개교육장' }, null, null, null] },
        { c: [{ v: 1 }, { v: 37.19 }, { v: 127.10 }, { v: '초등학교' }, { v: '테스트초등학교' }, { v: '경기도 화성시 테스트로 1' }, { v: 100 }, { v: 10 }, { v: 6 }, { v: 1 }, null, { v: '#123456' }, null, { v: 'https://school.example' }, null, { v: '공립' }, { v: '비공개교장' }, { v: '비공개교감' }, { v: '비공개행정실장' }, { v: '#N/A, 독서교육' }] }
    ]
};

const legendTable = {
    cols: [{ label: '' }, { label: 'type' }, { label: 'shape' }, { label: 'color' }],
    rows: [{ c: [null, { v: '초등학교' }, { v: '▲' }, { v: '#123456' }] }]
};

const helpTable = {
    cols: [],
    rows: [{ c: [{ v: '학교 지도' }, { v: '2026-08-20' }, { v: '도움말' }, { v: '안내' }, { v: '공개 안내문' }, { v: '대표 연락처' }] }]
};

const sharedTable = {
    cols: [{ label: 'x' }, { label: 'y' }, { label: 'type' }, { label: 'name' }, { label: 'adrs' }, { label: 'duration' }, { label: 'target' }, { label: 'place' }, { label: 'activity' }],
    rows: [{ c: [{ v: 37.2 }, { v: 127.1 }, { v: '공유학교' }, { v: '테스트 공유학교' }, { v: '경기도 화성시' }, { v: '2026년' }, { v: '초등학생' }, { v: '테스트실' }, { v: '창의 활동' }] }]
};

const originalFetch = global.fetch;
global.fetch = async (url) => {
    const gid = new URL(String(url)).searchParams.get('gid');
    const table = gid === '1290947643' ? generalTable
        : gid === '882261582' ? legendTable
            : gid === '1120810254' ? helpTable
                : sharedTable;
    const body = gviz(table);
    return new Response(body, { status: 200, headers: { 'content-type': 'application/javascript' } });
};

const app = require('../app');

test('공개 API는 인사정보와 교육지원청을 반환하지 않고 민감 경로를 차단한다', async (t) => {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    t.after(() => {
        global.fetch = originalFetch;
        server.close();
    });

    const base = `http://127.0.0.1:${server.address().port}`;
    const response = await originalFetch(`${base}/api/map-data`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy') || '', /default-src 'self'/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'DENY');

    const body = await response.text();
    assert.doesNotMatch(body, /비공개교장|비공개교감|비공개행정실장|비공개교육장/);
    assert.doesNotMatch(body, /principal|vice principal|chief of administration/i);
    const data = JSON.parse(body);
    assert.equal(data.schools.length, 1);
    assert.equal(data.schools[0].name, '테스트초등학교');
    assert.equal(data.schools[0].specialBusiness, '독서교육');
    assert.equal(Object.hasOwn(data.schools[0], 'principal'), false);

    for (const pathname of ['/login', '/admin', '/server.js', '/ecosystem.config.js', '/deploy/pm2-sync.sh', '/.env', '/package.json']) {
        const blocked = await originalFetch(`${base}${pathname}`);
        assert.equal(blocked.status, 404, pathname);
    }
});
