#!/bin/bash
set -e

# 1. 프로젝트 폴더 설정
PROJECT_DIR="/home/ubuntu/hawo/hwao-lunch"

cd "$PROJECT_DIR" || {
    echo "경로 오류: $PROJECT_DIR 폴더를 찾을 수 없습니다."
    exit 1
}

# 2. Github 최신 코드로 강제 동기화
echo ">>> [hwao-lunch] 최신 코드 강제 동기화 중..."
git fetch origin main
git reset --hard origin/main

# 3. 패키지 설치 및 업데이트
echo ">>> [hwao-lunch] npm 패키지 확인 및 설치 중..."
npm install

# 4. PM2 프로세스 관리
if pm2 describe hwao-lunch > /dev/null 2>&1; then
    echo ">>> [hwao-lunch] 서버 재시작 중..."
    pm2 restart hwao-lunch
else
    echo ">>> [hwao-lunch] 서버 최초 실행 중..."
    pm2 start server.js --name "hwao-lunch"
fi

# 5. PM2 상태 저장
pm2 save

echo ">>> [hwao-lunch] 점심 식사 시스템 업데이트가 완료되었습니다! ✅"
