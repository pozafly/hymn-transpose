import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  db,
  transaction,
  insertScore,
  savedScores,
  updateScore,
  enqueue,
  claimJob,
  recoverJobs,
  finishJob,
  type SavedScore,
} from "../lib/store.ts";
test("same hymn uploads stay distinct and durable jobs deduplicate and recover", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "score-store-"));
  const old = process.env.APP_DATA_DIR;
  process.env.APP_DATA_DIR = root;
  try {
    const base: SavedScore = {
      id: "u-" + randomUUID(),
      number: 67,
      title: "동일한 제목",
      kind: "upload",
      mode: "major",
      template: "",
      category: "내 악보",
      sourceKey: "f",
      createdAt: new Date().toISOString(),
      status: "queued",
      requestedKeys: ["f", "g"],
      results: {},
      keyErrors: {},
      warnings: [],
      revision: 0,
      originalCount: 1,
    };
    insertScore(base);
    insertScore({ ...base, id: "u-" + randomUUID() });
    assert.equal(savedScores().length, 2);
    enqueue(base.id, "analyze");
    enqueue(base.id, "analyze");
    const a = claimJob()!;
    assert.equal(a.score_id, base.id);
    assert.equal(claimJob(), undefined);
    recoverJobs();
    assert.equal(claimJob()!.id, a.id);
    finishJob(a.id);
    assert.equal(claimJob(), undefined);
    updateScore(base.id, (s) => {
      s.status = "review";
    });
    assert.equal(savedScores().find((s) => s.id === base.id)?.status, "review");
    db().exec(
      "CREATE TRIGGER reject_job BEFORE INSERT ON jobs BEGIN SELECT RAISE(ABORT, 'simulated disk write failure'); END",
    );
    assert.throws(() =>
      transaction(() => {
        updateScore(base.id, (s) => {
          s.status = "generating";
        });
        enqueue(base.id, "render", "g");
      }),
    );
    assert.equal(savedScores().find((s) => s.id === base.id)?.status, "review");
  } finally {
    if (old === undefined) delete process.env.APP_DATA_DIR;
    else process.env.APP_DATA_DIR = old;
    rmSync(root, { recursive: true, force: true });
  }
});
