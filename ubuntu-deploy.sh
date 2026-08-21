#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

readonly DEFAULT_REPO_URL="https://github.com/junhee6296/goehsmap-secureversion.git"
readonly DEFAULT_DOMAIN="goehsschoolmap.o-r.kr"
readonly DEFAULT_APP_PORT="3001"
readonly LEGACY_APP_PORT="3000"
readonly LEGACY_DOMAIN="goehsmap.o-r.kr"
readonly LEGACY_DEPLOY_USER="goehsmap"
readonly SERVICE_NAME="goehsschoolmap"
readonly PM2_VERSION="7.0.3"

INSTALL_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="$INSTALL_DIR/$(basename -- "${BASH_SOURCE[0]}")"
REPO_URL="${REPO_URL:-$DEFAULT_REPO_URL}"
BRANCH="${BRANCH:-}"
DOMAIN="${DOMAIN:-$DEFAULT_DOMAIN}"
APP_PORT="${APP_PORT:-$DEFAULT_APP_PORT}"
CERT_NAME="${CERT_NAME:-}"
LETSENCRYPT_EMAIL="${LETSENCRYPT_EMAIL:-}"
DEPLOY_USER="${DEPLOY_USER:-}"
SKIP_GIT=0
SKIP_CERTBOT=0

log() {
    printf '[goehsschoolmap] %s\n' "$*"
}

fail() {
    printf '[goehsschoolmap] 오류: %s\n' "$*" >&2
    exit 1
}

usage() {
    cat <<'EOF'
사용법:
  bash ubuntu-deploy.sh [옵션]

옵션:
  --repo URL       GitHub 저장소 URL
  --branch NAME    배포할 브랜치; 생략하면 GitHub 기본 브랜치를 자동 감지
  --domain NAME    연결할 도메인
  --port NUMBER    새 사이트 전용 포트(기본 3001, 기존 사이트 3000 사용 금지)
  --cert-name NAME 새 사이트 전용 Certbot 인증서 이름
  --email ADDRESS  Let's Encrypt 알림 이메일; 지정하면 인증서까지 자동 발급
  --user NAME      앱을 실행할 Linux 사용자
  --skip-git       GitHub 파일 동기화 생략
  --skip-certbot   인증서 자동 발급 생략
  -h, --help       도움말

환경변수 REPO_URL, BRANCH, DOMAIN, APP_PORT, CERT_NAME, LETSENCRYPT_EMAIL, DEPLOY_USER도 사용할 수 있습니다.
EOF
}

while (($#)); do
    case "$1" in
        --repo) REPO_URL="${2:?--repo 값이 필요합니다}"; shift 2 ;;
        --branch) BRANCH="${2:?--branch 값이 필요합니다}"; shift 2 ;;
        --domain) DOMAIN="${2:?--domain 값이 필요합니다}"; shift 2 ;;
        --port) APP_PORT="${2:?--port 값이 필요합니다}"; shift 2 ;;
        --cert-name) CERT_NAME="${2:?--cert-name 값이 필요합니다}"; shift 2 ;;
        --email) LETSENCRYPT_EMAIL="${2:?--email 값이 필요합니다}"; shift 2 ;;
        --user) DEPLOY_USER="${2:?--user 값이 필요합니다}"; shift 2 ;;
        --skip-git) SKIP_GIT=1; shift ;;
        --skip-certbot) SKIP_CERTBOT=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) usage; fail "알 수 없는 옵션: $1" ;;
    esac
done

if [[ -z "$CERT_NAME" ]]; then
    CERT_NAME="${DOMAIN}-isolated"
fi
readonly BRANCH_OVERRIDE="$BRANCH"
readonly APP_PORT CERT_NAME

trap 'fail "${BASH_SOURCE[0]}:${LINENO}에서 설치가 중단됐습니다."' ERR

if [[ "$EUID" -ne 0 ]]; then
    log "패키지, PM2, Nginx 설정을 위해 sudo 권한을 요청합니다."
    sudo_args=(--repo "$REPO_URL" --domain "$DOMAIN" --port "$APP_PORT" --cert-name "$CERT_NAME")
    [[ -n "$BRANCH" ]] && sudo_args+=(--branch "$BRANCH")
    [[ -n "$LETSENCRYPT_EMAIL" ]] && sudo_args+=(--email "$LETSENCRYPT_EMAIL")
    [[ -n "$DEPLOY_USER" ]] && sudo_args+=(--user "$DEPLOY_USER")
    [[ "$SKIP_GIT" -eq 1 ]] && sudo_args+=(--skip-git)
    [[ "$SKIP_CERTBOT" -eq 1 ]] && sudo_args+=(--skip-certbot)
    exec sudo -E bash "$SCRIPT_PATH" "${sudo_args[@]}"
fi

[[ -r /etc/os-release ]] || fail "Ubuntu 정보를 확인할 수 없습니다."
# shellcheck disable=SC1091
source /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || fail "이 스크립트는 Ubuntu 전용입니다."
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || fail "도메인 형식이 올바르지 않습니다."
[[ "$CERT_NAME" =~ ^[A-Za-z0-9._-]+$ ]] || fail "Certbot 인증서 이름 형식이 올바르지 않습니다."
[[ "$APP_PORT" =~ ^[0-9]+$ ]] || fail "포트는 숫자여야 합니다."
((APP_PORT >= 1024 && APP_PORT <= 65535)) || fail "포트는 1024~65535 범위여야 합니다."
((APP_PORT != LEGACY_APP_PORT)) || fail "기존 $LEGACY_DOMAIN 서비스 포트 $LEGACY_APP_PORT는 사용할 수 없습니다."
[[ -z "$BRANCH" || "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "브랜치 형식이 올바르지 않습니다."
[[ "$INSTALL_DIR" != *[[:space:]]* ]] || fail "설치 디렉터리 경로에는 공백을 사용할 수 없습니다."
case "$INSTALL_DIR" in
    /|/bin|/boot|/dev|/etc|/home|/lib|/lib64|/opt|/proc|/root|/root/*|/run|/sbin|/srv|/sys|/tmp|/usr|/var)
        fail "시스템 전체 디렉터리에서는 실행할 수 없습니다. /srv/goehsmap-secureversion 같은 전용 디렉터리를 사용하세요."
        ;;
esac

if [[ -z "$DEPLOY_USER" ]]; then
    DEPLOY_USER="$SERVICE_NAME"
fi
[[ "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || fail "Linux 실행 사용자 이름이 올바르지 않습니다."
[[ "$DEPLOY_USER" != "$LEGACY_DEPLOY_USER" ]] \
    || fail "기존 $LEGACY_DOMAIN 계정 $LEGACY_DEPLOY_USER와 분리해야 합니다. --user $SERVICE_NAME을 사용하세요."

DEPLOY_HOME="/var/lib/$SERVICE_NAME"
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
    log "전용 사용자 $DEPLOY_USER 생성"
    useradd --system --home-dir "$DEPLOY_HOME" --create-home --shell /usr/sbin/nologin "$DEPLOY_USER"
fi
DEPLOY_GROUP="$(id -gn "$DEPLOY_USER")"
NPM_CACHE_DIR="/var/cache/$SERVICE_NAME/npm"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" -m 0750 "$NPM_CACHE_DIR"

export DEBIAN_FRONTEND=noninteractive
log "필수 Ubuntu 패키지 설치"
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl git gnupg iproute2 nginx openssl python3 rsync sudo util-linux
if ! command -v certbot >/dev/null 2>&1; then
    log "Ubuntu 패키지로 Certbot과 Nginx 플러그인 설치"
    apt-get install -y --no-install-recommends certbot python3-certbot-nginx
fi
certbot plugins 2>/dev/null | grep -q 'nginx' \
    || fail "현재 Certbot에 Nginx 플러그인이 없습니다. 사용 중인 Certbot 설치 방식에 맞는 Nginx 플러그인을 먼저 설치하세요."

resolve_remote_branch() {
    [[ "$SKIP_GIT" -eq 0 ]] || return
    if [[ -n "$BRANCH" ]]; then
        log "지정한 GitHub 브랜치 사용: $BRANCH"
        return
    fi

    local remote_branch
    if ! remote_branch="$(git ls-remote --symref "$REPO_URL" HEAD | awk '$1 == "ref:" { sub("refs/heads/", "", $2); print $2; exit }')"; then
        fail "GitHub 기본 브랜치를 확인할 수 없습니다: $REPO_URL"
    fi
    [[ -n "$remote_branch" ]] || fail "GitHub 저장소의 기본 브랜치를 찾지 못했습니다: $REPO_URL"
    [[ "$remote_branch" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "원격 기본 브랜치 형식이 올바르지 않습니다."
    BRANCH="$remote_branch"
    log "GitHub 기본 브랜치 자동 감지: $BRANCH"
}

resolve_remote_branch

install_node() {
    local node_major=0
    if command -v node >/dev/null 2>&1; then
        node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
    fi
    if ((node_major >= 20)); then
        log "Node.js $(node --version) 사용"
        return
    fi

    log "서명된 NodeSource 저장소에서 Node.js 20 설치"
    install -d -m 0755 /etc/apt/keyrings
    local key_file
    key_file="$(mktemp)"
    curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
        https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key -o "$key_file"
    gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg "$key_file"
    rm -f "$key_file"
    chmod 0644 /etc/apt/keyrings/nodesource.gpg
    printf '%s\n' 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main' \
        > /etc/apt/sources.list.d/nodesource.list
    apt-get update
    apt-get install -y --no-install-recommends nodejs
    node --version | grep -Eq '^v(2[0-9]|[3-9][0-9])\.' || fail "Node.js 20 이상 설치에 실패했습니다."
}

install_node
log "PM2 $PM2_VERSION 설치"
npm install --global "pm2@$PM2_VERSION" --ignore-scripts --no-fund --no-audit
PM2_BIN="$(command -v pm2)"

git_in_install() {
    git -c safe.directory="$INSTALL_DIR" -C "$INSTALL_DIR" "$@"
}

sync_repository() {
    if [[ "$SKIP_GIT" -eq 1 ]]; then
        log "GitHub 동기화 생략"
        return
    fi

    if git_in_install rev-parse --verify HEAD >/dev/null 2>&1; then
        existing_origin="$(git_in_install remote get-url origin 2>/dev/null || true)"
        if [[ -z "$existing_origin" ]]; then
            git_in_install remote add origin "$REPO_URL"
        elif [[ "$existing_origin" != "$REPO_URL" ]]; then
            fail "현재 origin($existing_origin)이 --repo 값($REPO_URL)과 다릅니다. 올바른 --repo 값을 지정하거나 origin을 먼저 수정하세요."
        fi
        log "GitHub $BRANCH 브랜치 업데이트"
        git_in_install fetch --prune origin "$BRANCH"
        git_in_install merge --ff-only "origin/$BRANCH"
        log "적용한 GitHub 커밋: $(git_in_install rev-parse --short HEAD)"
        return
    fi

    log "GitHub 파일을 스크립트 디렉터리로 복사"
    local temp_dir
    temp_dir="$(mktemp -d)"
    trap 'rm -rf "$temp_dir"' RETURN
    git clone --depth 1 --branch "$BRANCH" "$REPO_URL" "$temp_dir/repository"
    rsync -a \
        --exclude '.env' \
        --exclude '.env.sync' \
        --exclude 'node_modules' \
        "$temp_dir/repository/" "$INSTALL_DIR/"
    log "적용한 GitHub 커밋: $(git -C "$temp_dir/repository" rev-parse --short HEAD)"
    rm -rf "$temp_dir"
    trap - RETURN
}

sync_repository

[[ -f "$INSTALL_DIR/package-lock.json" ]] || fail "package-lock.json이 없습니다. GitHub 저장소 URL을 확인하세요."
[[ -f "$INSTALL_DIR/runtime.js" ]] || fail "runtime.js가 없습니다. 보안 버전 저장소인지 확인하세요."
[[ -f "$INSTALL_DIR/server.js" ]] || fail "server.js가 없습니다. 최신 보안 버전 저장소인지 확인하세요."
[[ -f "$INSTALL_DIR/ecosystem.config.js" ]] || fail "ecosystem.config.js가 없습니다. PM2 배포 파일을 확인하세요."
[[ -f "$INSTALL_DIR/deploy/pm2-sync.sh" && -f "$INSTALL_DIR/deploy/pm2-control.sh" && \
   -f "$INSTALL_DIR/deploy/pm2-recover.sh" ]] \
    || fail "PM2 동기화·관리·복구 스크립트가 없습니다."

if [[ ! -f "$INSTALL_DIR/.env" ]]; then
    install -o root -g "$DEPLOY_GROUP" -m 0640 "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
fi
if grep -q '^PORT=' "$INSTALL_DIR/.env"; then
    sed -i "s/^PORT=.*/PORT=$APP_PORT/" "$INSTALL_DIR/.env"
else
    printf 'PORT=%s\n' "$APP_PORT" >> "$INSTALL_DIR/.env"
fi
chmod 0640 "$INSTALL_DIR/.env"
chown root:"$DEPLOY_GROUP" "$INSTALL_DIR/.env"

log "고정된 Node.js 의존성 설치 및 검사"
npm --prefix "$INSTALL_DIR" ci --omit=dev --ignore-scripts --no-fund --no-audit
chown -R root:"$DEPLOY_GROUP" "$INSTALL_DIR"
chmod -R u=rwX,g=rX,o= "$INSTALL_DIR"
chmod 0750 "$INSTALL_DIR/ubuntu-deploy.sh" "$INSTALL_DIR/deploy/pm2-sync.sh" \
    "$INSTALL_DIR/deploy/pm2-control.sh" "$INSTALL_DIR/deploy/pm2-recover.sh"
chmod 0640 "$INSTALL_DIR/.env"
runuser -u "$DEPLOY_USER" -- env npm_config_cache="$NPM_CACHE_DIR" npm --prefix "$INSTALL_DIR" run check
runuser -u "$DEPLOY_USER" -- env npm_config_cache="$NPM_CACHE_DIR" npm --prefix "$INSTALL_DIR" test
runuser -u "$DEPLOY_USER" -- env npm_config_cache="$NPM_CACHE_DIR" npm --prefix "$INSTALL_DIR" audit --omit=dev --audit-level=high

PM2_HOME="$DEPLOY_HOME/.pm2"
SYNC_HELPER="/usr/local/sbin/${SERVICE_NAME}-sync"
PM2_CONTROL="/usr/local/sbin/${SERVICE_NAME}-pm2"
RECOVERY_HELPER="/usr/local/sbin/${SERVICE_NAME}-recover"
SYNC_CONFIG="/etc/${SERVICE_NAME}-sync.conf"
SUDOERS_FILE="/etc/sudoers.d/${SERVICE_NAME}-pm2-sync"
systemctl disable --now "${SERVICE_NAME}-pm2.service" >/dev/null 2>&1 || true
install -d -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" -m 0750 "$DEPLOY_HOME" "$PM2_HOME"
chown -R "$DEPLOY_USER:$DEPLOY_GROUP" "$DEPLOY_HOME"
install -o root -g root -m 0755 "$INSTALL_DIR/deploy/pm2-sync.sh" "$SYNC_HELPER"
install -o root -g root -m 0755 "$INSTALL_DIR/deploy/pm2-control.sh" "$PM2_CONTROL"
install -o root -g root -m 0755 "$INSTALL_DIR/deploy/pm2-recover.sh" "$RECOVERY_HELPER"

{
    printf 'INSTALL_DIR=%q\n' "$INSTALL_DIR"
    printf 'REPO_URL=%q\n' "$REPO_URL"
    printf 'BRANCH_OVERRIDE=%q\n' "$BRANCH_OVERRIDE"
    printf 'DEPLOY_USER=%q\n' "$DEPLOY_USER"
    printf 'DEPLOY_GROUP=%q\n' "$DEPLOY_GROUP"
    printf 'NPM_CACHE_DIR=%q\n' "$NPM_CACHE_DIR"
    printf 'DEPLOY_HOME=%q\n' "$DEPLOY_HOME"
    printf 'PM2_HOME=%q\n' "$PM2_HOME"
    printf 'PM2_BIN=%q\n' "$PM2_BIN"
    printf 'SERVICE_NAME=%q\n' "$SERVICE_NAME"
    printf 'APP_PORT=%q\n' "$APP_PORT"
    printf 'DOMAIN=%q\n' "$DOMAIN"
    printf 'CERT_NAME=%q\n' "$CERT_NAME"
} > "$SYNC_CONFIG"
chown root:root "$SYNC_CONFIG"
chmod 0600 "$SYNC_CONFIG"

printf '%s ALL=(root) NOPASSWD: %s\n' "$DEPLOY_USER" "$SYNC_HELPER" > "$SUDOERS_FILE"
chown root:root "$SUDOERS_FILE"
chmod 0440 "$SUDOERS_FILE"
visudo -cf "$SUDOERS_FILE"

SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
if systemctl list-unit-files "${SERVICE_NAME}.service" >/dev/null 2>&1; then
    log "기존 앱 systemd 서비스 중지·비활성화"
    systemctl disable --now "$SERVICE_NAME" || true
fi
if [[ -f "$SERVICE_FILE" ]]; then
    cp -a "$SERVICE_FILE" "${SERVICE_FILE}.disabled.$(date +%Y%m%d%H%M%S)"
    rm -f "$SERVICE_FILE"
    systemctl daemon-reload
fi

log "PM2 부팅 자동 시작 구성"
runuser -u "$DEPLOY_USER" -- env HOME="$DEPLOY_HOME" PM2_HOME="$PM2_HOME" \
    "$PM2_BIN" kill >/dev/null 2>&1 || true

if [[ -s /root/.pm2/pm2.pid ]]; then
    read -r root_pm2_pid < /root/.pm2/pm2.pid || true
    root_pm2_args=""
    if [[ "${root_pm2_pid:-}" =~ ^[0-9]+$ ]]; then
        root_pm2_args="$(ps -p "$root_pm2_pid" -o args= 2>/dev/null || true)"
    fi
    if [[ "$root_pm2_args" == *PM2* && "$root_pm2_args" == *"God Daemon"* ]]; then
        log "root PM2에 잘못 등록된 $SERVICE_NAME 앱 정리"
        env HOME=/root PM2_HOME=/root/.pm2 "$PM2_BIN" delete "$SERVICE_NAME" >/dev/null 2>&1 || true
    fi
fi

port_usage="$(ss -H -ltnp "sport = :${APP_PORT}" 2>/dev/null || true)"
if [[ -n "$port_usage" ]]; then
    printf '%s\n' "$port_usage" >&2
    fail "전용 포트 $APP_PORT를 다른 프로세스가 사용 중입니다. 기존 $LEGACY_DOMAIN 포트 $LEGACY_APP_PORT는 변경하지 않았습니다."
fi

env PATH="$PATH" "$PM2_BIN" startup systemd \
    -u "$DEPLOY_USER" --hp "$DEPLOY_HOME" --service-name "${SERVICE_NAME}-pm2"

log "PM2 앱 시작"
runuser -u "$DEPLOY_USER" -- env HOME="$DEPLOY_HOME" PM2_HOME="$PM2_HOME" \
    "$PM2_BIN" delete "$SERVICE_NAME" >/dev/null 2>&1 || true
runuser -u "$DEPLOY_USER" -- env HOME="$DEPLOY_HOME" PM2_HOME="$PM2_HOME" \
    "$PM2_BIN" start "$INSTALL_DIR/ecosystem.config.js" --env production --only "$SERVICE_NAME"
runuser -u "$DEPLOY_USER" -- env HOME="$DEPLOY_HOME" PM2_HOME="$PM2_HOME" \
    "$PM2_BIN" save --force
runuser -u "$DEPLOY_USER" -- env HOME="$DEPLOY_HOME" PM2_HOME="$PM2_HOME" \
    "$PM2_BIN" kill >/dev/null 2>&1 || true
systemctl daemon-reload
systemctl reset-failed "${SERVICE_NAME}-pm2.service" >/dev/null 2>&1 || true
systemctl enable --now "${SERVICE_NAME}-pm2.service"
for _ in {1..20}; do
    if curl --fail --silent --show-error "http://127.0.0.1:${APP_PORT}/healthz" >/dev/null; then
        break
    fi
    sleep 1
done
curl --fail --silent --show-error "http://127.0.0.1:${APP_PORT}/healthz" >/dev/null \
    || fail "로컬 앱 상태 확인에 실패했습니다. PM2 로그를 확인하세요."
login_status="$(curl --silent --output /dev/null --write-out '%{http_code}' "http://127.0.0.1:${APP_PORT}/login")"
[[ "$login_status" == "404" ]] \
    || fail "전용 포트 $APP_PORT에서 로그인 경로가 차단되지 않았습니다(HTTP $login_status). 잘못된 앱 실행을 중단합니다."

NGINX_AVAILABLE="/etc/nginx/sites-available/$SERVICE_NAME"
NGINX_ENABLED="/etc/nginx/sites-enabled/$SERVICE_NAME"

reset_nginx_domain_bindings() {
    log "$DOMAIN의 기존 Nginx 바인딩 백업 및 분리"
    nginx -t
    install -d -o root -g root -m 0700 "/var/backups/${SERVICE_NAME}-nginx"
    NGINX_RESET_BACKUP="$(mktemp -d "/var/backups/${SERVICE_NAME}-nginx/reset.XXXXXXXX")"
    readonly NGINX_RESET_BACKUP
    cp -a /etc/nginx "$NGINX_RESET_BACKUP/nginx-before"

    local candidate candidate_name enabled_entry enabled_target
    for candidate in \
        "/etc/nginx/sites-enabled/$DOMAIN" \
        "/etc/nginx/sites-enabled/${DOMAIN}.conf" \
        "/etc/nginx/sites-available/$DOMAIN" \
        "/etc/nginx/sites-available/${DOMAIN}.conf" \
        "/etc/nginx/conf.d/$DOMAIN" \
        "/etc/nginx/conf.d/${DOMAIN}.conf" \
        "/etc/nginx/conf.d/${SERVICE_NAME}.conf"; do
        if [[ -e "$candidate" || -L "$candidate" ]]; then
            candidate_name="$(printf '%s' "$candidate" | sed 's#^/etc/nginx/##; s#/#__#g')"
            mv -- "$candidate" "$NGINX_RESET_BACKUP/$candidate_name"
        fi
    done

    for enabled_entry in /etc/nginx/sites-enabled/*; do
        [[ -L "$enabled_entry" ]] || continue
        enabled_target="$(readlink -m -- "$enabled_entry" 2>/dev/null || true)"
        if [[ "$enabled_target" == "/etc/nginx/sites-available/$DOMAIN" ||
              "$enabled_target" == "/etc/nginx/sites-available/${DOMAIN}.conf" ||
              ( "$enabled_target" == "$NGINX_AVAILABLE" && "$enabled_entry" != "$NGINX_ENABLED" ) ]]; then
            candidate_name="sites-enabled__$(basename -- "$enabled_entry")"
            mv -- "$enabled_entry" "$NGINX_RESET_BACKUP/$candidate_name"
        fi
    done

    python3 - "$DOMAIN" <<'PY'
from pathlib import Path
import re
import subprocess
import sys

domain = sys.argv[1]
nginx_root = Path('/etc/nginx').resolve()


def mask_config(text):
    output = list(text)
    quote = None
    escaped = False
    comment = False
    for index, character in enumerate(text):
        if comment:
            if character == '\n':
                comment = False
            else:
                output[index] = ' '
            continue
        if quote is not None:
            output[index] = ' '
            if escaped:
                escaped = False
            elif character == '\\':
                escaped = True
            elif character == quote:
                quote = None
            continue
        if character == '#':
            output[index] = ' '
            comment = True
        elif character in {'"', "'"}:
            output[index] = ' '
            quote = character
    return ''.join(output)


def server_blocks(text):
    masked = mask_config(text)
    blocks = []
    cursor = 0
    pattern = re.compile(r'\bserver\s*\{')
    while True:
        match = pattern.search(masked, cursor)
        if match is None:
            return blocks
        opening = masked.find('{', match.start(), match.end())
        depth = 0
        closing = None
        for index in range(opening, len(masked)):
            if masked[index] == '{':
                depth += 1
            elif masked[index] == '}':
                depth -= 1
                if depth == 0:
                    closing = index + 1
                    break
        if closing is None:
            raise RuntimeError('닫히지 않은 Nginx server 블록이 있습니다.')
        blocks.append((match.start(), closing))
        cursor = closing


def clean_server_block(block):
    masked = mask_config(block)
    name_pattern = re.compile(r'\bserver_name\s+([^;]+);')
    name_matches = list(name_pattern.finditer(masked))
    names = []
    for match in name_matches:
        names.extend(token.strip('"\'') for token in match.group(1).split())
    if domain not in names:
        return block, False

    remaining_names = [name for name in names if name != domain]
    if not remaining_names:
        return '', True

    cleaned = block
    for match in reversed(name_matches):
        original_tokens = block[match.start(1):match.end(1)].split()
        kept_tokens = [token for token in original_tokens if token.strip('"\'') != domain]
        if kept_tokens:
            cleaned = cleaned[:match.start(1)] + ' '.join(kept_tokens) + cleaned[match.end(1):]
        else:
            cleaned = cleaned[:match.start()] + cleaned[match.end():]

    host_if_pattern = re.compile(
        r'\bif\s*\(\s*\$host\s*=\s*' + re.escape(domain) + r'\s*\)\s*\{[^{}]*\}',
        re.DOTALL,
    )
    while True:
        masked_cleaned = mask_config(cleaned)
        match = host_if_pattern.search(masked_cleaned)
        if match is None:
            break
        cleaned = cleaned[:match.start()] + cleaned[match.end():]
    return cleaned, True


dump = subprocess.run(['nginx', '-T'], text=True, capture_output=True, check=True)
source_text = dump.stdout + '\n' + dump.stderr
source_paths = set(re.findall(r'^# configuration file (.+):$', source_text, flags=re.MULTILINE))

for source_path in sorted(source_paths):
    path = Path(source_path)
    try:
        resolved = path.resolve(strict=True)
        resolved.relative_to(nginx_root)
    except (FileNotFoundError, ValueError):
        continue
    if not resolved.is_file():
        continue

    original = resolved.read_text(encoding='utf-8', errors='surrogateescape')
    updated = original
    changed = False
    for start, end in reversed(server_blocks(original)):
        cleaned_block, block_changed = clean_server_block(original[start:end])
        if block_changed:
            updated = updated[:start] + cleaned_block + updated[end:]
            changed = True
    if changed:
        resolved.write_text(updated, encoding='utf-8', errors='surrogateescape')
        print(f'[goehsschoolmap] 기존 바인딩 제거: {resolved}')
PY

    log "Nginx 원본 백업: $NGINX_RESET_BACKUP/nginx-before"
}

reset_nginx_domain_bindings

write_nginx_http() {
    cat > "$NGINX_AVAILABLE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    client_max_body_size 64k;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
    }
}
EOF
}

write_nginx_https() {
    cat > "$NGINX_AVAILABLE" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$CERT_NAME/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$CERT_NAME/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 64k;

    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_connect_timeout 5s;
        proxy_read_timeout 30s;
    }
}
EOF
}

write_nginx_http
ln -sfn "$NGINX_AVAILABLE" "$NGINX_ENABLED"
nginx -t
systemctl reload nginx
curl --fail --silent --show-error --resolve "$DOMAIN:80:127.0.0.1" \
    "http://${DOMAIN}/healthz" >/dev/null
http_login_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
    --resolve "$DOMAIN:80:127.0.0.1" "http://${DOMAIN}/login")"
[[ "$http_login_status" == "404" ]] \
    || fail "$DOMAIN HTTP 바인딩이 분리되지 않았습니다(/login HTTP $http_login_status). Nginx 백업: $NGINX_RESET_BACKUP/nginx-before"

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
    ufw allow 'Nginx Full'
fi

CERT_DIR="/etc/letsencrypt/live/$CERT_NAME"
if [[ "$SKIP_CERTBOT" -eq 0 && -n "$LETSENCRYPT_EMAIL" ]]; then
    log "Let's Encrypt 분리 인증서 발급·확인: $CERT_NAME"
    certbot certonly --nginx \
        --cert-name "$CERT_NAME" \
        -d "$DOMAIN" \
        --email "$LETSENCRYPT_EMAIL" \
        --agree-tos \
        --non-interactive \
        --keep-until-expiring
    write_nginx_https
elif [[ -s "$CERT_DIR/fullchain.pem" && -s "$CERT_DIR/privkey.pem" ]] && \
     openssl x509 -in "$CERT_DIR/fullchain.pem" -noout -checkend 86400 >/dev/null 2>&1 && \
     openssl x509 -in "$CERT_DIR/fullchain.pem" -noout -checkhost "$DOMAIN" >/dev/null 2>&1; then
    log "기존 분리 인증서 연결: $CERT_NAME"
    write_nginx_https
else
    log "인증서 자동 발급을 생략했습니다. 아래 명령으로 전용 인증서를 발급한 뒤 스크립트를 다시 실행하세요."
    printf 'sudo certbot certonly --nginx --cert-name %q -d %q --email YOUR_EMAIL --agree-tos --non-interactive\n' "$CERT_NAME" "$DOMAIN"
fi

nginx -t
systemctl reload nginx
systemctl enable --now certbot.timer >/dev/null 2>&1 || true

if [[ -d "$CERT_DIR" ]]; then
    curl --fail --silent --show-error --resolve "$DOMAIN:443:127.0.0.1" \
        "https://${DOMAIN}/healthz" >/dev/null
    public_login_status="$(curl --silent --output /dev/null --write-out '%{http_code}' \
        --resolve "$DOMAIN:443:127.0.0.1" "https://${DOMAIN}/login")"
    [[ "$public_login_status" == "404" ]] \
        || fail "$DOMAIN HTTPS에서 로그인 경로가 차단되지 않았습니다(HTTP $public_login_status)."
fi

legacy_status="$(curl --insecure --silent --output /dev/null --write-out '%{http_code}' \
    --connect-timeout 5 "https://${LEGACY_DOMAIN}/" 2>/dev/null || true)"
log "기존 $LEGACY_DOMAIN 확인 결과: HTTP ${legacy_status:-확인실패} (포트 $LEGACY_APP_PORT 설정은 변경하지 않음)"

log "배포 완료"
log "로컬 상태: http://127.0.0.1:${APP_PORT}/healthz"
log "분리 구성: $DOMAIN -> 127.0.0.1:$APP_PORT, 인증서 $CERT_NAME"
log "PM2 관리: sudo $PM2_CONTROL status"
log "재시작·Git 동기화: sudo $PM2_CONTROL restart $SERVICE_NAME"
log "Bad Gateway 긴급 복구: sudo $RECOVERY_HELPER"
if [[ -d "$CERT_DIR" ]]; then
    log "공개 주소: https://$DOMAIN/"
else
    log "현재는 HTTP만 연결됐습니다. 인증서 발급 후 HTTPS를 사용하세요."
fi
