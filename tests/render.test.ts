import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { render } from "../lib/render";

test("render queue deduplicates, caches, recovers and keeps PDF on PNG failure", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "hymn-render-test-"));
  const bin = path.join(root, "bin");
  await mkdir(bin);
  const saved = {
    PATH: process.env.PATH,
    SCORE_CACHE_DIR: process.env.SCORE_CACHE_DIR,
    LILYPOND_BIN: process.env.LILYPOND_BIN,
    SCORE_RENDER_VERSION: process.env.SCORE_RENDER_VERSION,
  };
  const script = async (name: string, body: string) =>
    writeFile(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  const workingLily = `printf 'run\\n' >> '${root}/calls'\n/bin/sleep 0.1\nprintf '%%PDF-1.7' > score.pdf`;
  process.env.PATH = `${bin}:${saved.PATH}`;
  process.env.SCORE_CACHE_DIR = path.join(root, "cache");
  process.env.LILYPOND_BIN = path.join(bin, "lilypond");
  process.env.SCORE_RENDER_VERSION = "test";
  try {
    await script("fc-match", `printf '%s' "$3"`);
    await script("lilypond", workingLily);
    await script(
      "pdftoppm",
      "printf 'PNG' > page-1.png\nprintf 'PNG' > page-2.png",
    );
    const [first, duplicate] = await Promise.all([
      render("67", "f"),
      render("67", "f"),
    ]);
    assert.deepEqual(first, duplicate);
    assert.equal(first.pages.length, 2);
    assert.equal(await readFile(path.join(root, "calls"), "utf8"), "run\n");
    assert.deepEqual(await render("67", "f"), first);
    assert.equal(await readFile(path.join(root, "calls"), "utf8"), "run\n");
    process.env.SCORE_RENDER_VERSION = "test-2";
    const updated = await render("67", "f");
    assert.notEqual(updated.version, first.version);

    await script("pdftoppm", "exit 1");
    const partial = await render("67", "g");
    assert.ok(partial.warning);
    assert.equal(partial.pages.length, 0);
    const pdf = path.join(
      root,
      "cache",
      "67",
      "g",
      partial.version,
      "score.pdf",
    );
    assert.equal(await readFile(pdf, "utf8"), "%PDF-1.7");

    await script("lilypond", "exit 1");
    await assert.rejects(render("67", "d"), /악보를 만들지 못했습니다/);
    assert.deepEqual(await readdir(path.join(root, "cache", "67", "d")), []);
    await script("lilypond", workingLily);
    await script("pdftoppm", "printf 'PNG' > page-1.png");
    assert.equal((await render("67", "d")).pages.length, 1);
    await script("fc-match", "printf 'fallback font'");
    await assert.rejects(render("67", "a"), /폰트를 설치/);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
