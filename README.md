# hymn-transpose

찬송가 스캔 악보를 데이터로 역추출하고, LilyPond로 원하는 조(key)에 다시 조판하는 코드.

```
.
├── omr/
│   └── detect_noteheads.py    # 이미지 → 음표머리 좌표/음높이 (numpy, scipy, Pillow)
├── score/
│   ├── hymn67.ly.tmpl         # LilyPond 소스 템플릿 (원조 G♭, 코드심볼 플레이스홀더)
│   └── build.py               # 조옮김 + PDF/PNG 컴파일
├── dist/                      # 결과물 (생성됨)
├── requirements.txt
└── Dockerfile
```

두 부분은 **서로 독립**이다. `omr/`은 "악보를 읽어서 음을 알아내는" 도구,
`score/`는 "이미 알고 있는 음을 원하는 조로 찍어내는" 도구다.
원래 작업에서는 `omr/`의 출력을 사람이 보고 `.ly` 템플릿을 손으로 작성했다.
자동으로 이어지지 않는다 — 이유는 아래 **한계**에 적어뒀다.

---

## 설치

```bash
# 로컬
sudo apt install -y lilypond poppler-utils fonts-noto-cjk
pip install -r requirements.txt

# 또는 도커
docker build -t hymn-transpose .
docker run --rm -v "$PWD:/work" hymn-transpose python score/build.py --key f --png
```

---

## 1. score/ — 조옮김 (확실하게 동작하는 부분)

```bash
python score/build.py --list-keys          # 조 목록과 각 조의 코드 이름 미리보기
python score/build.py --key f --png        # F장조
python score/build.py --key fis --key g --key es --png
```

출력:

```
   f -> dist/hymn67_f.pdf   chords: F / B♭ / C / C7
 fis -> dist/hymn67_fis.pdf chords: F♯ / B / C♯ / C♯7
   g -> dist/hymn67_g.pdf   chords: G / C / D / D7
```

`--key`에는 LilyPond(nederlands) 음이름을 쓴다: `c d e f g a b`,
샾은 `-is`(`fis`, `cis`), 플랫은 `-es`(`ges`, `es`, `bes`).

### 동작 원리

**음표는 직접 계산하지 않는다.** 템플릿 맨 아래가 이렇게 돼 있다:

```lilypond
upper = \transpose ges @KEY@ \upperRaw
lower = \transpose ges @KEY@ \lowerRaw
```

LilyPond의 `\transpose 원조 목표조` 가 모든 음정을 이명동음까지 올바르게 재표기해 준다.
`\key ges \major`도 `\upperRaw` 안에 들어 있어서 함께 조옮김되므로
조표도 자동으로 맞는다.

> 삽질 포인트: `\key`를 미리 목표조로 바꿔놓고 `\transpose`를 걸면
> 조표가 두 번 조옮김돼서 더블샵 범벅이 된다. `\key`는 원조 그대로 두는 게 맞다.

**코드 심볼은 문자열이라 `\transpose` 대상이 아니다.** 그래서 템플릿에
`@I@ @IV@ @V@ @V7@` 플레이스홀더를 두고, `build.py`가 계산해서 치환한다.
계산은 단순 반음 산술이 아니라 **철자(spelling)까지 맞춘다**:

```python
# 완전4도 = 계이름 3칸 위 + 반음 5개 위
def interval_above(letter, alter, letter_steps, semitones):
    new_letter = LETTERS[(LETTERS.index(letter) + letter_steps) % 7]
    want = (LETTER_SEMITONE[letter] + alter + semitones) % 12
    diff = (want - LETTER_SEMITONE[new_letter]) % 12
    return new_letter, diff - 12 if diff > 6 else diff
```

덕분에 G♭장조의 IV는 `B`가 아니라 `C♭`로, F♯장조의 IV는 `B`로 제대로 나온다.

### 웹 UI로 감쌀 때

`render()` 함수가 사실상 그대로 API 핸들러가 된다.
입력은 `tonic_ly` 문자열 하나, 출력은 PDF 경로.
서버에서 돌릴 때 주의할 점:

- LilyPond는 **CLI 프로세스**다. 라이브러리가 아니라 `subprocess`로 띄운다.
  Spring Boot라면 `ProcessBuilder`.
- 컴파일에 1~3초 걸린다. 동기 요청으로 물고 있지 말고 작업 큐나 캐시를 두는 게 낫다.
  (조 이름이 키니까 캐시 히트율이 매우 높다)
- **사용자가 `.ly` 소스를 직접 입력하게 만들 거라면 샌드박싱이 필수다.**
  LilyPond 소스는 Guile Scheme을 그대로 실행할 수 있어서 임의 코드 실행이 된다.
  `-dsafe` 옵션이 있지만 완벽하지 않으니, 컨테이너 격리 + 네트워크 차단 +
  타임아웃 + 메모리 제한을 같이 걸어야 한다.
  조(key)만 고르게 하는 구조라면 이 문제는 없다.
- 한글 가사를 쓰려면 컨테이너에 CJK 폰트가 있어야 한다. `Dockerfile` 참고.

---

## 2. omr/ — 스캔 이미지 분석 (보조 도구)

```bash
python omr/detect_noteheads.py score.png --x-min 150 --x-max 1185 \
    --json out.json --debug overlay.png
```

```
=== s1t (treble) lines=[267.0, 280.5, 293.0, 306.0, 319.5]
  x=  195.3  step=  8.84  D4   area= 293 MERGED
  x=  296.7  step=  8.00  E4   area= 127
  x=  297.4  step=  5.05  A4   area= 159
  ...
  x=  565.3  step=  2.95  C5   area=  51 hollow
```

`--debug`로 나오는 오버레이 PNG가 실제로는 제일 유용하다.
검출된 음표머리에 동그라미와 음이름이 찍혀서 눈으로 바로 검증된다.
(빨강 = 검은 음표머리, 초록 = 흰 음표머리, 주황 = 두 음이 붙어 잡힌 덩어리)

### 알고리즘

**오선 검출.** 가로 방향으로 잉크 픽셀을 합산(row projection profile)해서
비율이 높은 행을 찾고, 간격 10~15px인 5줄 묶음을 보표로 인정한다.

**스캔 기울기 보정 — 여기가 정확도의 분기점.**
전역 오선 좌표를 쓰면 계단 인덱스가 정수에서 0.8~1.7씩 어긋난다.
스캔본이 미세하게 회전돼 있기 때문이다.
그래서 음표머리마다 **그 x좌표 좌우 30px 구간에서 오선을 다시 찾는다.**
이것만 바꿔도 오차가 ±0.1 이내로 떨어진다.

**검은 음표머리.** integral image로 7×11 박스 합을 O(1)에 구하고,
채움률 91%(77칸 중 70칸) 이상인 지점만 남긴다.
기둥(stem)은 폭이 3px라 11폭 박스에서 27%밖에 못 채우므로 자동으로 탈락한다.
형태 매칭이나 학습 모델 없이 이 임계값 하나로 걸러진다.

**흰 음표머리(2분·온음표).** 위 필터에 절대 안 걸린다. 반대로 접근한다 —
흰 픽셀을 labeling해서 **이미지 네 모서리와 연결되지 않은 작은 흰 덩어리**,
즉 잉크로 둘러싸인 구멍을 찾는다.
오선이 구멍을 가로지르면 반쪽씩 두 조각으로 잡히므로 가까운 조각끼리 다시 합친다.

**음높이 변환.** `step = (y중심 - 오선첫줄y) / (오선간격/2)`.
0 = 오선 맨 윗줄, 1 = 그 아래 칸… 높은음자리표는 0을 F5, 낮은음자리표는 0을 A3로 두고
계이름 배열에서 꺼낸다. **조표는 반영하지 않는다** — 흰건반 이름만 나온다.

### 한계 (그리고 아까 "범위" 질문의 의미)

이 스크립트가 못 하는 것들:

| 못 하는 것 | 왜 |
|---|---|
| 조표 반영 | 조표를 읽지 않으므로 `E4`가 실제로는 E♭4일 수 있다 |
| 임시표(♯♭♮) | 검출 안 함. 3절의 D♮은 눈으로 보고 넣었다 |
| 음길이 | x좌표 간격과 빔 위치로 사람이 추론했다 |
| 마디선·붙점·이음줄 | 검출 안 함 |
| 가사 | OCR 없음. 눈으로 읽었다 |

그래서 **이미지 → `.ly` 자동 변환은 안 된다.** 이 도구는 좌표를 정확히 뽑아주는
계측기이고, 악보로 조립하는 건 사람 몫이다.

아까 제가 "조옮김만 할지, 이미지 분석까지 넣을지" 물었던 게 이 얘기였습니다.
조옮김은 입력이 이미 정확한 데이터라서 어떤 악보든 100% 동작하지만,
이미지 분석은 악보마다 해상도·기울기·인쇄 상태가 달라서 파라미터를 매번
조정해야 하고 결과도 사람이 검수해야 합니다.
웹 UI로 만든다면 조옮김 쪽이 제품이 되고, 이미지 분석은 "새 악보를 입력할 때
쓰는 관리자용 보조 도구" 포지션이 맞습니다.

전부 자동으로 하고 싶다면 직접 만들 게 아니라 [Audiveris](https://github.com/Audiveris/audiveris)
같은 본격 OMR 엔진을 붙이는 게 맞습니다. MusicXML로 뱉어주니
`musicxml2ly`로 LilyPond 소스로 변환할 수 있고요.
다만 한글 가사가 붙은 저해상도 스캔에서는 오인식이 꽤 나서, 이번엔 직접 짜는 쪽이 빨랐습니다.

---

## 튜닝

`omr/detect_noteheads.py` 상단 상수들이 전부 해상도 의존적입니다.
다른 악보를 넣었는데 검출이 안 되면 이 순서로 보세요.

| 증상 | 손볼 곳 |
|---|---|
| 오선을 못 찾음 | `BINARY_THRESHOLD`, `STAFFLINE_ROW_RATIO`, `STAFFLINE_GAP_MIN/MAX` |
| 음표머리 누락 | `HEAD_FILL_MIN` 낮추기 (70 → 64) |
| 기둥/빔이 음표로 잡힘 | `HEAD_FILL_MIN` 올리기, `HEAD_BOX_W` 넓히기 |
| 두 음이 한 덩어리로 | 정상. `merged=True`로 표시되고 step은 두 음의 중점 |
| 흰 음표머리 누락 | `HOLE_AREA`, `HOLE_H`, `HOLE_W` 범위 넓히기 |
| step이 정수에서 많이 벗어남 | `LOCAL_WINDOW` 조정. 그래도 안 되면 기울기가 심한 것 |

해상도가 크게 다르면 박스 크기를 오선 간격에 비례시키는 게 정석입니다.
지금은 오선 간격 13px 기준으로 하드코딩돼 있습니다.

---

## 라이선스 / 저작권

곡(LYONS, J. M. Haydn 추정 / W. Gardiner 편곡 1815)과 영어 원가사는 퍼블릭 도메인입니다.
한글 가사는 한국찬송가공회 새찬송가 수록본이므로 개인·예배용 범위를 벗어난
배포 전에는 확인이 필요합니다.
