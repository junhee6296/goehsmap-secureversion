# goehsschoolmap.o-r.kr 배포·도메인 연결

## 자동 설치 스크립트

`ubuntu-deploy.sh`를 Ubuntu 서버의 배포할 디렉터리에 놓고 실행하면 그 디렉터리에 GitHub 파일을 동기화하고, Node.js 의존성·보안 검사·systemd·Nginx·Let's Encrypt까지 설정합니다.

```bash
chmod +x ubuntu-deploy.sh
sudo ./ubuntu-deploy.sh \
  --repo https://github.com/junhee6296/goehsmap-secureversion.git \
  --branch main \
  --email 담당자@example.com
```

저장소 주소가 다르면 `--repo` 값만 바꾸세요. 기본 배포는 공개 저장소를 전제로 합니다. 비공개 저장소라면 root 계정에 읽기 전용 GitHub Deploy Key와 GitHub 호스트 키를 먼저 등록하고 SSH 저장소 주소를 사용합니다. 토큰을 스크립트나 저장소 URL에 직접 넣지 마세요.

이 스크립트는 새 도메인 전용 인증서를 발급합니다. 기존 `goehsmap.o-r.kr` 인증서와 가상호스트는 수정하지 않습니다. 인증서 발급을 나중에 하려면 `--skip-certbot`을 붙입니다.

서버에 Certbot이 이미 설치되어 있으면 기존 설치를 그대로 사용하고, 없을 때만 Ubuntu 패키지와 Nginx 플러그인을 설치합니다. 기존 인증서 관리 방식을 Snap과 APT 사이에서 자동 변경하지 않습니다.

```bash
sudo ./ubuntu-deploy.sh --skip-certbot
sudo certbot certonly --nginx \
  --cert-name goehsschoolmap.o-r.kr \
  -d goehsschoolmap.o-r.kr \
  --email 담당자@example.com \
  --agree-tos --non-interactive
sudo ./ubuntu-deploy.sh --skip-git
```

기존 `goehsmap.o-r.kr` 인증서 하나에 새 이름을 함께 넣어야 하는 특별한 사유가 있을 때만 아래처럼 기존 인증서를 확장합니다. 기존 인증서를 재발급하는 작업이므로 기본 방식으로는 권장하지 않습니다.

```bash
sudo certbot --nginx \
  --cert-name goehsmap.o-r.kr \
  -d goehsmap.o-r.kr \
  -d goehsschoolmap.o-r.kr
```

## 현재 확인된 상태 (2026-08-20)

- `goehsschoolmap.o-r.kr` A 레코드는 기존 `goehsmap.o-r.kr`과 같은 `168.107.52.85`를 가리킵니다.
- 새 호스트의 443 포트는 기존 Nginx/Express 사이트를 응답하지만, TLS 인증서의 이름이 새 도메인과 일치하지 않습니다.
- 따라서 DNS A 레코드는 이미 설정됐고, 남은 작업은 새 앱을 별도 포트에서 실행하고 Nginx 가상호스트와 인증서를 추가하는 것입니다.

서버 공인 IP가 `168.107.52.85`가 아니라면 먼저 도메인 관리 화면에서 A 레코드를 실제 서버 IP로 수정합니다. TTL은 300초 정도로 두면 전환 확인이 빠릅니다.

## 1. 앱 설치

Ubuntu 서버의 예시 경로는 `/srv/goehsmap-secureversion`입니다.

```bash
sudo useradd --system --home /srv/goehsmap-secureversion --shell /usr/sbin/nologin goehsmap
sudo mkdir -p /srv/goehsmap-secureversion
sudo chown -R goehsmap:goehsmap /srv/goehsmap-secureversion
cd /srv/goehsmap-secureversion
npm ci --omit=dev
cp .env.example .env
```

`.env`에서 `PORT=3001`, `TRUST_PROXY=1`, `NODE_ENV=production`을 유지합니다. 운영 서버에는 `.env.sync`를 복사하지 않습니다.

## 2. systemd 서비스

`deploy/goehsschoolmap.service`를 `/etc/systemd/system/goehsschoolmap.service`로 복사한 다음 실행합니다.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now goehsschoolmap
sudo systemctl status goehsschoolmap
curl http://127.0.0.1:3001/healthz
```

정상 응답은 `{"status":"ok"}`입니다.

## 3. Nginx HTTP 가상호스트

인증서 발급 전 `deploy/nginx-http.conf`를 `/etc/nginx/sites-available/goehsschoolmap`에 복사하고 활성화합니다.

```bash
sudo ln -s /etc/nginx/sites-available/goehsschoolmap /etc/nginx/sites-enabled/goehsschoolmap
sudo nginx -t
sudo systemctl reload nginx
```

같은 이름의 링크가 이미 있으면 새 링크를 만들지 말고 기존 파일 내용을 확인합니다. 이 단계에서 `http://goehsschoolmap.o-r.kr/healthz`가 앱 응답을 반환해야 합니다.

## 4. HTTPS 인증서

80/443 포트를 서버 방화벽과 상위 방화벽에서 허용한 뒤 Certbot Nginx 플러그인으로 인증서를 발급합니다.

```bash
sudo certbot certonly --nginx \
  --cert-name goehsschoolmap.o-r.kr \
  -d goehsschoolmap.o-r.kr
sudo certbot renew --dry-run
```

인증서가 생성된 뒤 `deploy/nginx-https.conf`의 최종 설정으로 교체합니다. `sudo nginx -t` 성공 후 Nginx를 다시 불러옵니다. 자동 설치 스크립트를 사용하면 이 교체까지 자동으로 수행합니다.

## 5. 최종 확인

```bash
curl -I http://goehsschoolmap.o-r.kr/
curl -I https://goehsschoolmap.o-r.kr/
curl https://goehsschoolmap.o-r.kr/healthz
curl -I https://goehsschoolmap.o-r.kr/login
```

기대 결과는 HTTP의 HTTPS 리다이렉트, HTTPS 200, healthz 정상 JSON, `/login` 404입니다. 브라우저 개발자 도구에서 인증서 이름과 만료일, CSP 헤더, 혼합 콘텐츠 오류가 없는지도 확인합니다.

## 6. 데이터 갱신

원본 Sheet 접근은 신뢰할 수 있는 관리 PC에서만 수행합니다.

```bash
npm ci
cp .env.sync.example .env.sync
npm run sync-data
npm run check
npm test
npm audit --omit=dev
```

검증된 `data/public-map-data.json`과 `data/public-share-data.json`만 서버에 반영하고 서비스를 재시작합니다.

```bash
sudo systemctl restart goehsschoolmap
```

## 되돌리기

기존 `goehsmap.o-r.kr` 가상호스트와 포트 3000 서비스는 수정하지 않습니다. 문제가 생기면 새 Nginx 사이트만 비활성화하고 새 서비스를 중지하면 기존 사이트는 영향을 받지 않습니다.
