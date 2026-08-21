#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

readonly CONFIG_FILE="/etc/goehsschoolmap-sync.conf"

fail() {
    printf '[goehsschoolmap-pm2] 오류: %s\n' "$*" >&2
    exit 1
}

[[ "$EUID" -eq 0 ]] || fail "sudo로 실행하세요."
[[ -r "$CONFIG_FILE" ]] || fail "$CONFIG_FILE을 읽을 수 없습니다. ubuntu-deploy.sh를 먼저 실행하세요."
# shellcheck disable=SC1090
source "$CONFIG_FILE"

: "${DEPLOY_USER:?}"
: "${DEPLOY_HOME:?}"
: "${PM2_HOME:?}"
: "${PM2_BIN:?}"
: "${SERVICE_NAME:?}"
readonly SYNC_HELPER="/usr/local/sbin/${SERVICE_NAME}-sync"
readonly RECOVERY_HELPER="/usr/local/sbin/${SERVICE_NAME}-recover"

command_name="${1:-status}"
if (($#)); then shift; fi

run_pm2() {
    runuser -u "$DEPLOY_USER" -- env HOME="$DEPLOY_HOME" PM2_HOME="$PM2_HOME" \
        "$PM2_BIN" "$@"
}

case "$command_name" in
    restart|reload)
        [[ -x "$SYNC_HELPER" ]] || fail "Git 동기화 도구가 없습니다: $SYNC_HELPER"
        if (($# == 0)); then
            set -- "$SERVICE_NAME"
        fi
        "$SYNC_HELPER"
        run_pm2 "$command_name" "$@"
        ;;
    status|list|logs|monit|stop|start|delete|resurrect|save)
        run_pm2 "$command_name" "$@"
        ;;
    update)
        run_pm2 update || printf '[goehsschoolmap-pm2] PM2 데몬 업데이트 실패; 복구를 계속합니다.\n' >&2
        [[ -x "$RECOVERY_HELPER" ]] || fail "PM2 복구 도구가 없습니다: $RECOVERY_HELPER"
        "$RECOVERY_HELPER"
        ;;
    *)
        fail "허용 명령: status, list, logs, monit, restart, reload, stop, start, delete, resurrect, save, update"
        ;;
esac
