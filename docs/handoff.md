# 찬송가 조옮김 서비스 핸드오프

2026-09-23 업데이트. 기존 Python 렌더러를 Next.js + TypeScript / Node.js로 대체했다.

## 목적과 현재 범위

교회 반주자와 찬양팀이 곡과 조를 선택하면 PDF/PNG 악보를 바로 받아보는 웹앱.
태블릿·폰 중심이며 링크로 같은 곡과 조를 공유한다.
현재 67장 한 곡으로 검색, 조 선택, 미리보기, 확대, 다운로드, 링크 복사를 제공한다.
인증과 관리자 화면은 아직 없다.

## 구현

- Next.js App Router + TypeScript. `lib/render.ts`가 `execFile`로 LilyPond와 Poppler를 실행한다.
- 기존 `score/build.py`는 제거했으며 `score/build.ts`로 대체했다.
- 코드 텍스트는 `lib/keys.ts`의 `chord_labels()`가 이명동음 철자를 보존해 치환한다.
- 곡 목록은 `score/catalog.json`, 악보는 기존 `.ly.tmpl`을 사용한다.
- 결과는 `(곡, 조, 소스/렌더 설정 해시)` 경로의 파일 캐시로 관리한다.
- `pnpm run prerender`로 등록 곡의 13개 표기(12개 음높이 + G♭/F♯)를 미리 생성한다.
- 캐시 미스는 온디맨드 처리한다. 단일 프로세스에서 동일 요청을 합치고 작업은 직렬 실행한다.
- PNG는 전체 페이지를 생성한다. PNG만 실패하면 PDF는 계속 제공한다.
- 한글 폰트 누락은 렌더 전에 검사한다. 결과물의 시각 검수도 필요하다.

## 변하지 않는 규칙

음표는 직접 계산하지 않는다. 템플릿의 `\key ges \major`를 유지하고
`\transpose ges @KEY@`에 조옮김을 맡긴다. 레이아웃도 유지한다.
G♭장조의 IV는 C♭, F♯장조의 IV는 B다.
조와 곡은 화이트리스트로 받는다. 사용자 `.ly`를 컴파일하지 않는다.
LilyPond와 Poppler 실행에는 60초 제한이 있다.

## 실행과 배포

상세 명령은 루트 README 참고.
Node.js 24, LilyPond 2.24.3 이상 2.24.x, Poppler, Fontconfig, Noto CJK 폰트가 필요하다.
2.26은 기존 템플릿의 `set-global-fonts` 문법과 호환되지 않는다.
Docker는 Node 24 / Debian Trixie와 해당 배포판의 LilyPond 2.24.4를 사용한다.

배포 환경은 자택 Proxmox VE 위 Ubuntu LXC + Docker Compose + Cloudflare Tunnel.
`docker compose run --rm app node score/build.ts --all --png`로 먼저 렌더하고 앱을 시작한다.
캐시는 Docker 볼륨에 유지된다. 엔진/폰트 변경 시 `SCORE_RENDER_VERSION`을 올린다.
여러 앱 프로세스를 운영하려면 프로세스 간 작업 잠금/큐를 추가해야 한다.

## 이후 단계

- 검수한 찬송가 10~20곡 추가
- 관리자 전용 이미지 업로드 → 검출 오버레이 확인 → 사람이 `.ly` 작성
- 관리자 소스 실행을 허용하기 전 렌더러를 별도 컨테이너로 분리하고 네트워크 차단·리소스 제한·인증 적용

`omr/`의 Python 검출기는 위치·음높이 측정용 독립 도구로 보존했다.
조표·임시표·음길이·가사는 읽지 못하며 이미지 → `.ly` 자동 변환 기능은 아니다.
곡당 수작업과 검수가 필요하다.

원조 관련 과거 설명에는 A♭과 템플릿 기준 G♭이 혼재했다.
웹 UI는 G♭을 '기본'으로 표시하며 출판 원조나 원조 대비 이동량을 단정하지 않는다.

## 공개 전 확인 사항

기존 조사에서는 곡 LYONS와 영어 원가사를 퍼블릭 도메인으로 분류했다.
한국어 가사는 새찬송가 수록본이므로 공개 배포 가능 범위를 별도로 확인해야 한다.
