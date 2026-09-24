import { readFile, writeFile, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import {
  claimJob,
  finishJob,
  recoverJobs,
  savedScore,
  scorePath,
  updateScore,
  workerHeartbeat,
  type Job,
  scoreGeneration,
} from "./store.ts";
import { unpackMusicXML, parseMusicXML } from "./musicxml.ts";
import { prepareSavedRender, renderPrepared } from "./render.ts";
import { refreshScoreCache, publishScoreResult } from "./cache.ts";
import { command as run } from "./command.ts";
async function files(root: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(root, { withFileTypes: true })) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) out.push(...(await files(p)));
    else out.push(p);
  }
  return out;
}
export async function processJob(job: Job) {
  let s = savedScore(job.score_id);
  if (!s) {
    finishJob(job.id);
    return;
  }
  try {
    if (job.kind !== "analyze") s = await refreshScoreCache(s.id);
    if (!s || (job.generation && job.generation !== scoreGeneration(s))) return;
    if (job.kind === "analyze") {
      updateScore(s.id, (x) => {
        x.status = "analyzing";
        delete x.error;
      });
      const out = scorePath(s.id, "analysis");
      await rm(out, { recursive: true, force: true });
      await mkdir(out, { recursive: true });
      let log = "";
      try {
        const r = await run(
          process.env.AUDIVERIS_BIN || "/opt/audiveris/bin/Audiveris",
          [
            "-batch",
            "-constant",
            "org.audiveris.omr.text.Language.defaultSpecification=kor+eng",
            "-transcribe",
            "-export",
            "-output",
            out,
            "--",
            scorePath(s.id, "original.png"),
          ],
          {
            timeout: 180_000,
            maxBuffer: 8 * 1024 * 1024,
            env: {
              ...process.env,
              GDK_SCALE: "1",
              JAVA_TOOL_OPTIONS:
                "-Xmx2048m -Djava.awt.headless=true -Dsun.java2d.uiScale=1",
            },
          },
        );
        log = r.stdout + "\n" + r.stderr;
      } catch (e) {
        const r = e as { stdout?: string; stderr?: string };
        await writeFile(
          scorePath(s.id, "analysis.log"),
          (r.stdout || "") + (r.stderr || ""),
        );
        throw new Error(
          "사진을 분석하지 못했어요. 악보를 정면에서 선명하게 찍어 다시 올리거나 재시도해 주세요.",
        );
      }
      await writeFile(scorePath(s.id, "analysis.log"), log);
      const candidates = (await files(out)).filter(
        (f) => f.endsWith(".mxl") || f.endsWith(".musicxml"),
      );
      if (candidates.length !== 1)
        throw new Error(
          "악보 전체를 한 곡으로 읽지 못했어요. 한 곡의 한 페이지를 올려 주세요.",
        );
      const xml = unpackMusicXML(await readFile(candidates[0]));
      const parsed = parseMusicXML(xml, s.modeOverride);
      if (scoreGeneration(savedScore(s.id)!) !== scoreGeneration(s)) return;
      await writeFile(scorePath(s.id, "score.musicxml"), xml);
      updateScore(s.id, (x) => {
        x.sourceKey = parsed.sourceKey;
        x.mode = parsed.mode;
        x.analysisStats = {
          notes: parsed.noteCount,
          lyrics: parsed.measures
            .flat()
            .flatMap((m) => Object.values(m.voices).flat())
            .reduce(
              (count, event) =>
                count + Object.values(event.lyrics).filter(Boolean).length,
              0,
            ),
        };
        x.warnings = [
          ...parsed.warnings,
          "사진에서 인식한 악보예요. 음표·가사·코드를 원본과 비교해 주세요.",
        ];
        if (/WARN|Exception|Failed loading/.test(log))
          x.warnings.push("분석 도구에서 일부 요소에 대한 경고가 발생했어요.");
        x.revision++;
        x.results = {};
        x.keyErrors = {};
        delete x.preview;
      });
      s = savedScore(s.id)!;
      const context = await prepareSavedRender(s);
      s = updateScore(s.id, (x) => {
        x.cacheIdentity = context.identity;
      });
      const preview = await renderPrepared(context.forKey(parsed.sourceKey));
      await publishScoreResult(s, parsed.sourceKey, preview, true);
    } else {
      const context = await prepareSavedRender(s);
      // An externally replaced source can change between the cache check and this read.
      if (context.identity !== s.cacheIdentity) return;
      const key = job.kind === "preview" ? context.sourceKey : job.target;
      const output = await renderPrepared(context.forKey(key));
      await publishScoreResult(s, key, output, job.kind === "preview");
    }
  } catch (e) {
    console.error("Job failed", job.id, e);
    const message =
      e instanceof Error ? e.message : "작업을 완료하지 못했습니다.";
    if (!s) return;
    const current = savedScore(s.id);
    if (!current || scoreGeneration(current) !== scoreGeneration(s)) return;
    if (job.kind !== "analyze") {
      const context = await prepareSavedRender(current).catch(() => null);
      if (context && context.identity !== s.cacheIdentity) return;
    }
    updateScore(s.id, (x) => {
      if (scoreGeneration(x) !== scoreGeneration(s!)) return;
      if (job.kind !== "render") {
        x.status = "error";
        x.error = message;
      } else {
        x.keyErrors[job.target] = message;
        x.status = x.requestedKeys.every((k) => x.results[k] || x.keyErrors[k])
          ? "ready"
          : "generating";
      }
    });
  } finally {
    finishJob(job.id);
    // A stale generation must not block the replacement job, including after failure.
    await refreshScoreCache(job.score_id).catch((e) =>
      console.error("Cache reconciliation failed", job.score_id, e),
    );
  }
}
async function main() {
  recoverJobs();
  workerHeartbeat();
  const heartbeat = setInterval(workerHeartbeat, 10_000);
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const)
    process.on(signal, () => {
      stopping = true;
    });
  while (!stopping) {
    const j = claimJob();
    if (j) await processJob(j);
    else await new Promise((r) => setTimeout(r, 1000));
  }
  clearInterval(heartbeat);
}
if (process.argv[1]?.endsWith("worker.ts")) void main();
