import { XMLParser, XMLValidator } from "fast-xml-parser";
import { unzipSync, strFromU8 } from "fflate";
import { isKey, type KeyId } from "./keys.ts";

// Ordered XML is essential: backup/forward change the cursor between voices.
type X = Record<string, any>;
const children = (x: X, name: string): X[] => x[name] || [];
const all = (xs: X[], name: string): X[] => xs.filter((x) => name in x);
const one = (xs: X[], name: string): X[] =>
  children(all(xs, name)[0] || {}, name);
const val = (xs: X[], name: string, fallback = ""): string => {
  const n = one(xs, name);
  return n.map((x) => x["#text"] ?? "").join("") || fallback;
};
const attr = (x: X, key: string, fallback = ""): string =>
  String(x[":@"]?.[`@_${key}`] ?? fallback);
const has = (xs: X[], name: string) => xs.some((x) => name in x);
const num = (xs: X[], name: string, fallback = 0) =>
  Number(val(xs, name, String(fallback)));
const bounded = (n: number, lo: number, hi: number) => {
  if (!Number.isFinite(n) || n < lo || n > hi)
    throw new Error("악보의 수치가 지원 범위를 벗어났습니다.");
  return n;
};
export type NoteEvent = {
  at: number;
  length: number;
  notes: string[];
  rest?: boolean;
  grace?: boolean;
  duration: string;
  lyrics: Record<string, string>;
  suffix: string;
};
export type Measure = {
  length: number;
  beats: number;
  beatType: number;
  fifths: number;
  mode: "major" | "minor";
  voices: Record<string, NoteEvent[]>;
  clefs: Record<string, string>;
  bar: string;
  break?: boolean;
  harmonies: { at: number; chord: string }[];
};
export type MusicScore = {
  sourceKey: KeyId;
  mode: "major" | "minor";
  measures: Measure[][];
  warnings: string[];
  noteCount: number;
};
const major = [
  "ces",
  "ges",
  "des",
  "as",
  "es",
  "bes",
  "f",
  "c",
  "g",
  "d",
  "a",
  "e",
  "b",
  "fis",
  "cis",
];
const minor = [
  "as",
  "es",
  "bes",
  "f",
  "c",
  "g",
  "d",
  "a",
  "e",
  "b",
  "fis",
  "cis",
  "gis",
  "dis",
  "ais",
];
function tonic(fifths: number, mode: string) {
  return (mode === "minor" ? minor : major)[fifths + 7];
}
function pitch(step: string, alter: number, octave?: number) {
  if (!/^[A-G]$/.test(step) || !Number.isInteger(alter) || Math.abs(alter) > 2)
    throw new Error("지원하지 않는 음표 표기입니다.");
  const p =
    step.toLowerCase() + (alter > 0 ? "is".repeat(alter) : "es".repeat(-alter));
  if (octave === undefined) return p;
  bounded(octave, 0, 9);
  if (!Number.isInteger(octave)) throw new Error("옥타브가 올바르지 않습니다.");
  return p + (octave >= 3 ? "'".repeat(octave - 3) : ",".repeat(3 - octave));
}
export function quoteLy(text: string) {
  return (
    '"' +
    text
      .slice(0, 2000)
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replaceAll("\\", "\\\\")
      .replaceAll('"', '\\"') +
    '"'
  );
}
export function fraction(n: number): string {
  bounded(n, 0, 128);
  for (let d = 1; d <= 65536; d++)
    if (Math.abs(n * d - Math.round(n * d)) < 1e-7)
      return `${Math.round(n * d)}/${d}`;
  throw new Error("음길이를 정확히 표현할 수 없습니다.");
}
export function unpackMusicXML(data: Uint8Array): string {
  if (data.length > 12 * 1024 * 1024)
    throw new Error("악보 파일이 너무 큽니다.");
  if (data[0] !== 0x50 || data[1] !== 0x4b) return strFromU8(data);
  let total = 0;
  const files = unzipSync(data, {
    filter: (e) => {
      total += e.originalSize;
      if (total > 24 * 1024 * 1024 || e.originalSize > 8 * 1024 * 1024)
        throw new Error("압축 악보가 너무 큽니다.");
      return /\.(xml|musicxml)$/.test(e.name);
    },
  });
  const container =
    files["META-INF/container.xml"] &&
    strFromU8(files["META-INF/container.xml"]);
  const target = container?.match(/full-path="([^"]+)"/)?.[1];
  const name =
    target || Object.keys(files).find((n) => !n.startsWith("META-INF/"));
  if (!name || !files[name])
    throw new Error("MusicXML이 없는 압축 파일입니다.");
  return strFromU8(files[name]);
}
export function parseMusicXML(
  xml: string,
  modeOverride?: "major" | "minor",
): MusicScore {
  if (xml.length > 8 * 1024 * 1024 || /<!ENTITY/i.test(xml))
    throw new Error("지원하지 않는 XML입니다.");
  if (XMLValidator.validate(xml) !== true)
    throw new Error("MusicXML 문법이 올바르지 않습니다.");
  const root = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    parseTagValue: false,
    trimValues: true,
  }).parse(xml) as X[];
  const parts = all(one(root, "score-partwise"), "part");
  if (!parts.length || parts.length > 16)
    throw new Error("보표가 있는 MusicXML 악보가 필요합니다.");
  const warnings = new Set<string>();
  let noteCount = 0;
  let firstFifths = 0,
    firstMode: "major" | "minor" = "major",
    initial = false;
  const measures = parts.map((part) => {
    let divisions = 1,
      beats = 4,
      beatType = 4,
      fifths = 0,
      mode: "major" | "minor" = modeOverride || "major";
    let clefs: Record<string, string> = { "1": "treble" };
    const list = all(children(part, "part"), "measure");
    if (list.length > 1000) throw new Error("악보가 너무 깁니다.");
    return list.map((node, mi) => {
      const m: Measure = {
        length: 0,
        beats,
        beatType,
        fifths,
        mode,
        voices: {},
        clefs: { ...clefs },
        bar: "|",
        harmonies: [],
      };
      let cursor = 0;
      const previous: Record<string, NoteEvent> = {};
      for (const item of children(node, "measure")) {
        if (item.attributes) {
          const a = item.attributes as X[];
          if (has(a, "transpose"))
            throw new Error("이조 악기 악보는 아직 지원하지 않습니다.");
          if (has(a, "divisions"))
            divisions = bounded(num(a, "divisions"), 1, 100000);
          if (has(a, "key")) {
            const k = one(a, "key");
            fifths = bounded(num(k, "fifths"), -7, 7);
            if (!Number.isInteger(fifths)) throw new Error("조표 오류");
            const md = modeOverride || val(k, "mode", "major");
            if (!["major", "minor", "none"].includes(md))
              throw new Error("장조·단조만 지원합니다.");
            mode = md === "minor" ? "minor" : "major";
            if (!has(k, "mode") && !modeOverride)
              warnings.add(
                "조표를 기준으로 장조로 표시했어요. 원곡이 단조이면 장·단조 설정을 바꿔 주세요.",
              );
          }
          if (!initial) {
            firstFifths = fifths;
            firstMode = mode;
            initial = true;
          }
          if (has(a, "time")) {
            const t = one(a, "time");
            beats = bounded(num(t, "beats"), 1, 32);
            beatType = bounded(num(t, "beat-type"), 1, 64);
            if (
              !Number.isInteger(beats) ||
              ![1, 2, 4, 8, 16, 32, 64].includes(beatType)
            )
              throw new Error("복합 박자 표기를 확인해 주세요.");
          }
          for (const c of all(a, "clef")) {
            const cs = children(c, "clef");
            const sign = val(cs, "sign");
            const line = num(cs, "line");
            const names: Record<string, string> = {
              G2: "treble",
              F4: "bass",
              C3: "alto",
              C4: "tenor",
            };
            const name = names[sign + line];
            if (!name || num(cs, "clef-octave-change") !== 0)
              throw new Error("지원하지 않는 음자리표입니다.");
            clefs = { ...clefs, [attr(c, "number", "1")]: name };
          }
          Object.assign(m, {
            beats,
            beatType,
            fifths,
            mode,
            clefs: { ...clefs },
          });
        } else if (item.backup) {
          cursor -= num(item.backup, "duration") / divisions / 4;
          if (cursor < -1e-7)
            throw new Error("성부의 마디 위치가 올바르지 않습니다.");
        } else if (item.forward) {
          cursor += num(item.forward, "duration") / divisions / 4;
          m.length = Math.max(m.length, cursor);
        } else if (item.note) {
          const n = item.note as X[];
          if (has(n, "unpitched"))
            throw new Error("타악기 악보는 아직 지원하지 않습니다.");
          const voice = val(n, "staff", "1") + ":" + val(n, "voice", "1");
          if (!/^[0-9]{1,2}:[a-zA-Z0-9_-]{1,20}$/.test(voice))
            throw new Error("성부 식별자가 올바르지 않습니다.");
          const grace = has(n, "grace"),
            chord = has(n, "chord");
          const length = grace
            ? 0
            : bounded(num(n, "duration") / divisions / 4, 1 / 65536, 32);
          const types: Record<string, number> = {
            maxima: 0.125,
            long: 0.25,
            breve: 0.5,
            whole: 1,
            half: 2,
            quarter: 4,
            eighth: 8,
            "16th": 16,
            "32nd": 32,
            "64th": 64,
            "128th": 128,
            "256th": 256,
          };
          const denominator = types[val(n, "type")];
          const dots = all(n, "dot").length;
          let duration =
            denominator && denominator >= 1
              ? String(denominator) + ".".repeat(Math.min(dots, 3))
              : "1*" + fraction(length || 1 / 8);
          if (denominator && !grace) {
            const nominal = (2 - 1 / 2 ** dots) / denominator;
            if (Math.abs(nominal - length) > 1e-7) {
              duration += "*" + fraction(length / nominal);
              warnings.add(
                "잇단음표는 음길이를 보존하지만 괄호 배치는 원본과 다를 수 있어요.",
              );
            }
          }
          const p = one(n, "pitch");
          let token = has(n, "rest")
            ? ""
            : pitch(val(p, "step"), num(p, "alter"), num(p, "octave", 4));
          if (all(n, "tie").some((t) => attr(t, "type") === "start"))
            token += "~";
          const lyrics: Record<string, string> = {};
          for (const l of all(n, "lyric")) {
            const v = attr(l, "number", "1");
            if (!/^\d{1,2}$/.test(v)) continue;
            lyrics[v] = val(children(l, "lyric"), "text");
          }
          const notations = one(n, "notations");
          let suffix = "";
          for (const s of all(notations, "slur")) {
            if (attr(s, "type") === "start") suffix += "(";
            if (attr(s, "type") === "stop") suffix += ")";
          }
          if (has(notations, "fermata")) suffix += "\\fermata";
          const articulations = one(notations, "articulations");
          if (has(articulations, "staccato")) suffix += "-.";
          if (has(articulations, "tenuto")) suffix += "--";
          if (has(articulations, "accent")) suffix += "->";
          if (chord) {
            const prev = previous[voice];
            if (!prev || Math.abs(prev.length - length) > 1e-7)
              throw new Error("화음의 음길이가 일치하지 않습니다.");
            if (token) prev.notes.push(token);
            Object.assign(prev.lyrics, lyrics);
          } else {
            const event: NoteEvent = {
              at: cursor,
              length,
              notes: token ? [token] : [],
              rest: has(n, "rest"),
              grace,
              duration,
              lyrics,
              suffix,
            };
            (m.voices[voice] ??= []).push(event);
            previous[voice] = event;
            cursor += length;
          }
          if (token) noteCount++;
          m.length = Math.max(m.length, cursor);
        } else if (item.harmony) {
          const h = item.harmony as X[],
            r = one(h, "root");
          const kinds: Record<string, string> = {
            major: "",
            minor: "m",
            dominant: "7",
            "major-seventh": "maj7",
            "minor-seventh": "m7",
            diminished: "dim",
            "diminished-seventh": "dim7",
            augmented: "aug",
            "suspended-fourth": "sus4",
            "suspended-second": "sus2",
            "major-sixth": "6",
            "minor-sixth": "m6",
            "half-diminished": "m7.5-",
          };
          const kind = val(h, "kind");
          if (!(kind in kinds) || has(h, "degree")) {
            warnings.add(
              "일부 복잡한 코드 기호는 표시하지 못했어요. 원본과 비교해 주세요.",
            );
            continue;
          }
          const rt = pitch(val(r, "root-step"), num(r, "root-alter"));
          const b = one(h, "bass");
          m.harmonies.push({
            at: cursor + num(h, "offset") / divisions / 4,
            chord:
              rt +
              ": " +
              kinds[kind] +
              (b.length
                ? "/+" + pitch(val(b, "bass-step"), num(b, "bass-alter"))
                : ""),
          });
        } else if (item.print && attr(item, "new-system") === "yes")
          m.break = true;
        else if (item.barline) {
          const b = item.barline as X[];
          if (has(b, "repeat"))
            m.bar =
              attr(all(b, "repeat")[0], "direction") === "backward"
                ? ":|."
                : ".|:";
          else if (val(b, "bar-style") === "light-heavy") m.bar = "|.";
          else if (val(b, "bar-style") === "light-light") m.bar = "||";
          if (has(b, "ending"))
            warnings.add("반복 끝괄호는 원본을 참고해 주세요.");
        } else if (item.direction) {
          if (
            has(one(item.direction, "direction-type"), "words") ||
            has(one(item.direction, "direction-type"), "dynamics")
          )
            warnings.add(
              "일부 악상·설명 텍스트의 위치와 표시는 원본과 다를 수 있어요.",
            );
        }
      }
      if (!m.length) m.length = beats / beatType;
      bounded(m.length, 1 / 65536, 32);
      if (mi > 0 && Math.abs(m.length - beats / beatType) > 1e-7)
        warnings.add(
          "정규 박자보다 짧거나 긴 마디가 있어요. 못갖춘마디 또는 인식 오류인지 확인해 주세요.",
        );
      return m;
    });
  });
  if (!noteCount)
    throw new Error(
      "음표를 인식하지 못했습니다. 더 선명한 사진으로 다시 시도해 주세요.",
    );
  if (noteCount > 30000) throw new Error("음표가 너무 많습니다.");
  const raw = tonic(firstFifths, firstMode);
  const aliases: Record<string, KeyId> = {
    ces: "b",
    cis: "des",
    gis: "as",
    dis: "es",
    ais: "bes",
  };
  const sourceKey = isKey(raw) ? raw : aliases[raw];
  if (!sourceKey) throw new Error("기준조를 읽지 못했습니다.");
  return {
    sourceKey,
    mode: firstMode,
    measures,
    warnings: [...warnings],
    noteCount,
  };
}

export function musicToLily(
  score: MusicScore,
  title: string,
  key: KeyId,
): string {
  if (!isKey(key)) throw new Error("지원하지 않는 조입니다.");
  const first = score.measures[0][0];
  const from = tonic(first.fifths, first.mode);
  const blocks: string[] = [];
  let vi = 0;
  for (const part of score.measures) {
    const voices = [...new Set(part.flatMap((m) => Object.keys(m.voices)))];
    const staffIds = [...new Set(voices.map((v) => v.split(":")[0]))];
    for (const staff of staffIds) {
      const vs = voices.filter((v) => v.startsWith(staff + ":"));
      const lines: string[] = [];
      const lyricBlocks: string[] = [];
      for (const voice of vs) {
        const name = `voice${vi++}`;
        const verses = [
          ...new Set(
            part.flatMap((m) =>
              (m.voices[voice] || []).flatMap((e) => Object.keys(e.lyrics)),
            ),
          ),
        ];
        let music = "",
          lastClef = "",
          lastKey = "",
          lastTime = "";
        const lyrics: Record<string, string> = Object.fromEntries(
          verses.map((v) => [v, ""]),
        );
        for (const m of part) {
          const clef = m.clefs[staff] || "treble",
            signature = `${tonic(m.fifths, m.mode)} \\${m.mode}`,
            time = `${m.beats}/${m.beatType}`;
          if (clef !== lastClef) {
            music += `\\clef ${clef} `;
            lastClef = clef;
          }
          if (signature !== lastKey) {
            music += `\\key ${signature} `;
            lastKey = signature;
          }
          if (time !== lastTime) {
            music += `\\time ${time} `;
            lastTime = time;
          }
          music += `\\set Timing.measureLength = #(ly:make-moment ${fraction(m.length).replace("/", " ")}) `;
          if (m.break) music += "\\break ";
          let at = 0;
          for (const e of m.voices[voice] || []) {
            if (e.at < at - 1e-7)
              throw new Error(
                "한 성부에 음표가 겹칩니다. 분석 결과를 수정해 주세요.",
              );
            if (e.at > at + 1e-7) {
              const gap = fraction(e.at - at);
              music += `s1*${gap} `;
              for (const v of verses) lyrics[v] += `\\skip 1*${gap} `;
            }
            const notes =
              e.notes.length > 1 ? `<${e.notes.join(" ")}>` : e.notes[0] || "r";
            // A single-note tie follows its duration (c4~); chord ties stay
            // inside the brackets (<c~ e>4). c~4 creates an extra note.
            const singleTie = e.notes.length === 1 && notes.endsWith("~");
            const event =
              (singleTie ? notes.slice(0, -1) : notes) +
              e.duration +
              (singleTie ? "~" : "") +
              e.suffix;
            music += e.grace ? `\\grace { ${event} } ` : event + " ";
            if (!e.grace)
              for (const v of verses)
                lyrics[v] += e.lyrics[v]
                  ? `${quoteLy(e.lyrics[v])}1*${fraction(e.length)} `
                  : `\\skip 1*${fraction(e.length)} `;
            at = e.at + e.length;
          }
          if (at < m.length - 1e-7) {
            const gap = fraction(m.length - at);
            music += `s1*${gap} `;
            for (const v of verses) lyrics[v] += `\\skip 1*${gap} `;
          }
          music += `\\bar ${quoteLy(m.bar)}\n`;
        }
        lines.push(
          `\\new Voice = "${name}" { ${vs.length > 1 ? (vs.indexOf(voice) % 2 ? "\\voiceTwo" : "\\voiceOne") : ""} \\transpose ${from} ${key} { ${music} } }`,
        );
        for (const v of verses)
          lyricBlocks.push(
            `\\new Lyrics \\with { alignBelowContext = "staff${name}" } \\lyricmode { \\set stanza = ${quoteLy(v + ".")} ${lyrics[v]} }`,
          );
      }
      // Lyrics use explicit durations, so rests, ties and different voices keep their timing.
      blocks.push(
        `\\new Staff << ${lines.join("\n")} >>\n${lyricBlocks.join("\n").replace(/ \\with \{ alignBelowContext = "staffvoice\d+" \}/g, "")}`,
      );
    }
    if (part.some((m) => m.harmonies.length)) {
      let chords = "";
      for (const m of part) {
        const hs = m.harmonies
          .filter((h) => h.at >= 0 && h.at < m.length)
          .sort((a, b) => a.at - b.at);
        let at = 0;
        for (let i = 0; i < hs.length; i++) {
          const h = hs[i];
          if (h.at > at) chords += `s1*${fraction(h.at - at)} `;
          const end = hs[i + 1]?.at ?? m.length;
          if (end <= h.at) continue;
          const [root, kind] = h.chord.split(": ");
          chords += `${root}1*${fraction(end - h.at)}${kind ? ":" + kind : ""} `;
          at = end;
        }
        if (at < m.length) chords += `s1*${fraction(m.length - at)} `;
      }
      blocks.splice(
        blocks.length - staffIds.length,
        0,
        `\\new ChordNames { \\transpose ${from} ${key} \\chordmode { ${chords} } }`,
      );
    }
  }
  return `\\version "2.24.3"\n\\language "nederlands"\n#(set-global-staff-size 18)\n\\header { title = ${quoteLy(title)} tagline = ##f }\n\\paper { #(define fonts (set-global-fonts #:roman "Noto Serif CJK KR" #:sans "Noto Sans CJK KR" #:factor (/ staff-height pt 20))) indent = 0\\mm ragged-last-bottom = ##t }\n\\score { << ${blocks.join("\n")} >> \\layout { \\context { \\Lyrics \\override LyricText.font-size = #-1 } } }\n`;
}
