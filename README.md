# 화성오산 학교지도 보안 강화 버전

`goehsschoolmap.o-r.kr`용 최소공개 사이트입니다. 로그인·회원·관리자·메모·즐겨찾기 기능을 제거했고, 교육지원청 레코드와 교장·교감·행정실장 데이터는 배포 데이터에 포함하지 않습니다.

## 로컬 실행

1. Node.js 20 이상을 설치합니다.
2. `npm ci`를 실행합니다.
3. `.env.example`을 `.env`로 복사합니다.
4. `npm start`를 실행한 뒤 `http://127.0.0.1:3001`에 접속합니다.

기본 서버 진입점은 `server.js`이며, 공개 기능만 포함한 `runtime.js` 애플리케이션을 로컬 루프백 주소에서 실행합니다.

## 데이터 갱신

운영 서버는 Google Sheet에 접속하지 않고 `data/public-*.json` 스냅샷만 읽습니다. 신뢰할 수 있는 관리 PC에서 `.env.sync.example`을 `.env.sync`로 복사해 값을 설정한 후 `npm run sync-data`를 실행합니다. 생성 파일에 금지 필드가 없는지 `npm test`로 확인한 다음 배포합니다.

## 검증

- `npm run check`: JavaScript 문법 검사
- `npm test`: 개인정보 필드·교육지원청 제외 및 민감 경로 차단 검사
- `npm audit --omit=dev`: 운영 의존성 취약점 검사

운영 절차는 `DEPLOYMENT.md`, 보안 설계와 점검 항목은 `SECURITY.md`를 참고하세요.

Ubuntu 서버에서는 저장소 루트에서 `sudo ./goehsschoolmap.sh`를 실행합니다. sudo 실행 시 Git·npm·PM2를 root로 통일하고, Git 소유권 검사는 해당 프로젝트 경로에만 명령 단위로 허용합니다. `.git`이 없는 디렉터리는 그 자리에서 저장소로 초기화합니다. 이 스크립트는 GitHub `main` 최신 커밋 동기화, 의존성 설치, 검사, `server.js`의 PM2 실행만 담당하며 앱을 전용 포트 3001에 고정합니다. Nginx와 `goehsschoolmap.o-r.kr-isolated` 전용 Let's Encrypt 인증서는 `DEPLOYMENT.md`의 수동 절차로 기존 `goehsmap.o-r.kr`과 분리합니다. 셸 파일 자체를 PM2에 등록하지 않습니다.
