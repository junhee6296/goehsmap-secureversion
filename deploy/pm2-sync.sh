#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

readonly CONFIG_FILE="/etc/goehsschoolmap-sync.conf"
readonly LOCK_FILE="/run/lock/goehsschoolmap-sync.lock"

log() {
    printf '[goehsschoolmap-sync] %s\n' "$*"
}

fail() {
    printf '[goehsschoolmap-sync] 오류: %s\n' "$*" >&2
    return 1
}

[[ "$EUID" -eq 0 ]] || fail "root 권한으로만 실행할 수 있습니다."
[[ -r "$CONFIG_FILE" ]] || fail "$CONFIG_FILE을 읽을 수 없습니다."
# shellcheck disable=SC1090
source "$CONFIG_FILE"

: "${INSTALL_DIR:?}"
: "${REPO_URL:?}"
: "${DEPLOY_USER:?}"
: "${DEPLOY_GROUP:?}"
: "${NPM_CACHE_DIR:?}"
BRANCH_OVERRIDE="${BRANCH_OVERRIDE:-}"

case "$INSTALL_DIR" in
    /srv/*|/opt/*|/var/www/*|/home/*) ;;
    *) fail "허용되지 않은 설치 경로입니다: $INSTALL_DIR" ;;
esac
[[ "$INSTALL_DIR" != *[[:space:]]* ]] || fail "설치 경로에는 공백을 사용할 수 없습니다."
[[ -d "$INSTALL_DIR/.git" ]] || fail "배포 디렉터리가 Git 저장소가 아닙니다."
[[ "$(git -c safe.directory="$INSTALL_DIR" -C "$INSTALL_DIR" rev-parse --show-toplevel)" == "$INSTALL_DIR" ]] \
    || fail "Git 저장소 루트가 설치 경로와 다릅니다."

exec 9>"$LOCK_FILE"
flock -w 60 9 || fail "다른 GitHub 동기화 작업이 실행 중입니다."

git_in_install() {
    git -c safe.directory="$INSTALL_DIR" -C "$INSTALL_DIR" "$@"
}

enforce_permissions() {
    chown -R root:"$DEPLOY_GROUP" "$INSTALL_DIR"
    chmod -R u=rwX,g=rX,o= "$INSTALL_DIR"
    chmod 0750 "$INSTALL_DIR/ubuntu-deploy.sh" "$INSTALL_DIR/deploy/pm2-start.sh"
    chmod 0640 "$INSTALL_DIR/.env"
}

resolve_branch() {
    if [[ -n "$BRANCH_OVERRIDE" ]]; then
        printf '%s' "$BRANCH_OVERRIDE"
        return
    fi

    local branch
    branch="$(git ls-remote --symref "$REPO_URL" HEAD | awk '$1 == "ref:" { sub("refs/heads/", "", $2); print $2; exit }')"
    [[ -n "$branch" ]] || fail "GitHub 기본 브랜치를 확인할 수 없습니다."
    printf '%s' "$branch"
}

readonly BRANCH="$(resolve_branch)"
[[ "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "브랜치 형식이 올바르지 않습니다."

readonly CURRENT_ORIGIN="$(git_in_install remote get-url origin 2>/dev/null || true)"
[[ "$CURRENT_ORIGIN" == "$REPO_URL" ]] \
    || fail "origin($CURRENT_ORIGIN)이 배포 저장소($REPO_URL)와 다릅니다."

readonly PREVIOUS_COMMIT="$(git_in_install rev-parse HEAD)"
ROLLBACK_REQUIRED=0

rollback_on_error() {
    local exit_code=$?
    local failed_line="$1"
    trap - ERR
    set +e
    if [[ "$ROLLBACK_REQUIRED" -eq 1 ]]; then
        log "검증 실패로 이전 커밋 ${PREVIOUS_COMMIT:0:7} 복원"
        git_in_install reset --hard "$PREVIOUS_COMMIT"
        npm --prefix "$INSTALL_DIR" ci --omit=dev --ignore-scripts --no-fund --no-audit
        enforce_permissions
    fi
    printf '[goehsschoolmap-sync] 오류: %s행에서 동기화가 실패했습니다.\n' "$failed_line" >&2
    exit "$exit_code"
}
trap 'rollback_on_error "$LINENO"' ERR

log "GitHub $BRANCH 최신 커밋 확인"
git_in_install fetch --prune origin "$BRANCH"
git_in_install merge --ff-only "origin/$BRANCH"
readonly UPDATED_COMMIT="$(git_in_install rev-parse HEAD)"

if [[ "$UPDATED_COMMIT" == "$PREVIOUS_COMMIT" ]]; then
    log "이미 최신 커밋입니다: ${UPDATED_COMMIT:0:7}"
    exit 0
fi

ROLLBACK_REQUIRED=1
[[ -f "$INSTALL_DIR/server.js" && -f "$INSTALL_DIR/package-lock.json" ]] \
    || fail "새 커밋에 필수 서버 파일이 없습니다."

log "의존성 설치 및 새 커밋 검증: ${UPDATED_COMMIT:0:7}"
npm --prefix "$INSTALL_DIR" ci --omit=dev --ignore-scripts --no-fund --no-audit
enforce_permissions
runuser -u "$DEPLOY_USER" -- env npm_config_cache="$NPM_CACHE_DIR" npm --prefix "$INSTALL_DIR" run check
runuser -u "$DEPLOY_USER" -- env npm_config_cache="$NPM_CACHE_DIR" npm --prefix "$INSTALL_DIR" test
runuser -u "$DEPLOY_USER" -- env npm_config_cache="$NPM_CACHE_DIR" npm --prefix "$INSTALL_DIR" audit --omit=dev --audit-level=high

ROLLBACK_REQUIRED=0
log "GitHub 동기화와 검증 완료: ${UPDATED_COMMIT:0:7}"
