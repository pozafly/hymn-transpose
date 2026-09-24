import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import { command as run } from "./command.ts";

type HymnSource = { id: string; title: string; file: string };

async function extractArchive(archive: string, destination: string) {
  let entries: ReturnType<typeof unzipSync>;
  try {
    // Read UTF-8 ZIP names directly. Linux unzip can reinterpret their bytes
    // as an OEM code page for archives marked as originating on DOS.
    entries = unzipSync(await readFile(archive));
  } catch {
    // The original downloads are password-protected; fflate cannot decrypt
    // them. Keep the existing extractor for those legacy archives.
    await run("unzip", ["-q", "-o", "-P", "ccm4u", archive, "-d", destination], {
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, LANG: "C.UTF-8", LC_ALL: "C.UTF-8" },
    }).catch((error) => {
      if (
        error.code !== 1 ||
        !/mismatching "local" filename/.test(error.stderr || "")
      )
        throw error;
    });
    return;
  }
  for (const [name, bytes] of Object.entries(entries)) {
    if (!name.endsWith(".mscz") || name.includes("__MACOSX")) continue;
    const file = path.resolve(destination, name.replaceAll("\\", "/"));
    if (!file.startsWith(path.resolve(destination) + path.sep))
      throw new Error(`ZIP 내부 경로가 올바르지 않습니다: ${name}`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
  }
}

async function walk(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.name === "__MACOSX") continue;
    if (entry.isDirectory()) files.push(...(await walk(file)));
    else if (entry.isFile() && file.endsWith(".mscz")) files.push(file);
  }
  return files;
}

export async function readHymnSources(root: string, temporary: string) {
  const archives = (await readdir(root)).filter((name) =>
    /^\d+-\d+\.zip$/.test(name),
  );
  if (!archives.length)
    throw new Error(
      "원본 ZIP이 없습니다. 1-100.zip 같은 구간별 ZIP 폴더를 지정해 주세요.",
    );
  const sources = new Map<string, HymnSource>();
  const unrecognized: string[] = [];
  for (const archive of archives) {
    const destination = path.join(temporary, archive.slice(0, -4));
    await mkdir(destination, { recursive: true });
    await extractArchive(path.resolve(root, archive), destination);
    for (const file of await walk(destination)) {
      const name = path
        .basename(file)
        .replace(/#U([0-9a-f]{4})/gi, (_, hex) =>
          String.fromCharCode(parseInt(hex, 16)),
        )
        .normalize("NFC");
      const match = name.match(/^(\d{1,3})\s*장[ ._-]*(.*)\.mscz$/);
      if (!match || Number(match[1]) < 1 || Number(match[1]) > 645) {
        unrecognized.push(name);
        continue;
      }
      const id = String(Number(match[1]));
      if (sources.has(id)) throw new Error(`원본에 ${id}장이 중복되어 있습니다.`);
      sources.set(id, {
        id,
        title: match[2].replaceAll("_", " ").trim() || `${id}장`,
        file,
      });
    }
  }
  if (unrecognized.length)
    throw new Error(
      `찬송가 번호를 읽지 못한 파일 ${unrecognized.length}개: ${unrecognized.slice(0, 5).join(", ")}`,
    );
  if (!sources.size) throw new Error("ZIP에서 등록할 찬송가 원본을 찾지 못했습니다.");
  return [...sources.values()].sort((a, b) => Number(a.id) - Number(b.id));
}
