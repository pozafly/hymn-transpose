import { readFile, writeFile, mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { parseMusicXML, unpackMusicXML, musicToLily } from "../lib/musicxml.ts";
import { insertScore, savedScore, scorePath } from "../lib/store.ts";
import { unzipSync, strFromU8 } from "fflate";
import { command as run } from "../lib/command.ts";
import { readHymnSources } from "../lib/hymn-sources.ts";
const root = process.argv[2];
if (!root) throw new Error("원본 ZIP 디렉터리를 지정해 주세요.");
const temp = await mkdtemp(path.join(os.tmpdir(), "hymn-import-"));
const sources = await readHymnSources(root, temp);
const report: {
  id: string;
  ok: boolean;
  error?: string;
  warnings?: string[];
}[] = [];
const selected = process.env.IMPORT_ONLY?.split(",").map((id) => id.trim());
if (
  selected?.some(
    (id) => !/^\d{1,3}$/.test(id) || Number(id) < 1 || Number(id) > 645,
  )
)
  throw new Error(
    "IMPORT_ONLY에는 1~645 사이 장 번호를 쉼표로 구분해 지정해 주세요.",
  );
const selectedIds =
  selected && new Set(selected.map((id) => String(Number(id))));
const targets = sources.filter(({ id }) => !selectedIds || selectedIds.has(id));
if (!targets.length)
  throw new Error(
    "등록 대상이 0곡입니다. 원본 폴더와 IMPORT_ONLY 설정을 확인해 주세요.",
  );
console.log(`원본 ${sources.length}곡 인식, 등록 대상 ${targets.length}곡`);
for (const { id, title, file: f } of targets) {
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
    files: sources.length,
    success: report.filter((r) => r.ok).length,
    failed: report.filter((r) => !r.ok).length,
  }),
);
if (report.some((row) => !row.ok)) process.exitCode = 1;
