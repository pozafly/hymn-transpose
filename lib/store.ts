import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { KeyId } from "./keys.ts";
import type { RenderResult } from "./render.ts";

export type SavedScore = {
  id: string;
  number: number;
  title: string;
  category: string;
  sourceKey: KeyId;
  template: string;
  kind: "builtin" | "upload";
  mode: "major" | "minor";
  modeOverride?: "major" | "minor";
  createdAt: string;
  status: "queued" | "analyzing" | "review" | "generating" | "ready" | "error";
  requestedKeys: KeyId[];
  results: Partial<Record<KeyId, RenderResult>>;
  keyErrors: Partial<Record<KeyId, string>>;
  warnings: string[];
  error?: string;
  preview?: RenderResult;
  revision: number;
  cacheIdentity?: string;
  originalCount: number;
  analysisStats?: { notes: number; lyrics: number };
  sourceCredit?: string;
};
export const dataDirectory = () =>
  path.resolve(/* turbopackIgnore: true */ process.env.APP_DATA_DIR || "data");
export function scorePath(id: string, ...names: string[]) {
  if (!/^(\d{1,3}|u-[a-f0-9-]{36})$/.test(id))
    throw new Error("악보 ID가 올바르지 않습니다.");
  return path.join(dataDirectory(), "library", id, ...names);
}
const state = globalThis as typeof globalThis & {
  scoreDB?: DatabaseSync;
  scoreDBPath?: string;
};
export function db() {
  const root = dataDirectory();
  if (state.scoreDB && state.scoreDBPath === root) return state.scoreDB;
  mkdirSync(root, { recursive: true });
  const d = new DatabaseSync(path.join(root, "library.sqlite"));
  d.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS scores (id TEXT PRIMARY KEY, record TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, score_id TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS job_status ON jobs(status,created);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, expires INTEGER NOT NULL, fingerprint TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS login_attempts (id INTEGER PRIMARY KEY CHECK(id=1), failures INTEGER NOT NULL, until INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS worker_health (id INTEGER PRIMARY KEY CHECK(id=1), heartbeat INTEGER NOT NULL);
  `);
  const columns = d.prepare("PRAGMA table_info(jobs)").all() as {
    name: string;
  }[];
  if (!columns.some((c) => c.name === "generation")) {
    try {
      d.exec("ALTER TABLE jobs ADD COLUMN generation TEXT NOT NULL DEFAULT ''");
    } catch (error) {
      if (
        !(
          d.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]
        ).some((c) => c.name === "generation")
      )
        throw error;
    }
  }
  d.exec(
    "CREATE INDEX IF NOT EXISTS job_identity ON jobs(score_id,kind,target,generation,status)",
  );
  state.scoreDB = d;
  state.scoreDBPath = root;
  return d;
}
export function savedScore(id: string): SavedScore | undefined {
  const row = db().prepare("SELECT record FROM scores WHERE id=?").get(id) as
    { record: string } | undefined;
  return row ? JSON.parse(row.record) : undefined;
}
export function savedScores(): SavedScore[] {
  return (
    db().prepare("SELECT record FROM scores ORDER BY rowid DESC").all() as {
      record: string;
    }[]
  ).map((r) => JSON.parse(r.record));
}
export function insertScore(record: SavedScore) {
  db()
    .prepare("INSERT INTO scores(id,record) VALUES (?,?)")
    .run(record.id, JSON.stringify(record));
}
// Callbacks must be synchronous so no other request can enter this transaction.
export function transaction<T>(fn: () => T): T {
  const d = db();
  if (d.isTransaction) return fn();
  d.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    d.exec("COMMIT");
    return result;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}
export function updateScore(id: string, fn: (s: SavedScore) => void) {
  const d = db();
  return transaction(() => {
    const s = savedScore(id);
    if (!s) throw new Error("악보를 찾을 수 없습니다.");
    fn(s);
    d.prepare("UPDATE scores SET record=? WHERE id=?").run(
      JSON.stringify(s),
      id,
    );
    return s;
  });
}
export function enqueue(
  id: string,
  kind: "analyze" | "render" | "preview",
  target = "",
) {
  const d = db();
  const score = savedScore(id);
  const generation = score ? scoreGeneration(score) : "";
  d.prepare(
    `INSERT INTO jobs(id,score_id,kind,target,created,generation) SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM jobs WHERE score_id=? AND kind=? AND target=? AND generation=? AND status IN ('queued','running'))`,
  ).run(
    randomUUID(),
    id,
    kind,
    target,
    Date.now(),
    generation,
    id,
    kind,
    target,
    generation,
  );
}
export function scoreGeneration(score: SavedScore) {
  return `${score.revision}:${score.cacheIdentity || ""}`;
}
export function hasAnalysisJob(id: string) {
  return !!db()
    .prepare(
      "SELECT 1 FROM jobs WHERE score_id=? AND kind='analyze' AND status IN ('queued','running') LIMIT 1",
    )
    .get(id);
}
export type Job = {
  id: string;
  score_id: string;
  kind: "analyze" | "render" | "preview";
  target: KeyId;
  attempts: number;
  generation: string;
};
export function claimJob(): Job | undefined {
  return db()
    .prepare(
      `UPDATE jobs SET status='running',attempts=attempts+1 WHERE id=(SELECT id FROM jobs WHERE status='queued' ORDER BY created LIMIT 1) RETURNING *`,
    )
    .get() as Job | undefined;
}
export function finishJob(id: string) {
  db().prepare("UPDATE jobs SET status='done' WHERE id=?").run(id);
}
export function recoverJobs() {
  db().exec("UPDATE jobs SET status='queued' WHERE status='running'");
}
export function workerHeartbeat() {
  db()
    .prepare(
      "INSERT INTO worker_health VALUES(1,?) ON CONFLICT(id) DO UPDATE SET heartbeat=excluded.heartbeat",
    )
    .run(Date.now());
}
export function workerOnline() {
  const r = db()
    .prepare("SELECT heartbeat FROM worker_health WHERE id=1")
    .get() as { heartbeat: number } | undefined;
  return !!r && Date.now() - r.heartbeat < 60_000;
}
