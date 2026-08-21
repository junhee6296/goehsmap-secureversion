#!/usr/bin/env bash
set -Eeuo pipefail
umask 027

readonly DEFAULT_REPO_URL="https://github.com/junhee6296/goehsmap-secureversion.git"
readonly DEFAULT_DOMAIN="goehsschoolmap.o-r.kr"
readonly APP_PORT="3001"
readonly SERVICE_NAME="goehsschoolmap"
readonly PM2_VERSION="7.0.3"

INSTALL_DIR="$(cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_PATH="$INSTALL_DIR/$(basename -- "${BASH_SOURCE[0]}")"
REPO_URL="${REPO_URL:-$DEFAULT_REPO_URL}"
BRANCH="${BRANCH:-}"
DOMAIN="${DOMAIN:-$DEFAULT_DOMAIN}"
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
  --email ADDRESS  Let's Encrypt 알림 이메일; 지정하면 인증서까지 자동 발급
  --user NAME      앱을 실행할 Linux 사용자
  --skip-git       GitHub 파일 동기화 생략
  --skip-certbot   인증서 자동 발급 생략
  -h, --help       도움말

환경변수 REPO_URL, BRANCH, DOMAIN, LETSENCRYPT_EMAIL, DEPLOY_USER도 사용할 수 있습니다.
EOF
}

while (($#)); do
    case "$1" in
        --repo) REPO_URL="${2:?--repo 값이 필요합니다}"; shift 2 ;;
        --branch) BRANCH="${2:?--branch 값이 필요합니다}"; shift 2 ;;
        --domain) DOMAIN="${2:?--domain 값이 필요합니다}"; shift 2 ;;
        --email) LETSENCRYPT_EMAIL="${2:?--email 값이 필요합니다}"; shift 2 ;;
        --user) DEPLOY_USER="${2:?--user 값이 필요합니다}"; shift 2 ;;
        --skip-git) SKIP_GIT=1; shift ;;
        --skip-certbot) SKIP_CERTBOT=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) usage; fail "알 수 없는 옵션: $1" ;;
    esac
done

readonly BRANCH_OVERRIDE="$BRANCH"

trap 'fail "${BASH_SOURCE[0]}:${LINENO}에서 설치가 중단됐습니다."' ERR

if [[ "$EUID" -ne 0 ]]; then
    log "패키지, PM2, Nginx 설정을 위해 sudo 권한을 요청합니다."
    sudo_args=(--repo "$REPO_URL" --domain "$DOMAIN")
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
[[ -z "$BRANCH" || "$BRANCH" =~ ^[A-Za-z0-9._/-]+$ ]] || fail "브랜치 형식이 올바르지 않습니다."
[[ "$INSTALL_DIR" != *[[:space:]]* ]] || fail "설치 디렉터리 경로에는 공백을 사용할 수 없습니다."
case "$INSTALL_DIR" in
    /|/bin|/boot|/dev|/etc|/home|/lib|/lib64|/opt|/proc|/root|/root/*|/run|/sbin|/srv|/sys|/tmp|/usr|/var)
        fail "시스템 전체 디렉터리에서는 실행할 수 없습니다. /srv/goehsmap-secureversion 같은 전용 디렉터리를 사용하세요."
        ;;
esac

if [[ -z "$DEPLOY_USER" ]]; then
    DEPLOY_USER="goehsmap"
fi
[[ "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || fail "Linux 실행 사용자 이름이 올바르지 않습니다."

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
apt-get install -y --no-install-recommends ca-certificates curl git gnupg nginx rsync sudo util-linux
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
[[ -f "$INSTALL_DIR/deploy/pm2-start.sh" && -f "$INSTALL_DIR/deploy/pm2-sync.sh" ]] \
    || fail "PM2 시작·동기화 스크립트가 없습니다."

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
chmod 0750 "$INSTALL_DIR/ubuntu-deploy.sh" "$INSTALL_DIR/deploy/pm2-start.sh" "$INSTALL_DIR/deploy/pm2-sync.sh"
chmod 0640 "$INSTALL_DIR/.env"
runuser -u "$DEPLOY_USER" -- env npm_config_cache="$NPM_CACHE_DIR" npm --prefix "$INSTALL_DIR" run check
runuser -u "$DEPLOY_USER" -- env npm_config_cache="$NPM_CACHE_DIR" npm --prefix "$INSTALL_DIR" test
runuser -u "$DEPLOY_USER" -- env npm_config_cache="$NPM_CACHE_DIR" npm --prefix "$INSTALL_DIR" audit --omit=dev --audit-level=high

PM2_HOME="$DEPLOY_HOME/.pm2"
SYNC_HELPER="/usr/local/sbin/${SERVICE_NAME}-sync"
SYNC_CONFIG="/etc/${SERVICE_NAME}-sync.conf"
SUDOERS_FILE="/etc/sudoers.d/${SERVICE_NAME}-pm2-sync"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" -m 0750 "$DEPLOY_HOME" "$PM2_HOME"
install -o root -g root -m 0755 "$INSTALL_DIR/deploy/pm2-sync.sh" "$SYNC_HELPER"

{
    printf 'INSTALL_DIR=%q\n' "$INSTALL_DIR"
    printf 'REPO_URL=%q\n' "$REPO_URL"
    printf 'BRANCH_OVERRIDE=%q\n' "$BRANCH_OVERRIDE"
    printf 'DEPLOY_USER=%q\n' "$DEPLOY_USER"
    printf 'DEPLOY_GROUP=%q\n' "$DEPLOY_GROUP"
    printf 'NPM_CACHE_DIR=%q\n' "$NPM_CACHE_DIR"
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
env PATH="$PATH" "$PM2_BIN" startup systemd \
    -u "$DEPLOY_USER" --hp "$DEPLOY_HOME" --service-name "${SERVICE_NAME}-pm2"

log "PM2 앱 시작"
runuser -u "$DEPLOY_USER" -- env HOME="$DEPLOY_HOME" PM2_HOME="$PM2_HOME" \
    "$PM2_BIN" delete "$SERVICE_NAME" >/dev/null 2>&1 || true
runuser -u "$DEPLOY_USER" -- env HOME="$DEPLOY_HOME" PM2_HOME="$PM2_HOME" \
    "$PM2_BIN" start "$INSTALL_DIR/ecosystem.config.js" --env production --only "$SERVICE_NAME"
runuser -u "$DEPLOY_USER" -- env HOME="$DEPLOY_HOME" PM2_HOME="$PM2_HOME" \
    "$PM2_BIN" save --force
for _ in {1..20}; do
    if curl --fail --silent --show-error "http://127.0.0.1:${APP_PORT}/healthz" >/dev/null; then
        break
    fi
    sleep 1
done
curl --fail --silent --show-error "http://127.0.0.1:${APP_PORT}/healthz" >/dev/null \
    || fail "로컬 앱 상태 확인에 실패했습니다. PM2 로그를 확인하세요."

NGINX_AVAILABLE="/etc/nginx/sites-available/$SERVICE_NAME"
NGINX_ENABLED="/etc/nginx/sites-enabled/$SERVICE_NAME"
if [[ -f "$NGINX_AVAILABLE" ]]; then
    cp -a "$NGINX_AVAILABLE" "${NGINX_AVAILABLE}.bak.$(date +%Y%m%d%H%M%S)"
fi

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

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
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

if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
    ufw allow 'Nginx Full'
fi

CERT_DIR="/etc/letsencrypt/live/$DOMAIN"
if [[ -d "$CERT_DIR" ]]; then
    log "기존 $DOMAIN 전용 인증서 연결"
    write_nginx_https
elif [[ "$SKIP_CERTBOT" -eq 0 && -n "$LETSENCRYPT_EMAIL" ]]; then
    log "Let's Encrypt $DOMAIN 전용 인증서 발급"
    certbot certonly --nginx \
        --cert-name "$DOMAIN" \
        -d "$DOMAIN" \
        --email "$LETSENCRYPT_EMAIL" \
        --agree-tos \
        --non-interactive \
        --no-eff-email
    write_nginx_https
else
    log "인증서 자동 발급을 생략했습니다. 아래 명령으로 전용 인증서를 발급한 뒤 스크립트를 다시 실행하세요."
    printf 'sudo certbot certonly --nginx --cert-name %q -d %q --email YOUR_EMAIL --agree-tos --non-interactive\n' "$DOMAIN" "$DOMAIN"
fi

nginx -t
systemctl reload nginx
systemctl enable --now certbot.timer >/dev/null 2>&1 || true

log "배포 완료"
log "로컬 상태: http://127.0.0.1:${APP_PORT}/healthz"
log "재시작·Git 동기화: sudo -u $DEPLOY_USER env HOME=$DEPLOY_HOME PM2_HOME=$PM2_HOME $PM2_BIN restart $SERVICE_NAME"
if [[ -d "$CERT_DIR" ]]; then
    log "공개 주소: https://$DOMAIN/"
else
    log "현재는 HTTP만 연결됐습니다. 인증서 발급 후 HTTPS를 사용하세요."
fi
