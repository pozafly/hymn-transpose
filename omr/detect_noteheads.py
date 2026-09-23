#!/usr/bin/env python3
"""
악보 스캔 이미지에서 음표머리(notehead) 위치를 검출하고 음높이로 변환한다.

파이프라인
  1) 이진화
  2) 오선(staff) 자동 검출 - row projection profile
  3) 검은 음표머리: integral image 기반 box filter (채움률 임계값)
  4) 흰 음표머리(2분/온음표): 배경과 연결되지 않은 '구멍' 검출
  5) 각 음표머리 x위치에서 오선을 국소 재검출 -> 계단 인덱스 -> 음이름

사용법
  python detect_noteheads.py score.png                 # 사람이 읽는 표
  python detect_noteheads.py score.png --json out.json # JSON
  python detect_noteheads.py score.png --debug ov.png  # 검출 결과 오버레이 이미지

의존성: numpy, scipy, Pillow
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, asdict

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

# ─────────────────────────────────────────────────────────────
# 튜닝 파라미터 (스캔 해상도에 따라 조정)
# ─────────────────────────────────────────────────────────────
BINARY_THRESHOLD = 160      # 이 값보다 어두우면 '잉크'로 간주
STAFFLINE_ROW_RATIO = 0.55  # 오선으로 인정할 가로 방향 잉크 비율
STAFFLINE_GAP_MIN = 10.0    # 오선 간격 허용 범위(px)
STAFFLINE_GAP_MAX = 15.5
HEAD_BOX_H = 3              # box filter 반높이 -> 실제 높이 2*3+1 = 7
HEAD_BOX_W = 5              # box filter 반너비 -> 실제 너비 2*5+1 = 11
HEAD_FILL_MIN = 70          # 7*11=77칸 중 70칸 이상이 잉크여야 음표머리
HEAD_MIN_PIXELS = 25        # 너무 작은 노이즈 제거
HOLE_AREA = (8, 90)         # 흰 음표머리 안쪽 구멍의 면적 범위
HOLE_H = (3, 10)            # 구멍의 세로 크기 범위
HOLE_W = (4, 14)            # 구멍의 가로 크기 범위
HOLE_MIN_AREA_TRUST = 25    # 이보다 작은 구멍은 '오선에 잘린 반쪽'으로 간주
LOCAL_WINDOW = 30           # 오선 국소 재검출 시 좌우로 볼 폭(px)

# 오선 맨 윗줄을 인덱스 0으로 두고 반칸씩 내려가며 음이름을 붙인다.
TREBLE_NAMES = ["F5", "E5", "D5", "C5", "B4", "A4", "G4",
                "F4", "E4", "D4", "C4", "B3", "A3", "G3", "F3"]
BASS_NAMES = ["A3", "G3", "F3", "E3", "D3", "C3", "B2",
              "A2", "G2", "F2", "E2", "D2", "C2", "B1", "A1"]


@dataclass
class Staff:
    """오선 5줄. lines[0]이 맨 윗줄."""
    name: str
    lines: list          # [y0..y4]
    clef: str            # 'treble' | 'bass'

    @property
    def top(self) -> float:
        return self.lines[0]

    @property
    def half_step(self) -> float:
        """반칸(= 오선 간격의 절반) 픽셀 수. 계단 인덱스 1칸에 해당."""
        return (self.lines[4] - self.lines[0]) / 8.0


@dataclass
class Notehead:
    staff: str
    x: float
    y: float
    step: float          # 오선 맨 윗줄 기준 계단 인덱스 (0=윗줄, 1=그 아래 칸, ...)
    pitch: str           # 음이름 (조표 미반영 - 흰건반 이름)
    filled: bool         # True=검은 음표머리, False=흰 음표머리
    area: int
    merged: bool         # 두 음이 기둥으로 붙어 한 덩어리로 잡힌 경우


# ─────────────────────────────────────────────────────────────
# 1) 이진화
# ─────────────────────────────────────────────────────────────
def load_binary(path: str):
    img = Image.open(path).convert("L")
    arr = np.array(img)
    return arr, (arr < BINARY_THRESHOLD)


# ─────────────────────────────────────────────────────────────
# 2) 오선 자동 검출
# ─────────────────────────────────────────────────────────────
def _group_runs(indices, max_gap=2):
    """연속(또는 max_gap 이내) 인덱스를 묶는다."""
    groups, cur = [], [indices[0]]
    for v in indices[1:]:
        if v - cur[-1] <= max_gap:
            cur.append(v)
        else:
            groups.append(cur)
            cur = [v]
    groups.append(cur)
    return groups


def find_staves(dark, x_lo=None, x_hi=None):
    """가로 방향 잉크 비율이 높은 행 = 오선. 5줄씩 묶어 보표로 만든다."""
    h, w = dark.shape
    x_lo = x_lo if x_lo is not None else int(w * 0.15)
    x_hi = x_hi if x_hi is not None else int(w * 0.92)

    profile = dark[:, x_lo:x_hi].sum(axis=1)
    threshold = (x_hi - x_lo) * STAFFLINE_ROW_RATIO
    rows = np.where(profile > threshold)[0]
    if len(rows) == 0:
        raise RuntimeError("오선을 찾지 못했습니다. BINARY_THRESHOLD를 조정해 보세요.")

    line_ys = [float(np.mean(g)) for g in _group_runs(rows)]

    staves, i = [], 0
    while i + 4 < len(line_ys):
        five = line_ys[i:i + 5]
        gaps = [five[j + 1] - five[j] for j in range(4)]
        if all(STAFFLINE_GAP_MIN < g < STAFFLINE_GAP_MAX for g in gaps):
            staves.append(five)
            i += 5
        else:
            i += 1

    # 대보표(grand staff) 가정: 위/아래가 번갈아 나온다 -> 높은음/낮은음자리표
    out = []
    for n, five in enumerate(staves):
        clef = "treble" if n % 2 == 0 else "bass"
        out.append(Staff(name=f"s{n // 2 + 1}{'t' if clef == 'treble' else 'b'}",
                         lines=five, clef=clef))
    return out


def local_staff_lines(dark, staff: Staff, xc: float):
    """
    스캔 기울기 보정의 핵심.
    전역 오선 좌표 대신, 음표머리 주변 좌우 LOCAL_WINDOW px 안에서 오선을 다시 찾는다.
    """
    h, w = dark.shape
    x0 = max(int(xc) - LOCAL_WINDOW, 0)
    x1 = min(int(xc) + LOCAL_WINDOW, w)
    y0 = max(int(staff.top) - 18, 0)
    y1 = min(int(staff.lines[4]) + 18, h)

    seg = dark[y0:y1, x0:x1]
    profile = seg.sum(axis=1)
    rows = np.where(profile > (x1 - x0) * 0.60)[0]
    if len(rows) < 5:
        return None

    cand = sorted(float(np.mean(g)) + y0 for g in _group_runs(rows))
    for i in range(len(cand) - 4):
        five = cand[i:i + 5]
        gaps = [five[j + 1] - five[j] for j in range(4)]
        if all(STAFFLINE_GAP_MIN < g < STAFFLINE_GAP_MAX for g in gaps):
            return five
    return None


def to_step(dark, staff: Staff, xc: float, yc: float):
    """y 픽셀 -> 계단 인덱스. 국소 오선을 못 찾으면 전역 오선으로 폴백."""
    five = local_staff_lines(dark, staff, xc)
    if five is None:
        return (yc - staff.top) / staff.half_step, False
    return (yc - five[0]) / ((five[4] - five[0]) / 8.0), True


def step_to_pitch(step: float, clef: str) -> str:
    names = TREBLE_NAMES if clef == "treble" else BASS_NAMES
    i = int(round(step))
    if 0 <= i < len(names):
        return names[i]
    # 오선 위/아래로 벗어난 경우 계이름을 외삽한다
    base = names[0]
    letter_pos = "CDEFGAB".index(base[0])
    octave = int(base[1])
    absolute = octave * 7 + letter_pos - i
    return "CDEFGAB"[absolute % 7] + str(absolute // 7)


# ─────────────────────────────────────────────────────────────
# 3) 검은 음표머리
# ─────────────────────────────────────────────────────────────
def _box_sum(integral, h, w, kh, kw):
    ys, xs = np.arange(h), np.arange(w)
    y0, y1 = np.clip(ys - kh, 0, h), np.clip(ys + kh + 1, 0, h)
    x0, x1 = np.clip(xs - kw, 0, w), np.clip(xs + kw + 1, 0, w)
    return (integral[np.ix_(y1, x1)] - integral[np.ix_(y0, x1)]
            - integral[np.ix_(y1, x0)] + integral[np.ix_(y0, x0)])


def detect_filled(dark):
    """
    7x11 박스 안 잉크가 HEAD_FILL_MIN(=91%) 이상인 지점만 남긴다.
    기둥(stem)은 폭 3px라 11폭 박스에서 27%밖에 못 채우므로 자동으로 탈락한다.
    세로로 붙은 덩어리는 row 클러스터로 다시 쪼갠다.
    """
    h, w = dark.shape
    integral = np.pad(dark.astype(np.int64).cumsum(0).cumsum(1), ((1, 0), (1, 0)))
    score = _box_sum(integral, h, w, HEAD_BOX_H, HEAD_BOX_W)

    labels, n = ndimage.label(score >= HEAD_FILL_MIN)
    out = []
    for i in range(1, n + 1):
        ys, xs = np.where(labels == i)
        if len(ys) < HEAD_MIN_PIXELS:
            continue
        rows = sorted(set(ys.tolist()))
        for g in _group_runs(rows):
            sel = np.isin(ys, g)
            if sel.sum() < HEAD_MIN_PIXELS:
                continue
            out.append((float(xs[sel].mean()), float(ys[sel].mean()), int(sel.sum())))
    return out


# ─────────────────────────────────────────────────────────────
# 4) 흰 음표머리 (2분음표 / 온음표)
# ─────────────────────────────────────────────────────────────
def detect_hollow(dark):
    """
    흰 음표머리는 '잉크로 둘러싸인 흰 구멍'이다.
    배경(이미지 네 모서리와 연결된 흰 영역)이 아닌 작은 흰 덩어리를 찾는다.
    오선이 구멍을 가로지르면 반쪽씩 두 개로 잡히므로, 가까운 조각끼리 다시 합친다.
    """
    h, w = dark.shape
    labels, n = ndimage.label(~dark)
    background = {labels[0, 0], labels[0, w - 1], labels[h - 1, 0], labels[h - 1, w - 1]}

    slices = ndimage.find_objects(labels)
    pieces = []
    for i in range(1, n + 1):
        if i in background:
            continue
        sl = slices[i - 1]
        bh = sl[0].stop - sl[0].start
        bw = sl[1].stop - sl[1].start
        if not (HOLE_H[0] <= bh <= HOLE_H[1] and HOLE_W[0] <= bw <= HOLE_W[1]):
            continue
        ys, xs = np.where(labels[sl] == i)
        area = len(ys)
        if not (HOLE_AREA[0] <= area <= HOLE_AREA[1]):
            continue
        pieces.append([float(xs.mean() + sl[1].start),
                       float(ys.mean() + sl[0].start), area])

    # 오선에 잘린 반쪽 조각 병합
    pieces.sort(key=lambda p: (p[0], p[1]))
    merged, used = [], [False] * len(pieces)
    for a in range(len(pieces)):
        if used[a]:
            continue
        xa, ya, aa = pieces[a]
        if aa >= HOLE_MIN_AREA_TRUST:
            merged.append((xa, ya, aa))
            used[a] = True
            continue
        partner = None
        for b in range(a + 1, len(pieces)):
            if used[b]:
                continue
            xb, yb, ab = pieces[b]
            if abs(xb - xa) <= 12 and 2 <= abs(yb - ya) <= 12 and ab < HOLE_MIN_AREA_TRUST:
                partner = b
                break
        if partner is None:
            continue  # 짝 없는 작은 조각은 오선 틈새 노이즈로 보고 버린다
        xb, yb, ab = pieces[partner]
        used[a] = used[partner] = True
        merged.append(((xa + xb) / 2, (ya + yb) / 2, aa + ab))
    return merged


# ─────────────────────────────────────────────────────────────
# 조립
# ─────────────────────────────────────────────────────────────
def assign_staff(staves, yc):
    return min(staves, key=lambda s: abs(yc - (s.top + s.lines[4]) / 2))


def analyze(path, x_min=0, x_max=None, merged_area=250):
    arr, dark = load_binary(path)
    h, w = dark.shape
    x_max = x_max if x_max is not None else w
    staves = find_staves(dark)

    heads = []
    for xc, yc, area in detect_filled(dark):
        heads.append((xc, yc, area, True))
    for xc, yc, area in detect_hollow(dark):
        heads.append((xc, yc, area, False))

    out = []
    for xc, yc, area, filled in heads:
        if not (x_min <= xc <= x_max):
            continue
        staff = assign_staff(staves, yc)
        # 보표 위아래로 보조선 두세 칸까지는 허용
        if not (staff.top - 36 <= yc <= staff.lines[4] + 36):
            continue
        step, _ = to_step(dark, staff, xc, yc)
        out.append(Notehead(
            staff=staff.name, x=round(xc, 1), y=round(yc, 1),
            step=round(step, 2), pitch=step_to_pitch(step, staff.clef),
            filled=filled, area=area,
            merged=bool(filled and area >= merged_area),
        ))
    out.sort(key=lambda n: (n.staff, n.x))
    return staves, out


def draw_debug(path, staves, heads, out_path):
    img = Image.open(path).convert("RGB")
    d = ImageDraw.Draw(img)
    for s in staves:
        for y in s.lines:
            d.line([(0, y), (img.width, y)], fill=(160, 200, 255), width=1)
    for n in heads:
        color = (220, 30, 30) if n.filled else (30, 140, 30)
        if n.merged:
            color = (230, 140, 0)
        d.ellipse([n.x - 8, n.y - 6, n.x + 8, n.y + 6], outline=color, width=2)
        d.text((n.x - 8, n.y - 20), n.pitch, fill=color)
    img.save(out_path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("--json", help="검출 결과를 JSON으로 저장")
    ap.add_argument("--debug", help="검출 결과 오버레이 PNG 저장")
    ap.add_argument("--x-min", type=float, default=0,
                    help="이 x좌표 왼쪽은 무시 (음자리표/조표 영역 제외용)")
    ap.add_argument("--x-max", type=float, default=None)
    args = ap.parse_args()

    staves, heads = analyze(args.image, args.x_min, args.x_max)

    print(f"# 보표 {len(staves)}개, 음표머리 {len(heads)}개", file=sys.stderr)
    current = None
    for n in heads:
        if n.staff != current:
            s = next(s for s in staves if s.name == n.staff)
            print(f"\n=== {n.staff} ({s.clef}) lines={[round(v,1) for v in s.lines]}")
            current = n.staff
        flag = " MERGED" if n.merged else ("" if n.filled else " hollow")
        print(f"  x={n.x:7.1f}  step={n.step:6.2f}  {n.pitch:<3}  area={n.area:4d}{flag}")

    if args.json:
        payload = {
            "staves": [asdict(s) | {"half_step": round(s.half_step, 3)} for s in staves],
            "noteheads": [asdict(n) for n in heads],
        }
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print(f"# JSON -> {args.json}", file=sys.stderr)

    if args.debug:
        draw_debug(args.image, staves, heads, args.debug)
        print(f"# overlay -> {args.debug}", file=sys.stderr)


if __name__ == "__main__":
    main()
