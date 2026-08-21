# goehsschoolmap 간단 배포

앱 배포와 도메인 연결을 분리합니다. `goehsschoolmap.sh`는 GitHub 동기화, 패키지 설치, 검사, PM2 실행만 담당합니다. Nginx와 Let's Encrypt는 아래 명령으로 한 번만 수동 설정합니다.

## 1. 앱 업데이트 및 실행

기본 프로젝트 경로는 `/home/ubuntu/hawo/hms`, 앱 이름은 `goehsschoolmap`, 전용 포트는 `3001`입니다. 기존 `goehsmap`의 포트 `3000`은 건드리지 않습니다.

```bash
cd /home/ubuntu/hawo/hms
chmod +x goehsschoolmap.sh
sudo ./goehsschoolmap.sh
```

프로젝트 경로가 다를 때만 다음처럼 실행합니다.

```bash
sudo PROJECT_DIR=/실제/프로젝트/경로 ./goehsschoolmap.sh
```

현재 서버처럼 PM2가 root에만 설치된 경우 `sudo ./goehsschoolmap.sh`로 실행합니다. sudo 실행 시 Git·npm 작업은 원래 호출한 `ubuntu` 사용자로 처리하고, PM2만 root 계정으로 실행합니다. 이후에도 일반 PM2와 root PM2를 섞지 말고 아래처럼 `sudo pm2`만 사용하세요. 또한 PM2에 셸 파일을 등록하지 마세요. 스크립트가 `server.js`만 등록합니다.

일상적인 관리 명령은 다음 네 개면 충분합니다.

```bash
sudo pm2 status
sudo pm2 logs goehsschoolmap --lines 100
sudo pm2 restart goehsschoolmap
sudo pm2 stop goehsschoolmap
```

새 Git 커밋까지 반영하려면 단순 `sudo pm2 restart`가 아니라 다시 `sudo ./goehsschoolmap.sh`를 실행합니다.

스크립트는 `origin`을 공개 보안 저장소로 고정하고 추적 파일을 `main`과 강제 동기화합니다. 서버에서 직접 수정한 추적 파일은 없어지므로 운영 서버에서 코드를 직접 수정하지 않습니다. `.env`와 Git 미추적 파일은 자동 삭제하지 않습니다.

## 2. 기존 도메인 중복 확인

먼저 활성 Nginx 설정에 새 도메인이 여러 번 들어가 있지 않은지 확인합니다.

```bash
sudo grep -RInE 'server_name.*(goehsmap\.o-r\.kr|goehsschoolmap\.o-r\.kr)' \
  /etc/nginx/sites-enabled /etc/nginx/conf.d
```

기존 `goehsmap` 설정에 두 도메인이 같이 적혀 있다면 해당 원본 파일을 엽니다.

```bash
sudo nano /etc/nginx/sites-available/기존파일명
```

아래처럼 기존 도메인만 남기고 `goehsschoolmap.o-r.kr` 문자열만 제거합니다.

```nginx
server_name goehsmap.o-r.kr;
```

새 도메인을 가진 다른 활성 설정이 또 있다면 그 파일의 `server` 블록을 제거하거나, 해당 사이트 심볼릭 링크를 비활성화한 뒤 다음 단계로 진행합니다. 기존 `goehsmap` 블록, 포트 3000, 기존 인증서 경로는 수정하지 않습니다.

## 3. HTTP Nginx 설정

저장소에 포함된 HTTP 설정을 수동으로 설치합니다. 이 설정은 새 도메인만 `127.0.0.1:3001`로 전달합니다.

```bash
cd /home/ubuntu/hawo/hms
sudo install -m 0644 deploy/nginx-http.conf /etc/nginx/sites-available/goehsschoolmap
sudo ln -sfn /etc/nginx/sites-available/goehsschoolmap \
  /etc/nginx/sites-enabled/goehsschoolmap
sudo nginx -t
sudo systemctl reload nginx
curl -H 'Host: goehsschoolmap.o-r.kr' http://127.0.0.1/healthz
```

마지막 명령이 `{"status":"ok"}`를 반환한 뒤 인증서를 발급합니다. DNS A 레코드가 이 서버를 가리키고 외부 80/443 포트가 열려 있어야 합니다.

## 4. Let's Encrypt 인증서 수동 연결

기존 사이트 인증서에 도메인을 합치지 않고, 새 이름의 전용 인증서를 발급합니다.

```bash
sudo certbot certonly --nginx \
  --cert-name goehsschoolmap.o-r.kr-isolated \
  -d goehsschoolmap.o-r.kr \
  --email 담당자@example.com \
  --agree-tos
```

인증서 목록과 실제 저장 경로를 확인합니다.

```bash
sudo certbot certificates
sudo ls -l /etc/letsencrypt/live/goehsschoolmap.o-r.kr-isolated/
```

이제 저장소의 HTTPS 설정으로 직접 교체합니다.

```bash
cd /home/ubuntu/hawo/hms
sudo install -m 0644 deploy/nginx-https.conf /etc/nginx/sites-available/goehsschoolmap
sudo nginx -t
sudo systemctl reload nginx
sudo certbot renew --dry-run
```

`deploy/nginx-https.conf`의 핵심 인증서 경로는 다음 두 줄입니다.

```nginx
ssl_certificate /etc/letsencrypt/live/goehsschoolmap.o-r.kr-isolated/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/goehsschoolmap.o-r.kr-isolated/privkey.pem;
```

`certbot certificates`가 다른 경로를 출력했다면 `/etc/nginx/sites-available/goehsschoolmap`을 `sudo nano`로 열어 위 두 경로만 실제 값으로 바꾼 후 `sudo nginx -t && sudo systemctl reload nginx`를 실행합니다. `/etc/letsencrypt/renewal/*.conf`는 직접 편집하지 않습니다. 인증서 구성 변경은 항상 `certbot` 명령으로 처리해야 자동 갱신이 유지됩니다.

## 5. 최종 확인

```bash
curl -I http://goehsschoolmap.o-r.kr/
curl -I https://goehsschoolmap.o-r.kr/
curl https://goehsschoolmap.o-r.kr/healthz
curl -sS -o /dev/null -w '/login=%{http_code}\n' \
  https://goehsschoolmap.o-r.kr/login
```

정상 결과는 HTTP→HTTPS 리다이렉트, `/healthz` 정상 JSON, `/login=404`입니다.

## Bad Gateway가 다시 뜰 때

무작정 PM2나 프로세스를 전부 종료하지 말고 먼저 실제 점유자를 확인합니다.

```bash
sudo pm2 status
sudo pm2 describe goehsschoolmap
sudo ss -ltnp 'sport = :3001'
curl -i http://127.0.0.1:3001/healthz
sudo tail -n 100 /var/log/nginx/error.log
```

PM2의 `script path`가 `server.js`가 아니라 `.sh`라면 잘못 등록된 것입니다. 다음 명령으로 복구합니다.

```bash
sudo pm2 delete goehsschoolmap
cd /home/ubuntu/hawo/hms
sudo ./goehsschoolmap.sh
```
