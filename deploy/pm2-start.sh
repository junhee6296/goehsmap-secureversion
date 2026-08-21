#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

readonly INSTALL_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
readonly SYNC_HELPER="/usr/local/sbin/goehsschoolmap-sync"
readonly NODE_BIN="$(command -v node)"

printf '[goehsschoolmap] PM2 시작 전 GitHub 동기화 확인\n'
if [[ -x "$SYNC_HELPER" ]]; then
    if ! /usr/bin/sudo -n "$SYNC_HELPER"; then
        printf '[goehsschoolmap] 경고: GitHub 동기화에 실패하여 검증된 기존 버전으로 시작합니다.\n' >&2
    fi
else
    printf '[goehsschoolmap] 경고: 동기화 도우미가 없어 기존 버전으로 시작합니다.\n' >&2
fi

exec "$NODE_BIN" "$INSTALL_DIR/server.js"
