import test from "node:test";
import assert from "node:assert/strict";
import {
  musicToLily,
  parseMusicXML,
  unpackMusicXML,
  quoteLy,
} from "../lib/musicxml.ts";
import { zipSync, strToU8 } from "fflate";
const xml = `<score-partwise><part id="P1"><measure number="1"><attributes><divisions>4</divisions><key><fifths>0</fifths><mode>minor</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type><lyric number="1"><text>한글</text></lyric></note><note><chord/><pitch><step>E</step><alter>-1</alter><octave>4</octave></pitch><duration>4</duration><voice>1</voice><type>quarter</type></note><forward><duration>12</duration></forward><backup><duration>16</duration></backup><note><pitch><step>A</step><octave>3</octave></pitch><duration>16</duration><voice>2</voice><type>whole</type></note></measure></part></score-partwise>`;
test("MusicXML keeps voices, chords, lyrics and pitches; LilyPond performs transposition", () => {
  const s = parseMusicXML(xml);
  assert.equal(s.sourceKey, "a");
  assert.equal(s.mode, "minor");
  assert.equal(s.noteCount, 3);
  assert.equal(s.measures[0][0].voices["1:2"][0].at, 0);
  const source = musicToLily(s, 'title " \\ #(system "bad")', "f");
  assert.match(source, /<c' ees'>4/);
  assert.match(source, /\\transpose a f/);
  assert.match(source, /"한글"1\*1\/4/);
  assert.match(source, /\\key a \\minor/);
  assert.match(source, /title = "title \\"/);
});
test("MusicXML rejects entities, unsupported pitches, bad durations, and malformed chords", () => {
  assert.throws(() =>
    parseMusicXML(
      '<!DOCTYPE x [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + xml,
    ),
  );
  assert.throws(() =>
    parseMusicXML(xml.replace("<step>C</step>", "<step>#(system x)</step>")),
  );
  assert.throws(() =>
    parseMusicXML(
      xml.replace("<duration>4</duration>", "<duration>-4</duration>"),
    ),
  );
  assert.throws(() =>
    parseMusicXML(xml.replace("<chord/>", "<chord/><grace/>")),
  );
});
test("MXL follows its manifest and refuses expanded size abuse", () => {
  const zip = zipSync({
    "score.xml": strToU8(xml),
    "META-INF/container.xml": strToU8(
      '<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>',
    ),
  });
  assert.equal(unpackMusicXML(zip), xml);
  const bomb = zipSync({ "big.xml": new Uint8Array(9 * 1024 * 1024) });
  assert.throws(() => unpackMusicXML(bomb), /너무 큽니다/);
});
test("long LilyPond strings cannot truncate escape sequences", () => {
  assert.equal(
    quoteLy("a".repeat(1999) + '\\" malicious'),
    '"' + "a".repeat(1999) + '\\\\"',
  );
});
test("OMR mode can be corrected without changing source pitches", () => {
  const input = xml.replace("<mode>minor</mode>", "");
  const inferred = parseMusicXML(input);
  assert.equal(inferred.sourceKey, "c");
  assert.ok(inferred.warnings.some((w) => w.includes("단조")));
  const corrected = parseMusicXML(input, "minor");
  assert.equal(corrected.sourceKey, "a");
  assert.equal(corrected.noteCount, inferred.noteCount);
});
