import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  dataDirectory,
  savedScore,
  scorePath,
  enqueue,
  updateScore,
} from "../lib/store.ts";
import { parseMusicXML } from "../lib/musicxml.ts";
import { render, cacheDirectory, type RenderResult } from "../lib/render.ts";

// One original-key rendering per hymn; never renders every supported key.
const count = Number(process.argv[2] || "80");
if (!Number.isInteger(count) || count < 1 || count > 645)
  throw new Error("곡 수는 1~645입니다.");
const report: { id: string; ok: boolean; notes?: number; error?: string }[] =
  [];
const pending = new Set<string>();
async function verify(id: string, key: string, result: RenderResult) {
  const root = path.join(cacheDirectory(), id, key, result.version);
  const pdf = await readFile(path.join(root, "score.pdf"));
  if (pdf.subarray(0, 5).toString() !== "%PDF-") throw new Error("Invalid PDF");
  if (!result.pages.length || result.warning)
    throw new Error(result.warning || "No PNG pages");
  for (const url of result.pages) {
    const png = await readFile(path.join(root, path.basename(url)));
    if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
      throw new Error("Invalid PNG");
  }
}
for (let n = 1; n <= count; n++) {
  const id = String(n);
  try {
    if (id === "67") {
      await verify(id, "ges", await render(id, "ges"));
      report.push({ id, ok: true });
      continue;
    }
    const s = savedScore(id);
    if (!s || s.kind !== "builtin")
      throw new Error("등록된 기본 악보가 없습니다.");
    parseMusicXML(
      await readFile(scorePath(id, "score.musicxml"), "utf8"),
      s.modeOverride,
    );
    if (!s.results[s.sourceKey]) {
      updateScore(id, (x) => {
        x.requestedKeys = [...new Set([...x.requestedKeys, x.sourceKey])];
        delete x.keyErrors[x.sourceKey];
        x.status = "generating";
      });
      enqueue(id, "render", s.sourceKey);
    }
    pending.add(id);
  } catch (e) {
    report.push({ id, ok: false, error: String(e) });
  }
}
const deadline = Date.now() + count * 70_000 + 180_000;
while (pending.size && Date.now() < deadline) {
  for (const id of pending) {
    const s = savedScore(id)!;
    const result = s.results[s.sourceKey];
    const error = s.keyErrors[s.sourceKey];
    if (!result && !error) continue;
    try {
      if (error) throw new Error(error);
      await verify(id, s.sourceKey, result!);
      const parsed = parseMusicXML(
        await readFile(scorePath(id, "score.musicxml"), "utf8"),
        s.modeOverride,
      );
      report.push({ id, ok: true, notes: parsed.noteCount });
    } catch (e) {
      report.push({ id, ok: false, error: String(e) });
    }
    pending.delete(id);
    console.log(
      `${report.length}/${count}: ${id} ${report.at(-1)!.ok ? "PASS" : "FAIL"}`,
    );
  }
  if (pending.size) await new Promise((r) => setTimeout(r, 5000));
}
for (const id of pending)
  report.push({ id, ok: false, error: "작업 대기 시간 초과" });
report.sort((a, b) => Number(a.id) - Number(b.id));
await writeFile(
  path.join(dataDirectory(), `verification-${count}.json`),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    tested: count,
    passed: report.filter((r) => r.ok).length,
    failed: report.filter((r) => !r.ok),
  }),
);
if (report.some((r) => !r.ok)) process.exitCode = 1;
