#!/usr/bin/env python3
"""
LilyPond 템플릿을 원하는 조(key)로 조옮김해서 PDF / PNG를 생성한다.

핵심 아이디어
  - 음표를 직접 계산하지 않는다. LilyPond의 \\transpose 에 맡긴다.
  - \\key 는 템플릿에 원조(G♭)로 두고, transpose가 조표까지 알아서 바꾸게 한다.
    (\\key 를 transpose 블록 밖으로 빼거나 미리 바꿔놓으면 이중 조옮김이 나서
     더블샵 범벅이 된다. 실제로 한 번 당한 부분이다.)
  - 코드 심볼은 문자열이라 transpose 대상이 아니므로 @I@/@IV@/@V@/@V7@
    플레이스홀더를 두고 여기서 계산해서 치환한다.

사용법
  python build.py --key f                    # F장조
  python build.py --key fis --key f --key c  # 여러 조 한 번에
  python build.py --key f --png --dpi 200
  python build.py --list-keys
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEMPLATE = HERE / "hymn67.ly.tmpl"
SOURCE_KEY = "ges"          # 템플릿이 작성된 원조

# LilyPond(nederlands) 음이름 <-> (계이름 index, 변화표 반음)
LETTERS = "cdefgab"
LETTER_SEMITONE = {"c": 0, "d": 2, "e": 4, "f": 5, "g": 7, "a": 9, "b": 11}
ACCIDENTAL_DISPLAY = {-2: "bb", -1: "♭", 0: "", 1: "♯", 2: "x"}


def parse_ly_pitch(name: str):
    """'fis' -> ('f', +1),  'ges' -> ('g', -1),  'a' -> ('a', 0)"""
    name = name.strip().lower()
    letter, rest = name[0], name[1:]
    if letter not in LETTERS:
        raise ValueError(f"알 수 없는 음이름: {name}")
    alter = 0
    while rest:
        if rest.startswith("is"):
            alter += 1
            rest = rest[2:]
        elif rest.startswith("es") or rest.startswith("s"):
            alter -= 1
            rest = rest[2:] if rest.startswith("es") else rest[1:]
        else:
            raise ValueError(f"알 수 없는 음이름: {name}")
    return letter, alter


def display_name(letter: str, alter: int) -> str:
    return letter.upper() + ACCIDENTAL_DISPLAY[alter]


def interval_above(letter: str, alter: int, letter_steps: int, semitones: int):
    """
    다이어토닉 음정을 올린 음을 '정확한 철자로' 구한다.
    letter_steps: 계이름 몇 칸 위 (완전4도=3, 완전5도=4)
    semitones:    반음 몇 개 위 (완전4도=5, 완전5도=7)
    """
    i = LETTERS.index(letter)
    new_letter = LETTERS[(i + letter_steps) % 7]
    want = (LETTER_SEMITONE[letter] + alter + semitones) % 12
    natural = LETTER_SEMITONE[new_letter]
    diff = (want - natural) % 12
    if diff > 6:
        diff -= 12
    if abs(diff) > 2:
        raise ValueError(f"표기 불가능한 조: {letter}{alter}")
    return new_letter, diff


def chord_labels(tonic_ly: str) -> dict:
    """으뜸화음(I), 버금딸림(IV), 딸림(V), 딸림7(V7) 코드 이름을 만든다."""
    letter, alter = parse_ly_pitch(tonic_ly)
    i = display_name(letter, alter)
    iv = display_name(*interval_above(letter, alter, 3, 5))
    v = display_name(*interval_above(letter, alter, 4, 7))
    return {"I": i, "IV": iv, "V": v, "V7": v + "7"}


SUGGESTED = {
    "ges": "G♭장조 - 원본 A♭에서 2키 내림 (♭6개)",
    "fis": "F♯장조 - G♭과 같은 소리, 샾 표기 (♯6개)",
    "f":   "F장조  - 3키 내림 (♭1개, 가장 읽기 쉬움)",
    "g":   "G장조  - 1키 내림 (♯1개)",
    "as":  "A♭장조 - 원조",
    "es":  "E♭장조 - 5키 내림",
    "d":   "D장조  - 6키 내림",
}


def render(tonic_ly: str, out_dir: Path, png: bool, dpi: int) -> Path:
    if not TEMPLATE.exists():
        sys.exit(f"템플릿이 없습니다: {TEMPLATE}")
    if shutil.which("lilypond") is None:
        sys.exit("lilypond 실행 파일을 찾을 수 없습니다. (apt install lilypond)")

    labels = chord_labels(tonic_ly)
    src = TEMPLATE.read_text(encoding="utf-8")
    src = src.replace("@KEY@", tonic_ly)
    for k, v in labels.items():
        src = src.replace(f"@{k}@", v)

    out_dir.mkdir(parents=True, exist_ok=True)
    stem = f"hymn67_{tonic_ly}"
    ly_path = out_dir / f"{stem}.ly"
    ly_path.write_text(src, encoding="utf-8")

    subprocess.run(
        ["lilypond", "-dno-point-and-click", "-o", str(out_dir / stem), str(ly_path)],
        check=True,
    )
    pdf = out_dir / f"{stem}.pdf"

    if png:
        if shutil.which("pdftoppm") is None:
            print("pdftoppm 없음 - PNG 건너뜀 (apt install poppler-utils)", file=sys.stderr)
        else:
            subprocess.run(
                ["pdftoppm", "-r", str(dpi), "-png", "-f", "1", "-l", "1",
                 str(pdf), str(out_dir / stem)],
                check=True,
            )
    print(f"{tonic_ly:>4} -> {pdf}   chords: "
          f"{labels['I']} / {labels['IV']} / {labels['V']} / {labels['V7']}")
    return pdf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--key", action="append", default=[],
                    help="LilyPond 음이름으로 쓴 으뜸음. 예: f, fis, ges, es, bes. 여러 번 지정 가능")
    ap.add_argument("--out", default=str(HERE.parent / "dist"))
    ap.add_argument("--png", action="store_true", help="PNG도 같이 생성")
    ap.add_argument("--dpi", type=int, default=200)
    ap.add_argument("--list-keys", action="store_true")
    args = ap.parse_args()

    if args.list_keys:
        for k, desc in SUGGESTED.items():
            c = chord_labels(k)
            print(f"  {k:<4} {desc:<40} {c['I']} {c['IV']} {c['V']} {c['V7']}")
        return

    keys = args.key or ["ges", "fis", "f"]
    for k in keys:
        render(k, Path(args.out), args.png, args.dpi)


if __name__ == "__main__":
    main()
