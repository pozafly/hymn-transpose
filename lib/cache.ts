import {
  cachedResult,
  prepareSavedRender,
  type RenderResult,
} from "./render.ts";
import {
  enqueue,
  hasAnalysisJob,
  savedScore,
  scoreGeneration,
  transaction,
  updateScore,
  type SavedScore,
} from "./store.ts";
import type { KeyId } from "./keys.ts";

// Reconcile only viewed scores / existing results. Never pre-render the whole catalog.
export async function refreshScoreCache(
  id: string,
): Promise<SavedScore | undefined> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const original = savedScore(id);
    if (
      !original ||
      original.template ||
      original.status === "queued" ||
      (original.status === "analyzing" && hasAnalysisJob(id))
    )
      return original;
    // An OMR failure has no structured source yet and requires explicit retry.
    if (original.status === "error" && !original.cacheIdentity) return original;
    const context = await prepareSavedRender(original);
    const changed =
      !!original.cacheIdentity && original.cacheIdentity !== context.identity;
    const next: SavedScore = structuredClone(original);
    next.cacheIdentity = context.identity;
    next.sourceKey = context.sourceKey;
    next.mode = context.mode;
    if (changed) {
      next.revision++;
      next.keyErrors = {};
      delete next.error;
    }
    const keys = new Set<KeyId>(Object.keys(original.results) as KeyId[]);
    if (original.status === "generating")
      for (const k of original.requestedKeys) keys.add(k);
    if (changed)
      for (const k of Object.keys(original.keyErrors) as KeyId[]) keys.add(k);
    const rebuild: KeyId[] = [];
    for (const key of keys) {
      const cached = await cachedResult(context.forKey(key));
      if (cached) {
        next.results[key] = cached;
        delete next.keyErrors[key];
      } else {
        delete next.results[key];
        if (!next.keyErrors[key]) rebuild.push(key);
      }
    }
    const reviewing =
      original.status === "review" ||
      original.status === "analyzing" ||
      (original.status === "error" && changed);
    let rebuildPreview = false;
    if (original.preview || reviewing) {
      const preview = await cachedResult(context.forKey(context.sourceKey));
      if (preview) next.preview = preview;
      else delete next.preview;
      if (reviewing && !preview) rebuildPreview = true;
    }
    if (reviewing) next.status = rebuildPreview ? "analyzing" : "review";
    else if (rebuild.length) next.status = "generating";
    else if (
      next.status === "generating" &&
      next.requestedKeys.every((k) => next.results[k] || next.keyErrors[k])
    )
      next.status = "ready";
    const applied = transaction(() => {
      const current = savedScore(id);
      // Include result/job changes, not just revision, in the optimistic check.
      if (JSON.stringify(current) !== JSON.stringify(original)) return false;
      if (JSON.stringify(next) !== JSON.stringify(original))
        updateScore(id, (x) => {
          Object.assign(x, next);
          if (!next.preview) delete x.preview;
          if (!next.error) delete x.error;
        });
      for (const key of rebuild) enqueue(id, "render", key);
      if (rebuildPreview) enqueue(id, "preview");
      return true;
    });
    if (applied) return next;
  }
  throw new Error("악보 상태가 변경 중입니다. 잠시 후 다시 시도해 주세요.");
}

// Work uses an immutable source snapshot. Only that generation may publish its result.
export async function publishScoreResult(
  snapshot: SavedScore,
  key: KeyId,
  output: RenderResult,
  preview = false,
) {
  const current = savedScore(snapshot.id);
  if (!current || scoreGeneration(current) !== scoreGeneration(snapshot))
    return false;
  const context = await prepareSavedRender(current);
  if (
    context.identity !== snapshot.cacheIdentity ||
    context.forKey(key).version !== output.version
  )
    return false;
  return transaction(() => {
    const latest = savedScore(snapshot.id);
    if (!latest || scoreGeneration(latest) !== scoreGeneration(snapshot))
      return false;
    updateScore(snapshot.id, (x) => {
      if (preview) {
        x.preview = output;
        if (x.status === "analyzing" || x.status === "review")
          x.status = "review";
        delete x.error;
      } else {
        x.results[key] = output;
        delete x.keyErrors[key];
        x.status = x.requestedKeys.every((k) => x.results[k] || x.keyErrors[k])
          ? "ready"
          : "generating";
      }
    });
    return true;
  });
}
