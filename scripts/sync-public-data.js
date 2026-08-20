'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const app = require('../app');

async function main() {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    try {
        const [mapResponse, shareResponse] = await Promise.all([
            fetch(`${baseUrl}/api/map-data`),
            fetch(`${baseUrl}/api/share-data`)
        ]);
        if (!mapResponse.ok || !shareResponse.ok) throw new Error('원본 공개 데이터를 불러오지 못했습니다.');
        const generatedAt = new Date().toISOString();
        const mapData = { generatedAt, ...await mapResponse.json() };
        const shareData = { generatedAt, ...await shareResponse.json() };
        const dataDir = path.join(__dirname, '..', 'data');
        await fs.writeFile(path.join(dataDir, 'public-map-data.json'), `${JSON.stringify(mapData)}\n`, { encoding: 'utf8', mode: 0o640 });
        await fs.writeFile(path.join(dataDir, 'public-share-data.json'), `${JSON.stringify(shareData)}\n`, { encoding: 'utf8', mode: 0o640 });
        console.log(`공개 데이터 생성 완료: 학교 ${mapData.schools.length}개, 공유학교 ${shareData.programs.length}개`);
    } finally {
        await new Promise(resolve => server.close(resolve));
    }
}

main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
});
