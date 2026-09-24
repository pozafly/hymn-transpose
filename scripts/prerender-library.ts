import { parseArgs } from "node:util";
import { rename } from "node:fs/promises";
import path from "node:path";
import { getHymns, type Hymn } from "../lib/catalog.ts";
import { KEYS, isKey, type KeyId } from "../lib/keys.ts";
import { refreshScoreCache } from "../lib/cache.ts";
import {
  cachedResult,
  cacheDirectory,
  prepareRender,
  prepareSavedRender,
  render,
  type PreparedRender,
} from "../lib/render.ts";
import {
  db,
  savedScore,
  scoreGeneration,
  updateScore,
  workerOnline,
} from "../lib/store.ts";

const { values } = parseArgs({
  options: {
    status: { type: "boolean" },
    "retry-failed": { type: "boolean" },
    hymn: { type: "string", multiple: true },
    key: { type: "string", multiple: true },
  },
});
const selectedKeys = [...new Set(values.key || KEYS.map((key) => key.id))];
for (const key of selectedKeys)
  if (!isKey(key)) throw new Error(`지원하지 않는 조: ${key}`);
const keys = selectedKeys as KeyId[];
const ids = [
  ...new Set(values.hymn || Array.from({ length: 645 }, (_, i) => String(i + 1))),
];
for (const id of ids)
  if (!/^[1-9]\d{0,2}$/.test(id) || Number(id) > 645)
    throw new Error(`찬송가 번호는 1~645입니다: ${id}`);

type Problem = { hymn: string; key?: KeyId; error: string };

async function retryPartial(prepared: PreparedRender) {
  if (!values["retry-failed"]) return;
  const cached = await cachedResult(prepared);
  if (!cached || (cached.pages.length && !cached.warning)) return;
  const manifest = path.join(
    cacheDirectory(),
    prepared.id,
    prepared.key,
    prepared.version,
    "manifest.json",
  );
  // Keep the PDF and previous manifest while making a partial result eligible
  // for regeneration after an explicit retry.
  await rename(manifest, `${manifest}.partial-${Date.now()}`).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
}

async function progress(targets: Hymn[]) {
  const jobs = db()
    .prepare(
      "SELECT score_id,target,generation FROM jobs WHERE kind='render' AND status IN ('queued','running')",
    )
    .all() as { score_id: string; target: string; generation: string }[];
  const active = new Set(
    jobs.map((job) => `${job.score_id}:${job.target}:${job.generation}`),
  );
  const summary = {
    hymns: targets.length,
    keys: keys.length,
    total: targets.length * keys.length,
    completed: 0,
    pending: 0,
    failed: 0,
    notQueued: 0,
    workerOnline: workerOnline(),
    errors: [] as Problem[],
  };
  for (const hymn of targets) {
    const stored = hymn.template ? undefined : savedScore(hymn.id);
    let context: Awaited<ReturnType<typeof prepareSavedRender>> | undefined;
    try {
      if (!hymn.template && !stored)
        throw new Error("등록된 기본 악보가 없습니다.");
      context = stored && (await prepareSavedRender(stored));
    } catch (error) {
      summary.failed += keys.length;
      summary.errors.push({ hymn: hymn.id, error: String(error) });
      continue;
    }
    for (const key of keys) {
      try {
        const prepared = context
          ? context.forKey(key)
          : await prepareRender(hymn.id, key);
        const cached = await cachedResult(prepared);
        const registered =
          !stored || stored.results[key]?.version === cached?.version;
        if (cached && registered && cached.pages.length && !cached.warning) {
          summary.completed++;
        } else if (
          stored &&
          active.has(`${hymn.id}:${key}:${scoreGeneration(stored)}`)
        ) {
          summary.pending++;
        } else {
          const error = cached?.warning || stored?.keyErrors[key];
          if (error) {
            summary.failed++;
            summary.errors.push({ hymn: hymn.id, key, error });
          } else summary.notQueued++;
        }
      } catch (error) {
        summary.failed++;
        summary.errors.push({ hymn: hymn.id, key, error: String(error) });
      }
    }
  }
  return summary;
}

async function main() {
  if (values.status && values["retry-failed"])
    throw new Error("--status와 --retry-failed는 함께 사용할 수 없습니다.");
  const catalog = await getHymns();
  const missing = ids.filter(
    (id) => !catalog.some((hymn) => hymn.id === id && hymn.kind === "builtin"),
  );
  if (missing.length)
    throw new Error(
      `먼저 기본 찬송가를 등록해 주세요. 없는 곡: ${missing.join(", ")}`,
    );
  const targets = catalog.filter(
    (hymn) => hymn.kind === "builtin" && ids.includes(hymn.id),
  );
  const problems: Problem[] = [];
  if (!values.status) {
    console.log(
      `${targets.length}곡 × ${keys.length}개 조 = ${targets.length * keys.length}개 조합 준비`,
    );
    // Template 67 has no SQLite score record. Finish its few keys first;
    // every remaining render can then be resumed by the persistent worker.
    for (const hymn of targets.filter((hymn) => hymn.template)) {
      for (const key of keys) {
        try {
          await retryPartial(await prepareRender(hymn.id, key));
          const output = await render(hymn.id, key);
          if (output.warning || !output.pages.length)
            throw new Error(output.warning || "PNG가 생성되지 않았습니다.");
          console.log(`${hymn.id}장 ${key}: 준비 완료`);
        } catch (error) {
          problems.push({ hymn: hymn.id, key, error: String(error) });
          console.error(`${hymn.id}장 ${key}: ${error}`);
        }
      }
    }
    let registered = 0;
    for (const hymn of targets.filter((hymn) => !hymn.template)) {
      try {
        // Register the requested keys in the same record read by the app.
        // Reconciliation reuses current files and deduplicates queued jobs.
        const current = await refreshScoreCache(hymn.id);
        if (!current || current.kind !== "builtin")
          throw new Error("등록된 기본 악보가 없습니다.");
        if (values["retry-failed"]) {
          const context = await prepareSavedRender(current);
          for (const key of keys) await retryPartial(context.forKey(key));
        }
        updateScore(hymn.id, (score) => {
          score.requestedKeys = [...new Set([...score.requestedKeys, ...keys])];
          if (values["retry-failed"])
            for (const key of keys) delete score.keyErrors[key];
          score.status = "generating";
        });
        await refreshScoreCache(hymn.id);
        registered++;
        if (registered % 25 === 0)
          console.log(`${registered}곡의 조별 작업 등록 완료`);
      } catch (error) {
        problems.push({ hymn: hymn.id, error: String(error) });
        console.error(`${hymn.id}장: ${error}`);
      }
    }
    console.log("작업 등록 종료. 대기 중인 작업은 worker가 계속 처리합니다.");
  }
  const summary = await progress(targets);
  console.log(
    JSON.stringify({
      ...summary,
      ...(problems.length ? { registrationErrors: problems } : {}),
    }),
  );
  if (summary.failed || summary.notQueued || problems.length)
    process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
