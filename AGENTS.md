# hymn-transpose

찬송가 악보를 원하는 조(key)로 조판해 PDF/PNG로 내려주는 서비스.
악보 엔진은 LilyPond(CLI)를 subprocess로 실행한다.
배경과 전체 맥락은 docs/handoff.md 참고.

## 절대 규칙

- 음표를 직접 계산하지 말 것. LilyPond의 `\transpose` 에 맡긴다.
- `.ly` 템플릿의 `\key` 는 원조(`ges`) 그대로 둔다.
  목표조로 미리 바꿔놓고 transpose를 걸면 조표가 이중 조옮김되어 더블샵이 나온다.
- 코드 심볼은 `@I@ @IV@ @V@ @V7@` 플레이스홀더를 `chord_labels()` 가 치환한다.
  이명동음 철자를 지킨다 (G♭장조 IV = C♭, F♯장조 IV = B).
- 조는 화이트리스트로만 받는다. 사용자 입력 `.ly` 를 그대로 컴파일하지 말 것
  (Guile Scheme 실행 = RCE).
- LilyPond 호출에는 항상 타임아웃을 건다.

## 명령어

python score/build.py --list-keys
python score/build.py --key f --png # dist/hymn67_f.pdf

## 함정

- 컴파일 약 7초. 느린 게 정상이다. (곡, 조) 키로 캐싱하고 등록 시점에 미리 렌더링한다.
- CJK 폰트가 없으면 한글 가사가 에러 없이 조용히 깨진다. 결과물을 눈으로 확인할 것.
- PDF→PNG는 poppler-utils의 pdftoppm. 없으면 PNG만 실패하고 PDF는 정상.

## 하지 말 것

- 이미지 → .ly 자동 변환 시도. omr/ 은 음표머리 위치만 검출한다.
  조표·임시표·음길이·가사는 읽지 않는다.
- .ly 템플릿의 레이아웃 설정(\paper, \layout) 임의 변경. 원본 악보 재현이 목적이다.
