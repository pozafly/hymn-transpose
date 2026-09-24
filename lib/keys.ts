export const KEYS = [
  { id: "c", label: "C", signature: "조표 없음" },
  { id: "des", label: "D♭", signature: "♭ 5개" },
  { id: "d", label: "D", signature: "♯ 2개" },
  { id: "es", label: "E♭", signature: "♭ 3개" },
  { id: "e", label: "E", signature: "♯ 4개" },
  { id: "f", label: "F", signature: "♭ 1개" },
  { id: "ges", label: "G♭", signature: "♭ 6개" },
  { id: "fis", label: "F♯", signature: "♯ 6개" },
  { id: "g", label: "G", signature: "♯ 1개" },
  { id: "as", label: "A♭", signature: "♭ 4개" },
  { id: "a", label: "A", signature: "♯ 3개" },
  { id: "bes", label: "B♭", signature: "♭ 2개" },
  { id: "b", label: "B", signature: "♯ 5개" },
] as const;

export type KeyId = (typeof KEYS)[number]["id"];
export function isKey(value: unknown): value is KeyId {
  return typeof value === "string" && KEYS.some((key) => key.id === value);
}

const letters = "cdefgab";
const semitones = [0, 2, 4, 5, 7, 9, 11];
function display(letter: number, accidental: number): string {
  const symbols: Record<number, string> = {
    [-2]: "bb",
    [-1]: "♭",
    0: "",
    1: "♯",
    2: "x",
  };
  if (!(accidental in symbols)) throw new Error("표기할 수 없는 코드입니다.");
  return letters[letter].toUpperCase() + symbols[accidental];
}

// Chord text only. LilyPond handles every note and the key signature.
export function chord_labels(key: KeyId) {
  if (!isKey(key)) throw new Error("지원하지 않는 조입니다.");
  const letter = letters.indexOf(key[0]);
  const accidental = key.endsWith("is") ? 1 : key.length > 1 ? -1 : 0;
  const above = (steps: number, distance: number) => {
    const target = (letter + steps) % 7;
    let alteration =
      (((semitones[letter] + accidental + distance - semitones[target]) % 12) +
        12) %
      12;
    if (alteration > 6) alteration -= 12;
    return display(target, alteration);
  };
  const dominant = above(4, 7);
  return {
    I: display(letter, accidental),
    IV: above(3, 5),
    V: dominant,
    V7: dominant + "7",
  };
}

export function fillTemplate(template: string, key: KeyId): string {
  if (!isKey(key)) throw new Error("지원하지 않는 조입니다.");
  let source = template.replaceAll("@KEY@", key);
  for (const [name, label] of Object.entries(chord_labels(key))) {
    source = source.replaceAll(`@${name}@`, label);
  }
  if (/@[A-Z0-9]+@/.test(source))
    throw new Error("템플릿에 알 수 없는 플레이스홀더가 있습니다.");
  return source;
}
