import { readFile, writeFile, readdir, mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseMusicXML, unpackMusicXML, musicToLily } from "../lib/musicxml.ts";
import {
  insertScore,
  savedScore,
  scorePath,
  updateScore,
} from "../lib/store.ts";
import { unzipSync, strFromU8 } from "fflate";
import { command as run } from "../lib/command.ts";
const root = process.argv[2];
if (!root) throw new Error("원본 ZIP 디렉터리를 지정해 주세요.");
const temp = await mkdtemp(path.join(os.tmpdir(), "hymn-import-"));
const archives = (await readdir(root)).filter((n) => /^\d+-\d+\.zip$/.test(n));
for (const a of archives) {
  try {
    await run(
      "unzip",
      ["-q", "-o", "-P", "ccm4u", path.join(root, a), "-d", temp],
      {
        timeout: 60_000,
        maxBuffer: 2 * 1024 * 1024,
        env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
      },
    );
  } catch (e) {
    if (
      (e as { code?: number }).code !== 1 ||
      !/mismatching "local" filename/.test(
        (e as { stderr?: string }).stderr || "",
      )
    )
      throw e;
  }
}
async function walk(dir: string): Promise<string[]> {
  const list: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) list.push(...(await walk(f)));
    else if (f.endsWith(".mscz") && !f.includes("__MACOSX")) list.push(f);
  }
  return list;
}
const files = await walk(temp);
const report: {
  id: string;
  ok: boolean;
  error?: string;
  warnings?: string[];
}[] = [];
const selected = process.env.IMPORT_ONLY?.split(",");
for (const f of files) {
  const match = path
    .basename(f)
    .replace(/#U([0-9a-f]{4})/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .normalize("NFC")
    .match(/(\d{1,3})\s*장[ ._-]*(.*)\.mscz$/);
  if (!match) continue;
  const id = String(Number(match[1]));
  if (selected && !selected.includes(id)) continue;
  if (id === "67" || savedScore(id)) {
    report.push({ id, ok: true });
    continue;
  }
  try {
    const xmlFile = path.join(temp, `${id}.xml`);
    await run(
      process.env.MUSESCORE_BIN || "musescore3",
      ["-f", "-o", xmlFile, f],
      {
        timeout: 60_000,
        maxBuffer: 4 * 1024 * 1024,
        env: {
          ...process.env,
          QT_QPA_PLATFORM: process.env.QT_QPA_PLATFORM || "offscreen",
        },
      },
    );
    const xml = unpackMusicXML(await readFile(xmlFile));
    const parsed = parseMusicXML(xml);
    const archive = unzipSync(await readFile(f));
    const sourceName = Object.keys(archive).find((n) => n.endsWith(".mscx"));
    if (!sourceName) throw new Error("MuseScore 소스가 없습니다.");
    const sourceXML = strFromU8(archive[sourceName]);
    const sourceNotes = (sourceXML.match(/<Note>/g) || []).length;
    if (sourceNotes !== parsed.noteCount)
      throw new Error(
        `음표 수 불일치: 원본 ${sourceNotes}, 변환 ${parsed.noteCount}`,
      );
    const title = match[2].replaceAll("_", " ").trim() || `${id}장`;
    musicToLily(parsed, title, parsed.sourceKey);
    await mkdir(scorePath(id), { recursive: true });
    await writeFile(scorePath(id, "score.musicxml"), xml);
    await writeFile(scorePath(id, "source.mscz"), await readFile(f));
    insertScore({
      id,
      title,
      number: Number(id),
      category: "새찬송가",
      template: "",
      kind: "builtin",
      mode: parsed.mode,
      sourceKey: parsed.sourceKey,
      createdAt: new Date().toISOString(),
      status: "ready",
      requestedKeys: [parsed.sourceKey],
      results: {},
      keyErrors: {},
      warnings: [
        ...parsed.warnings,
        "디지털 원본에서 변환한 악보이며 인쇄본과 전체 대조 검수 전입니다.",
      ],
      revision: 1,
      originalCount: 0,
      sourceCredit:
        "악보 원본: 깔끔이 CCM · ccm4u.tistory.com (2022). 가족 내 개인 이용용.",
    });
    report.push({ id, ok: true, warnings: parsed.warnings });
    console.log(`Imported ${id}: ${title}`);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    report.push({ id, ok: false, error });
    console.error(`Failed ${id}: ${error.slice(0, 300)}`);
  }
}
await writeFile(
  path.join(process.env.APP_DATA_DIR || "data", "import-report.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify({
    files: files.length,
    success: report.filter((r) => r.ok).length,
    failed: report.filter((r) => !r.ok).length,
  }),
);
