import test from "node:test";
import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  db,
  insertScore,
  savedScore,
  scorePath,
  scoreGeneration,
  updateScore,
  enqueue,
  claimJob,
  type SavedScore,
} from "../lib/store.ts";
import { prepareSavedRender, renderPrepared } from "../lib/render.ts";
import { refreshScoreCache, publishScoreResult } from "../lib/cache.ts";
import { processJob } from "../lib/worker.ts";
const xml = `<score-partwise><part id="P1"><measure number="1"><attributes><divisions>1</divisions><key><fifths>0</fifths><mode>major</mode></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>whole</type><lyric number="1"><text>찬양</text></lyric></note></measure></part></score-partwise>`;

test("saved caches migrate without rendering, invalidate by content/settings, repair missing files and reject stale jobs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "score-cache-test-"));
  const saved = Object.fromEntries(
    [
      "APP_DATA_DIR",
      "SCORE_CACHE_DIR",
      "SCORE_RENDER_VERSION",
      "LILYPOND_BIN",
      "PATH",
    ].map((k) => [k, process.env[k]]),
  );
  const bin = path.join(root, "bin");
  await mkdir(bin);
  const script = (name: string, body: string) =>
    writeFile(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  process.env.APP_DATA_DIR = path.join(root, "data");
  process.env.SCORE_CACHE_DIR = path.join(root, "cache");
  process.env.SCORE_RENDER_VERSION = "test-v1";
  process.env.LILYPOND_BIN = path.join(bin, "lilypond");
  process.env.PATH = `${bin}:${saved.PATH}`;
  try {
    await script("fc-match", 'printf "%s" "$3"');
    await script(
      "lilypond",
      `printf 'run\\n' >> '${root}/calls'\nprintf '%%PDF-1.7' > score.pdf`,
    );
    await script(
      "pdftoppm",
      "printf PNG > page-1.png\nprintf PNG > page-2.png",
    );
    const score: SavedScore = {
      id: "u-" + randomUUID(),
      title: "검증 악보",
      number: 67,
      category: "내 악보",
      kind: "upload",
      template: "",
      mode: "major",
      sourceKey: "c",
      createdAt: new Date().toISOString(),
      status: "ready",
      requestedKeys: ["f"],
      results: {},
      keyErrors: {},
      revision: 1,
      originalCount: 1,
      warnings: [],
    };
    // Legacy records have no cache identity or job generation.
    insertScore(score);
    await mkdir(scorePath(score.id), { recursive: true });
    await writeFile(scorePath(score.id, "score.musicxml"), xml);
    const legacy = await renderPrepared(
      (await prepareSavedRender(score)).forKey("f"),
    );
    updateScore(score.id, (s) => {
      s.results.f = legacy;
    });
    const migrated = (await refreshScoreCache(score.id))!;
    assert.equal(migrated.results.f!.version, legacy.version);
    assert.ok(migrated.cacheIdentity);
    assert.equal(await readFile(path.join(root, "calls"), "utf8"), "run\n");
    assert.equal(claimJob(), undefined);

    // Existing DB URLs must not bypass a deployment's render version.
    process.env.SCORE_RENDER_VERSION = "test-v2";
    const invalidated = (await refreshScoreCache(score.id))!;
    assert.equal(invalidated.results.f, undefined);
    assert.equal(invalidated.status, "generating");
    await refreshScoreCache(score.id);
    const versionJob = claimJob()!;
    assert.equal(claimJob(), undefined);
    await processJob(versionJob);
    const updated = savedScore(score.id)!;
    assert.equal(updated.status, "ready");
    assert.notEqual(updated.results.f!.version, legacy.version);

    // Check every PNG, plus the PDF and manifest, even when DB metadata is intact.
    for (const file of ["page-2.png", "score.pdf", "manifest.json"]) {
      const before = savedScore(score.id)!;
      await rm(
        path.join(
          root,
          "cache",
          score.id,
          "f",
          before.results.f!.version,
          file,
        ),
      );
      await refreshScoreCache(score.id);
      assert.equal(savedScore(score.id)!.results.f, undefined);
      await processJob(claimJob()!);
      assert.equal(savedScore(score.id)!.status, "ready");
      assert.equal(
        savedScore(score.id)!.results.f!.version,
        before.results.f!.version,
      );
    }

    // Out-of-band source replacement is detected even without a DB revision change.
    const stale = savedScore(score.id)!;
    const oldOutput = stale.results.f!;
    await writeFile(
      scorePath(score.id, "score.musicxml"),
      xml.replace("<step>C</step>", "<step>D</step>"),
    );
    assert.equal(await publishScoreResult(stale, "f", oldOutput), false);
    await refreshScoreCache(score.id);
    const olderJob = claimJob()!;
    const snapshot = savedScore(score.id)!;
    const obsolete = await renderPrepared(
      (await prepareSavedRender(snapshot)).forKey("f"),
    );
    updateScore(score.id, (s) => {
      s.title = "바뀐 제목";
      s.revision++;
    });
    const next = (await refreshScoreCache(score.id))!;
    assert.notEqual(scoreGeneration(snapshot), scoreGeneration(next));
    assert.equal(await publishScoreResult(snapshot, "f", obsolete), false);
    // An older running job does not suppress the new generation's queued job.
    const newerJob = claimJob()!;
    assert.notEqual(olderJob.generation, newerJob.generation);
    await processJob(olderJob);
    assert.equal(savedScore(score.id)!.results.f, undefined);
    await processJob(newerJob);
    assert.equal(savedScore(score.id)!.status, "ready");

    // Replace metadata while the subprocess is actually running, not only before dispatch.
    process.env.SCORE_RENDER_VERSION = "test-inflight";
    await script(
      "lilypond",
      `touch '${root}/inflight'\n/bin/sleep 0.2\nprintf '%%PDF-1.7' > score.pdf`,
    );
    await refreshScoreCache(score.id);
    const running = processJob(claimJob()!);
    const deadline = Date.now() + 5000;
    while (true) {
      try {
        await access(path.join(root, "inflight"));
        break;
      } catch {
        if (Date.now() > deadline) throw new Error("subprocess did not start");
        await new Promise((r) => setTimeout(r, 5));
      }
    }
    updateScore(score.id, (s) => {
      s.title = "작업 도중 수정";
      s.revision++;
    });
    await running;
    assert.equal(savedScore(score.id)!.results.f, undefined);
    assert.equal(savedScore(score.id)!.status, "generating");
    await script("lilypond", "printf '%%PDF-1.7' > score.pdf");
    await processJob(claimJob()!);
    assert.ok(savedScore(score.id)!.results.f);

    // Repair previews without approving the user's selected transpositions.
    updateScore(score.id, (s) => {
      s.status = "review";
      s.results = {};
      s.preview = undefined;
    });
    await refreshScoreCache(score.id);
    const previewJob = claimJob()!;
    assert.equal(previewJob.kind, "preview");
    await processJob(previewJob);
    assert.equal(savedScore(score.id)!.status, "review");
    assert.deepEqual(savedScore(score.id)!.results, {});
    const preview = savedScore(score.id)!.preview!;
    await rm(
      path.join(root, "cache", score.id, "c", preview.version, "page-1.png"),
    );
    assert.equal((await refreshScoreCache(score.id))!.preview, undefined);
    assert.equal(savedScore(score.id)!.preview, undefined);
    await processJob(claimJob()!);
    assert.ok(savedScore(score.id)!.preview);

    // A real render failure should not be retried forever on each polling request.
    process.env.SCORE_RENDER_VERSION = "test-failure";
    updateScore(score.id, (s) => {
      s.status = "generating";
      s.preview = undefined;
    });
    await script("lilypond", "exit 1");
    await refreshScoreCache(score.id);
    await processJob(claimJob()!);
    assert.ok(savedScore(score.id)!.keyErrors.f);
    await refreshScoreCache(score.id);
    assert.equal(claimJob(), undefined);
    // Changing settings gives that failed generation a fresh attempt.
    process.env.SCORE_RENDER_VERSION = "test-recovered";
    await script("lilypond", "printf '%%PDF-1.7' > score.pdf");
    await refreshScoreCache(score.id);
    await processJob(claimJob()!);
    assert.equal(savedScore(score.id)!.status, "ready");
    assert.ok(savedScore(score.id)!.results.f);
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await rm(root, { recursive: true, force: true });
  }
});
