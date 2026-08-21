#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

readonly CONFIG_FILE="/etc/goehsschoolmap-sync.conf"

log() {
    printf '[goehsschoolmap-recover] %s\n' "$*"
}

fail() {
    printf '[goehsschoolmap-recover] 오류: %s\n' "$*" >&2
    exit 1
}

[[ "$EUID" -eq 0 ]] || fail "sudo로 실행하세요."

if [[ -r "$CONFIG_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$CONFIG_FILE"
fi
DEPLOY_USER="${DEPLOY_USER:-goehsschoolmap}"
DEPLOY_HOME="${DEPLOY_HOME:-/var/lib/goehsschoolmap}"
PM2_HOME="${PM2_HOME:-$DEPLOY_HOME/.pm2}"
SERVICE_NAME="${SERVICE_NAME:-goehsschoolmap}"
PM2_SERVICE_NAME="${SERVICE_NAME}-pm2"
APP_PORT="${APP_PORT:-3001}"
if [[ -z "${INSTALL_DIR:-}" ]]; then
    INSTALL_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
fi
readonly SERVICE_NAME PM2_SERVICE_NAME APP_PORT INSTALL_DIR
[[ "$APP_PORT" =~ ^[0-9]+$ ]] && ((APP_PORT >= 1024 && APP_PORT <= 65535)) \
    || fail "앱 포트가 올바르지 않습니다: $APP_PORT"
((APP_PORT != 3000)) || fail "기존 goehsmap 서비스 포트 3000은 사용할 수 없습니다."
[[ -f "$INSTALL_DIR/ecosystem.config.js" ]] || fail "ecosystem.config.js가 없습니다: $INSTALL_DIR"
if [[ -z "${PM2_BIN:-}" || ! -x "$PM2_BIN" ]]; then
    PM2_BIN="$(command -v pm2 || true)"
fi
[[ -x "$PM2_BIN" ]] || fail "PM2 실행 파일을 찾을 수 없습니다. ubuntu-deploy.sh를 다시 실행하세요."
command -v ss >/dev/null 2>&1 || fail "ss 명령을 찾을 수 없습니다. iproute2를 설치하세요."
id "$DEPLOY_USER" >/dev/null 2>&1 || fail "실행 사용자 $DEPLOY_USER가 없습니다."
[[ "$DEPLOY_USER" != "goehsmap" ]] \
    || fail "기존 goehsmap 서비스 계정과 분리되지 않았습니다. ubuntu-deploy.sh를 다시 실행하세요."
DEPLOY_GROUP="$(id -gn "$DEPLOY_USER")"

install -d -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" -m 0750 "$DEPLOY_HOME" "$PM2_HOME"

run_pm2() {
    runuser -u "$DEPLOY_USER" -- env HOME="$DEPLOY_HOME" PM2_HOME="$PM2_HOME" \
        "$PM2_BIN" "$@"
}

log "기존 앱 systemd 서비스 중지"
systemctl disable --now "${SERVICE_NAME}.service" >/dev/null 2>&1 || true

log "잘못되었거나 중단된 전용 PM2 데몬 정리"
systemctl disable --now "${PM2_SERVICE_NAME}.service" >/dev/null 2>&1 || true
run_pm2 kill >/dev/null 2>&1 || true

if [[ -s /root/.pm2/pm2.pid ]]; then
    read -r root_pm2_pid < /root/.pm2/pm2.pid || true
    root_pm2_args=""
    if [[ "${root_pm2_pid:-}" =~ ^[0-9]+$ ]]; then
        root_pm2_args="$(ps -p "$root_pm2_pid" -o args= 2>/dev/null || true)"
    fi
    if [[ "$root_pm2_args" == *PM2* && "$root_pm2_args" == *"God Daemon"* ]]; then
        log "root PM2에 잘못 등록된 동일 이름 앱 정리"
        env HOME=/root PM2_HOME=/root/.pm2 "$PM2_BIN" delete "$SERVICE_NAME" >/dev/null 2>&1 || true
    fi
fi

port_usage="$(ss -H -ltnp "sport = :${APP_PORT}" 2>/dev/null || true)"
if [[ -n "$port_usage" ]]; then
    printf '%s\n' "$port_usage" >&2
    fail "${APP_PORT} 포트를 다른 프로세스가 사용 중입니다. 위 프로세스를 확인한 뒤 다시 실행하세요."
fi

log "PM2 부팅 서비스 재생성"
env PATH="$PATH" "$PM2_BIN" startup systemd \
    -u "$DEPLOY_USER" --hp "$DEPLOY_HOME" --service-name "$PM2_SERVICE_NAME"

log "앱 목록 재등록 및 저장"
run_pm2 delete "$SERVICE_NAME" >/dev/null 2>&1 || true
run_pm2 start "$INSTALL_DIR/ecosystem.config.js" --env production --only "$SERVICE_NAME"
run_pm2 save --force
run_pm2 kill >/dev/null 2>&1 || true

log "PM2 부팅 서비스로 다시 시작"
systemctl daemon-reload
systemctl reset-failed "$PM2_SERVICE_NAME" >/dev/null 2>&1 || true
systemctl enable --now "$PM2_SERVICE_NAME"

for _ in {1..30}; do
    if curl --fail --silent "http://127.0.0.1:${APP_PORT}/healthz" >/dev/null; then
        login_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
            "http://127.0.0.1:${APP_PORT}/login")"
        [[ "$login_status" == "404" ]] \
            || fail "복구된 앱이 로그인 경로를 노출합니다(HTTP $login_status)."
        nginx -t
        systemctl reload nginx
        log "복구 완료: http://127.0.0.1:${APP_PORT}/healthz"
        exit 0
    fi
    sleep 1
done

systemctl status "$PM2_SERVICE_NAME" --no-pager || true
run_pm2 logs "$SERVICE_NAME" --nostream --lines 60 || true
fail "30초 안에 백엔드가 복구되지 않았습니다. 위 로그를 확인하세요."
