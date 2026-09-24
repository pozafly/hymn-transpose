# 찬송의 조 · hymn-transpose

찬송가를 원하는 조로 조판해 PDF와 PNG로 내려주는 Next.js + TypeScript 웹앱.
현재 새찬송가 67장 「영광의 왕께 다 경배하며」를 지원한다.

## 실행

Node.js 24 LTS, pnpm 12.5.1과 LilyPond **2.24.3 이상 2.24.x**, Poppler, Fontconfig,
Noto Serif CJK KR / Noto Sans CJK KR 폰트가 필요하다.
기존 템플릿은 LilyPond 2.26과 호환되지 않는다. Docker는 호환 버전이 있는 Debian Trixie를 사용한다.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run dev
# http://localhost:3000/hymns/67
```

macOS에서는 [LilyPond 2.24.4 공식 배포본](https://lilypond.org/doc/v2.24/Documentation/web/download)을 사용한다.
Apple Silicon에서 공식 x86_64 배포본 실행에는 Rosetta가 필요하다.
Homebrew의 최신 LilyPond는 2.26일 수 있으므로 버전을 확인한다.

```sh
brew install poppler fontconfig
brew install --cask font-noto-serif-cjk-kr font-noto-sans-cjk-kr
LILYPOND_BIN=/absolute/path/lilypond-2.24.4/bin/lilypond pnpm run dev
```

Next.js용 `.env.local`에 `LILYPOND_BIN`을 지정할 수도 있다. CLI는 환경변수를 직접 전달한다.

## Docker 배포

```sh
docker compose build
docker compose run --rm app node score/build.ts --all --png
docker compose up -d
```

등록 시 모든 지원 조를 사전 생성한 뒤 앱을 시작한다. `scores` 볼륨에 캐시를 영속 저장한다.
기존 Cloudflare Tunnel이 호스트에서 실행되면 `http://localhost:3000`으로 연결한다.
Tunnel이 별도 컨테이너라면 공통 Docker 네트워크에서 `http://app:3000`으로 연결하도록 운영 스택에 맞게 설정한다.

웹앱 런타임은 Python을 사용하지 않는다. CLI도 Node.js 24로 `node score/build.ts` 실행 가능하다.
앱은 단일 Node 프로세스 기준이다. 여러 인스턴스를 운영할 때는 렌더 작업 잠금/큐를 외부 저장소로 분리해야 한다.

## CLI

```sh
pnpm run score --list-keys
pnpm run score --key f --key ges --key fis --png
pnpm run score --hymn 67 --key f --out dist/scores
pnpm run prerender
```

PDF와 모든 페이지의 PNG를 함께 생성한다. `--png`는 기존 명령과의 호환 옵션이다.
출력은 `dist/scores/<곡>/<조>/<버전>/score.pdf`, `page-1.png` 등이다.
지원 조는 12개 음높이와 G♭/F♯ 별도 표기를 포함한 13개다.

## 기능과 API

- 번호·제목 검색, 조 선택, 확대 미리보기, PDF/PNG 다운로드
- `/hymns/67?key=f` 링크로 곡과 조 공유
- `GET /api/hymns`: 곡 목록과 지원 조
- `POST /api/render`: `{ "hymnId": "67", "key": "f" }` → PDF URL, PNG 페이지 URL
- `GET /api/scores/<곡>/<조>/<버전>/<파일>`: 결과 파일 (`?download=1`로 다운로드)

등록된 곡과 화이트리스트 조만 받는다. 사용자 LilyPond 소스 입력은 제공하지 않는다.
LilyPond와 Poppler는 셸 없이 실행하며 각각 60초 제한을 둔다.
동일 요청은 한 작업으로 합치고, 렌더링은 한 번에 하나만 실행한다.
캐시는 소스와 렌더 설정 버전으로 구분하며 결과 생성 완료 후 공개한다.
PNG 생성 실패 시 PDF를 계속 제공한다. Poppler를 복구한 뒤 해당 캐시 디렉터리를 지우거나
`SCORE_RENDER_VERSION`을 올려 재생성한다.

환경변수:

| 이름 | 기본값 | 용도 |
| --- | --- | --- |
| `SCORE_CACHE_DIR` | `dist/scores` | 결과물 저장 경로 |
| `SCORE_RENDER_VERSION` | `1` | LilyPond·폰트·Poppler 변경 시 올릴 캐시 버전 |
| `LILYPOND_BIN` | `lilypond` | 사용할 LilyPond 실행 파일 |

## 새 곡 등록

1. 검수한 `.ly.tmpl`을 `score/`에 추가하고 `score/catalog.json`에 메타데이터를 등록한다.
2. 템플릿의 원조 `\key`를 유지하고 LilyPond `\transpose`에 음표 조옮김을 맡긴다.
3. 코드 텍스트는 `@I@`, `@IV@`, `@V@`, `@V7@` 플레이스홀더를 사용한다.
4. `pnpm run prerender`로 생성하고 한글 가사·코드·레이아웃을 눈으로 검수한다.

현재 코드 심볼은 장조 I/IV/V/V7만 지원한다. 다른 화음이나 단조 곡은 등록 전에 모델 확장이 필요하다.
템플릿 레이아웃은 원본을 유지하며 임의로 변경하지 않는다.

## 검증

```sh
pnpm test
pnpm run typecheck
pnpm run build
pnpm run test:e2e
```

E2E 테스트는 로컬 렌더링 도구가 필요하다. `LILYPOND_BIN`으로 호환 버전을 지정할 수 있다.

## 구조

- `app/`, `components/`: Next.js 페이지와 API, 반응형 UI
- `lib/keys.ts`: 지원 조, 코드 철자, 템플릿 치환
- `lib/render.ts`: CLI 실행, 폰트 검사, 작업 합치기, 파일 캐시
- `score/build.ts`: Node.js CLI
- `score/catalog.json`, `score/*.ly.tmpl`: 곡 정보와 악보 원본
- `omr/`: 독립적인 Python 음표머리 검출 도구. 웹앱에서는 사용하지 않음

기존 OMR 사용법과 알고리즘은 [참고 문서](docs/omr-reference.md)에 보존했다.
이미지에서 악보를 자동 생성하는 기능은 없다. 공개 배포 전 가사 사용 범위는 [handoff](docs/handoff.md)의 확인 사항을 참고한다.
