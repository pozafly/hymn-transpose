import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { getHymns, scoreDirectory } from "./catalog.ts";
import { fillTemplate, isKey, type KeyId } from "./keys.ts";

const execute = promisify(execFile);
export const cacheDirectory = () =>
  path.resolve(
    /* turbopackIgnore: true */ process.env.SCORE_CACHE_DIR || "dist/scores",
  );
export class RenderError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.status = status;
  }
}
export type RenderResult = {
  version: string;
  pdfUrl: string;
  pages: string[];
  warning?: string;
};
type Manifest = { pages: string[]; warning?: string };
type RenderState = {
  pending: Map<string, Promise<RenderResult>>;
  tail: Promise<unknown>;
};
const globalState = globalThis as typeof globalThis & {
  hymnRenderer?: RenderState;
};
const state = (globalState.hymnRenderer ??= {
  pending: new Map(),
  tail: Promise.resolve(),
});

async function command(binary: string, args: string[], cwd?: string) {
  return execute(binary, args, {
    cwd,
    timeout: 60_000,
    killSignal: "SIGKILL",
    maxBuffer: 8 * 1024 * 1024,
    env: { ...process.env, LANG: "C.UTF-8" },
  });
}

async function checkFonts() {
  for (const family of ["Noto Serif CJK KR", "Noto Sans CJK KR"]) {
    const { stdout } = await command("fc-match", ["-f", "%{family}", family]);
    if (!stdout.includes(family))
      throw new RenderError(
        `한글 악보에 필요한 ${family} 폰트를 설치해 주세요.`,
        503,
      );
  }
}

function result(
  id: string,
  key: KeyId,
  version: string,
  manifest: Manifest,
): RenderResult {
  const base = `/api/scores/${id}/${key}/${version}`;
  return {
    version,
    pdfUrl: `${base}/score.pdf`,
    pages: manifest.pages.map((file) => `${base}/${file}`),
    ...(manifest.warning ? { warning: manifest.warning } : {}),
  };
}

async function cached(directory: string): Promise<Manifest | null> {
  try {
    const manifest = JSON.parse(
      await readFile(path.join(directory, "manifest.json"), "utf8"),
    ) as Manifest;
    if (
      !Array.isArray(manifest.pages) ||
      !manifest.pages.every((p) => /^page-\d+\.png$/.test(p))
    )
      return null;
    await Promise.all(
      ["score.pdf", ...manifest.pages].map((file) =>
        access(path.join(directory, file)),
      ),
    );
    return manifest;
  } catch {
    return null;
  }
}

export async function render(
  hymnId: string,
  key: KeyId,
): Promise<RenderResult> {
  if (!isKey(key)) throw new RenderError("지원하지 않는 조입니다.", 400);
  const hymn = (await getHymns()).find((item) => item.id === hymnId);
  if (!hymn) throw new RenderError("곡을 찾을 수 없습니다.", 404);
  const template = await readFile(
    path.join(scoreDirectory, hymn.template),
    "utf8",
  );
  const source = fillTemplate(template, key);
  // Bump SCORE_RENDER_VERSION after changing LilyPond, Poppler, or fonts.
  const version = createHash("sha256")
    .update(
      `renderer-v1:png-150:${process.env.SCORE_RENDER_VERSION || "1"}:${source}`,
    )
    .digest("hex")
    .slice(0, 16);
  const directory = path.join(
    /* turbopackIgnore: true */ cacheDirectory(),
    hymn.id,
    key,
    version,
  );
  const existing = await cached(directory);
  if (existing) return result(hymn.id, key, version, existing);
  const active = state.pending.get(directory);
  if (active) return active;
  if (state.pending.size >= 24)
    throw new RenderError(
      "악보 요청이 많습니다. 잠시 후 다시 시도해 주세요.",
      503,
    );

  const task = state.tail
    .catch(() => {})
    .then(async () => {
      const previous = await cached(directory);
      if (previous) return result(hymn.id, key, version, previous);
      await mkdir(path.dirname(directory), { recursive: true });
      const temporary = await mkdtemp(
        path.join(path.dirname(directory), ".render-"),
      );
      try {
        await checkFonts();
        await writeFile(path.join(temporary, "score.ly"), source);
        await command(
          process.env.LILYPOND_BIN || "lilypond",
          ["-dno-point-and-click", "-o", "score", "score.ly"],
          temporary,
        );
        await access(path.join(temporary, "score.pdf"));
        const manifest: Manifest = { pages: [] };
        try {
          await command(
            "pdftoppm",
            ["-r", "150", "-png", "score.pdf", "page"],
            temporary,
          );
          manifest.pages = (await readdir(temporary))
            .filter((file) => /^page-\d+\.png$/.test(file))
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
          if (!manifest.pages.length) throw new Error("PNG 결과 없음");
        } catch (error) {
          console.error("PNG generation failed", error);
          manifest.warning =
            "이미지 미리보기를 만들지 못했습니다. PDF는 다운로드할 수 있습니다.";
        }
        await writeFile(
          path.join(temporary, "manifest.json"),
          JSON.stringify(manifest),
        );
        // A manifest becomes visible only after every output has completed.
        await rm(directory, { recursive: true, force: true });
        await rename(temporary, directory);
        return result(hymn.id, key, version, manifest);
      } catch (error) {
        if (error instanceof RenderError) throw error;
        console.error("Score rendering failed", error);
        throw new RenderError(
          "악보를 만들지 못했습니다. 렌더링 도구 설치와 서버 상태를 확인해 주세요.",
          503,
        );
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
    });
  state.pending.set(directory, task);
  state.tail = task;
  try {
    return await task;
  } finally {
    state.pending.delete(directory);
  }
}
