# LXC 204 Docker / Cloudflare 배포

작업 경로: 204번 LXC의 `/root/hymn-transpose`.
Proxmox에서는 `pct enter 204`로 들어간다.

## 앱 실행

```sh
cd /root/hymn-transpose
docker compose build
docker compose run --rm app node score/build.ts --all --png
docker compose up -d app
curl -f http://127.0.0.1:3000/api/hymns
```

앱은 LXC의 localhost:3000에만 바인딩된다. 악보 캐시는 `scores` 볼륨에 보관된다.

## Cloudflare 연결

1. Cloudflare에 등록된 도메인에서 Networking > Tunnels로 이동한다.
2. `hymn-transpose`라는 전용 터널을 만들고 해당 터널의 토큰을 준비한다.
3. 아래처럼 `.env`를 만들고 `TUNNEL_TOKEN=` 뒤에 토큰을 넣는다.

```sh
cp .env.example .env
chmod 600 .env
nano .env
docker compose --profile cloudflare up -d
```

4. 터널의 Routes > Add route > Published application에서 원하는 서브도메인을 지정한다.
5. Service type은 HTTP, URL은 `app:3000`으로 지정한다. localhost는 사용하지 않는다.
6. 터널 연결과 `https://<서브도메인>/hymns/67` 접속을 확인한다.

```sh
docker compose --profile cloudflare ps
docker compose logs --tail 50 cloudflared
```

토큰은 `.env`에만 저장한다. `.env`는 Git과 Docker 빌드 컨텍스트에서 제외된다.
토큰을 넣기 전에는 cloudflare 프로필을 실행하지 않는다.
공유기 포트포워딩이나 OPNsense의 WAN 인바운드 허용은 필요하지 않다.

## 업데이트

```sh
git pull --ff-only
docker compose --profile cloudflare up -d --build
```

배포 설정을 수정한 상태라면 Git 변경사항을 먼저 검토하고 커밋한 뒤 pull한다.
`docker compose down -v`는 악보 캐시 볼륨도 삭제하므로 일반 업데이트에 사용하지 않는다.
