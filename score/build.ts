import { parseArgs } from "node:util";
import { getHymns } from "../lib/catalog.ts";
import { KEYS, chord_labels, isKey } from "../lib/keys.ts";
import { cacheDirectory, render } from "../lib/render.ts";

const { values } = parseArgs({
  options: {
    key: { type: "string", multiple: true },
    hymn: { type: "string" },
    "list-keys": { type: "boolean" },
    all: { type: "boolean" },
    png: { type: "boolean" },
    out: { type: "string" },
  },
});
if (values.out) process.env.SCORE_CACHE_DIR = values.out;
try {
  if (values["list-keys"]) {
    for (const key of KEYS)
      console.log(
        `${key.id.padEnd(4)} ${key.label}장조 (${key.signature})  ${Object.values(chord_labels(key.id)).join(" / ")}`,
      );
  } else {
    const keys = values.all ? KEYS.map((key) => key.id) : values.key || ["ges"];
    for (const key of keys)
      if (!isKey(key)) throw new Error(`지원하지 않는 조: ${key}`);
    const hymns = await getHymns();
    const targets = values.hymn
      ? hymns.filter((hymn) => hymn.id === values.hymn)
      : values.all
        ? hymns
        : hymns.slice(0, 1);
    if (!targets.length) throw new Error("곡을 찾을 수 없습니다.");
    for (const hymn of targets)
      for (const key of keys) {
        if (!isKey(key)) continue;
        const output = await render(hymn.id, key);
        console.log(
          `${hymn.id} / ${key} → ${cacheDirectory()}/${hymn.id}/${key}/${output.version}/score.pdf`,
        );
        if (output.warning) console.warn(output.warning);
      }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
