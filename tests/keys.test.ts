import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  KEYS,
  chord_labels,
  fillTemplate,
  isKey,
  type KeyId,
} from "../lib/keys";

test("enharmonic chords retain their diatonic spelling", () => {
  assert.deepEqual(chord_labels("ges"), {
    I: "G♭",
    IV: "C♭",
    V: "D♭",
    V7: "D♭7",
  });
  assert.deepEqual(chord_labels("fis"), {
    I: "F♯",
    IV: "B",
    V: "C♯",
    V7: "C♯7",
  });
  assert.deepEqual(chord_labels("f"), { I: "F", IV: "B♭", V: "C", V7: "C7" });
  assert.deepEqual(chord_labels("des"), {
    I: "D♭",
    IV: "G♭",
    V: "A♭",
    V7: "A♭7",
  });
  assert.deepEqual(chord_labels("b"), { I: "B", IV: "E", V: "F♯", V7: "F♯7" });
});
test("only explicit key identifiers are accepted", () => {
  for (const value of [
    "",
    "C",
    "cisis",
    "../f",
    "f #(system foo)",
    "toString",
    null,
    {},
    1,
  ]) {
    assert.equal(isKey(value), false);
    assert.throws(() => chord_labels(value as KeyId));
  }
  for (const key of KEYS) assert.equal(isKey(key.id), true);
});
test("all keys preserve original notes, key, and layout", async () => {
  const template = await readFile(
    new URL("../score/hymn67.ly.tmpl", import.meta.url),
    "utf8",
  );
  for (const { id } of KEYS) {
    const rendered = fillTemplate(template, id);
    assert.ok(rendered.includes("\\key ges \\major"));
    assert.ok(rendered.includes(`\\transpose ges ${id} \\upperRaw`));
    assert.ok(rendered.includes(`\\transpose ges ${id} \\lowerRaw`));
    assert.ok(!/@[A-Z0-9]+@/.test(rendered));
    assert.equal(
      rendered
        .split("upperRaw = {")[1]
        .split("lowerRaw = {")[0]
        .replace(/\\ch "[^"]+"/g, ""),
      template
        .split("upperRaw = {")[1]
        .split("lowerRaw = {")[0]
        .replace(/\\ch "[^"]+"/g, ""),
    );
    assert.equal(
      rendered.split("\\paper {")[1].split("global =")[0],
      template.split("\\paper {")[1].split("global =")[0],
    );
  }
});
