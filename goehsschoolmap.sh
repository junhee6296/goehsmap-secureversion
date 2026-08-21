#!/bin/bash
set -Eeuo pipefail

# hwao.sh와 같은 단순 배포 방식입니다.
# 이 파일은 사람이 직접 실행하고, PM2에는 이 셸이 아니라 server.js만 등록합니다.

PROJECT_DIR="${PROJECT_DIR:-/home/ubuntu/hawo/hms}"
APP_NAME="goehsschoolmap"
APP_PORT="3001"
BRANCH="main"
REPO_URL="https://github.com/junhee6296/goehsmap-secureversion.git"

if [ "$(id -u)" -eq 0 ]; then
    echo "오류: sudo로 실행하지 마세요. ubuntu 사용자로 ./goehsschoolmap.sh를 실행하세요."
    exit 1
fi

cd "$PROJECT_DIR" || {
    echo "경로 오류: $PROJECT_DIR 폴더를 찾을 수 없습니다."
    echo "다른 경로라면 PROJECT_DIR=/실제/경로 ./goehsschoolmap.sh 로 실행하세요."
    exit 1
}

for command_name in git node npm pm2 curl ss; do
    if ! command -v "$command_name" >/dev/null 2>&1; then
        echo "오류: $command_name 명령을 찾을 수 없습니다."
        exit 1
    fi
done

echo ">>> [$APP_NAME] GitHub main 브랜치 최신 코드로 동기화 중..."
if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "오류: $PROJECT_DIR 경로가 Git 저장소가 아닙니다."
    exit 1
fi
git remote set-url origin "$REPO_URL"
git fetch --prune origin "$BRANCH"
git reset --hard "origin/$BRANCH"

echo ">>> [$APP_NAME] 운영 환경을 ${APP_PORT} 포트로 고정 중..."
printf 'NODE_ENV=production\nPORT=%s\nTRUST_PROXY=1\n' "$APP_PORT" > .env
chmod 600 .env

echo ">>> [$APP_NAME] npm 패키지 설치 및 코드 검사 중..."
npm ci --omit=dev --ignore-scripts --no-fund --no-audit
npm run check
npm test

echo ">>> [$APP_NAME] 기존 PM2 항목 정리 중..."
pm2 delete "$APP_NAME" >/dev/null 2>&1 || true

if ss -H -ltn "sport = :$APP_PORT" | grep -q .; then
    echo "오류: $APP_PORT 포트를 다른 프로세스가 사용 중이므로 시작하지 않았습니다."
    echo "확인 명령: sudo ss -ltnp 'sport = :$APP_PORT'"
    echo "root PM2 확인: sudo env PM2_HOME=/root/.pm2 pm2 list"
    exit 1
fi

echo ">>> [$APP_NAME] server.js를 PM2로 실행 중..."
PORT="$APP_PORT" NODE_ENV=production TRUST_PROXY=1 \
    pm2 start server.js \
    --name "$APP_NAME" \
    --cwd "$PROJECT_DIR" \
    --time \
    --restart-delay 5000 \
    --max-memory-restart 300M \
    --update-env

pm2 save --force

echo ">>> [$APP_NAME] 로컬 응답 확인 중..."
health_ok=0
for _ in {1..15}; do
    if curl --fail --silent --show-error "http://127.0.0.1:${APP_PORT}/healthz" >/dev/null; then
        health_ok=1
        break
    fi
    sleep 1
done

if [ "$health_ok" -ne 1 ]; then
    echo "오류: /healthz 확인에 실패했습니다."
    pm2 logs "$APP_NAME" --lines 50 --nostream
    exit 1
fi

login_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
    "http://127.0.0.1:${APP_PORT}/login")"
if [ "$login_status" != "404" ]; then
    echo "오류: 로그인 차단 확인값이 404가 아니라 ${login_status}입니다."
    exit 1
fi

echo ">>> [$APP_NAME] 배포 완료: 127.0.0.1:${APP_PORT}, /login=404 ✅"
echo ">>> PM2에는 server.js만 등록되었습니다. 이 셸 파일을 pm2 start 하지 마세요."
