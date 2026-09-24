# 유나와 함께 찬송을 · hymn-transpose

가족용 개인 악보 보관함. 기본 찬송가 검색과 사진 분석, 여러 조의 PDF·PNG 생성을 지원한다.
Next.js + Node.js + pnpm, 사진 분석 Audiveris(Java), 조옮김 LilyPond 구성이다.
웹앱과 작업 실행 경로는 Python을 사용하지 않는다.

## 실행

```sh
cp .env.example .env
# APP_PASSWORD를 충분히 긴 개인 비밀번호로 변경한다. 기존 .env는 덮어쓰지 않는다.
docker compose up -d --build
# http://localhost:3000/login
```

JWT가 아닌 HttpOnly 쿠키 + SQLite 서버 세션(30일)이다. 로그아웃하면 해당 세션을 삭제하고,
비밀번호를 바꾸고 앱을 재시작하면 기존 세션이 무효화된다. 화면·API·원본·PDF·PNG 모두 인증한다.
HTTPS 운영 시 `.env`의 `COOKIE_SECURE=true`를 설정한다.

배포 대상은 Proxmox 위 Ubuntu + Docker Compose + Cloudflare Tunnel이다.
호스트 Tunnel은 `http://localhost:3000`, 별도 컨테이너 Tunnel은 앱과 공통 네트워크를 구성해
`http://app:3000`에 연결한다. worker는 공식 Audiveris Linux 배포본에 맞춰 linux/amd64를 사용한다.
Apple Silicon에서는 에뮬레이션 비용이 있다. worker는 네트워크 차단, 메모리 3GB, CPU 2개 제한이다.
앱 1개 + worker 1개 구성이며 worker를 여러 개로 늘리지 않는다.

## 사진과 보관함

1. 사진 추가 화면에서 JPG·PNG·WebP 한 장과 제목, 선택적 찬송가 번호, 생성할 조들을 선택한다.
2. 분석이 끝나면 원본과 미리보기를 대조한다. 필요하면 원곡의 장·단조를 보정한다.
3. 확인 버튼을 누르면 선택한 조들을 생성한다. 완료된 조는 다시 접속해도 남아 있다.

최대 12MiB, 3,200만 픽셀, 한 곡의 한 페이지를 지원한다. PDF·HEIC·다중 페이지는 미지원이다.
같은 번호라도 기본 악보와 업로드, 반복 업로드는 각각 별도 검색 결과다.
제목·번호 수정과 실패 재시도를 지원한다. 음표 편집기는 아직 없다.

OMR은 인식 오류가 있다. 음표·가사·임시표·음길이·성부·코드를 원본과 대조해야 한다.
실제 연결 시험에는 67장 PDF의 300DPI 이미지가 사용되었다. 카메라 사진 정확도를 보장하지 않는다.
MusicXML 미지원 표기는 경고하거나 변환을 거절하며 원본 레이아웃의 완전 재현은 보장하지 않는다.
기존 67장 LilyPond 템플릿의 원조·레이아웃은 그대로 유지한다.

## 저장과 서버 이전

- Compose `library` 볼륨: SQLite, 세션, 작업, 업로드 원본, MusicXML, 가져온 MuseScore 원본.
- Compose `scores` 볼륨: PDF·PNG와 렌더 캐시.
- 로컬 실행 기본 경로: `data/`, `dist/scores/`.

이 자료와 `.env`, 테스트 결과는 Git 및 Docker 빌드 컨텍스트에서 제외된다.
**Git으로 코드를 옮겨도 악보와 비밀번호는 옮겨지지 않는다.** 서버에서 다시 가져오기하거나
앱·worker를 중지하고 두 볼륨을 함께 백업·복원한다. 실행 중인 SQLite 파일만 복사하지 않는다.
Docker Linux 볼륨의 SQLite를 macOS 프로세스로 직접 열지 않는다.
`docker compose down -v`는 자료를 삭제하므로 보관 중에는 사용하지 않는다.

## 캐시 유효성 검사

악보 조회, 렌더 요청, PDF·PNG 요청은 저장된 결과의 버전과 실제 파일을 확인한다.
소스 내용·제목·장단조·렌더 설정이 바뀌거나 PDF·PNG·manifest가 없으면 해당 조를 다시 생성한다.
현재 설정과 일치하는 기존 파일은 그대로 재사용하며, 전체 찬송가를 일괄 재생성하지 않는다.
기본 목록만 검색하면 생성 작업을 시작하지 않는다. 상세 조회와 `/api/library` 결과 조회는 필요한 복구 작업을 등록할 수 있다.

LilyPond·폰트·출력 설정을 바꿀 때 `.env`의 `SCORE_RENDER_VERSION`을 올리고 앱과 worker를 함께 재시작한다.
Compose가 두 컨테이너에 같은 값을 전달한다. 새 결과를 조회할 때 기존 DB 주소도 함께 갱신한다.
작업에는 악보 세대 정보를 기록하며, 이전 세대의 완료·오류는 새 결과를 덮어쓰지 못한다.
실패한 작업은 같은 설정에서 조회할 때마다 무한 재시도하지 않으며 수동 재시도 또는 설정 변경으로 다시 시도한다.
PNG 생성 실패 시 PDF를 유지하는 기존 동작도 보존한다.

완성 파일은 임시 폴더에서 만든 뒤 교체한다. 이전 URL은 준비된 최신 버전으로 연결하며,
복구 중인 결과에는 HTTP 202를 반환한다. 브라우저·공유 캐시는 `private, no-store`를 사용한다.
원본과 구버전 파일의 자동 삭제는 하지 않는다. 파일 정리는 캐시 유효성 검사와 별도 운영 작업이다.

## 기본 찬송가 가져오기와 80곡 검사

원본과 사용 범위는 [조사 문서](docs/score-source-research.md)를 참고한다.
원본 ZIP은 저장소 밖에 두며 파일명은 `1-100.zip` 같은 형식이다.
MuseScore → MusicXML 변환은 등록 시에만 필요하다.

```sh
docker build -f Dockerfile.import -t hymn-import .
# /absolute/path/to/zips를 실제 ZIP 폴더로 변경한다.
# 볼륨 이름의 프로젝트 접두사는 docker volume ls로 확인한다.
docker run --rm --network none \
  -v hymn-transpose_library:/app/data \
  -v /absolute/path/to/zips:/sources:ro \
  -e IMPORT_ONLY="$(seq -s, 1 80)" \
  hymn-import node scripts/import-hymns.ts /sources

# 실행 중인 worker에 1~80장 각각 기본 조 하나만 요청하고 검사한다.
docker compose exec worker node scripts/verify-library.ts 80
```

`IMPORT_ONLY`를 생략하면 전체 등록을 시도한다. 기존 등록과 기존 템플릿 67장은 건너뛴다.
등록 시 모든 조를 렌더하지 않으며 필요한 조만 생성한다.
보고서는 `library` 볼륨의 `verification-80.json`, `import-report.json`이다.
변환기는 MuseScore 3.2의 강제 열기 옵션을 사용하므로 호환성 경고와 변환 실패를 확인한다.
원본과 변환 후 음표 수를 대조하지만 음악 내용 전체를 검수한 것은 아니다.

## 개발과 검증

Node.js 24, pnpm 12.5.1, LilyPond 2.24.3 이상 2.24.x, Poppler, Fontconfig,
Noto Serif CJK KR / Noto Sans CJK KR가 필요하다. 기존 템플릿은 LilyPond 2.26과 호환되지 않는다.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm run dev
pnpm run worker
```

로컬 worker에는 Audiveris와 한국어·영어 Tesseract 언어 데이터가 필요하다.
앱과 worker는 같은 저장 경로를 사용해야 한다. 로컬 앱과 Docker worker의 DB를 혼용하지 않는다.

```sh
pnpm test
pnpm run typecheck
pnpm run build
TEST_BASE_URL=http://127.0.0.1:3000 pnpm run test:e2e
```

E2E는 `.env`의 비밀번호로 로그인하며 실제 worker가 필요하다.
기본 입력은 앱의 67장 PDF를 로컬 `pdftoppm`으로 300DPI 변환해 만든다.
`OMR_TEST_IMAGE=/absolute/path/photo.png`로 다른 사진을 지정할 수 있다.
테스트 악보는 개인 보관함에 남고 테스트 파일은 `test-results/`에만 저장된다.

## 환경변수와 구조

| 이름 | 기본값 | 용도 |
| --- | --- | --- |
| `APP_PASSWORD` | 없음, 필수 | 로그인 비밀번호 |
| `COOKIE_SECURE` | `false` | HTTPS 운영 시 `true` |
| `APP_DATA_DIR` | `data` | SQLite·원본 경로 |
| `SCORE_CACHE_DIR` | `dist/scores` | PDF·PNG 캐시 |
| `SCORE_RENDER_VERSION` | `1` | 엔진·폰트 변경 시 캐시 버전 |
| `LILYPOND_BIN` | `lilypond` | LilyPond 실행 파일 |
| `AUDIVERIS_BIN` | `/opt/audiveris/bin/Audiveris` | OMR 실행 파일 |

- `lib/musicxml.ts`: MusicXML 검증, 허용 문법의 LilyPond 생성. 조옮김은 `\transpose`에 맡긴다.
- `lib/store.ts`, `lib/worker.ts`: SQLite 작업 큐와 중단 작업 복구.
- `lib/auth.ts`: 쿠키 세션과 요청 출처 검사.
- `lib/render.ts`, `lib/command.ts`: 캐시, CLI 시간 제한과 프로세스 그룹 종료.
- `score/build.ts`: 기존 템플릿 CLI. `pnpm run score --key f --png`.
- `omr/`: 과거 Python 음표머리 검출 참고 자료. 앱에서는 사용하지 않는다.

LilyPond·Poppler는 각 60초, 사진 분석은 180초 제한이다.
사용자 `.ly`는 실행하지 않고 조는 화이트리스트로 제한한다.
