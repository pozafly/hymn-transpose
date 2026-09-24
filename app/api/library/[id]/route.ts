import { readFile } from "node:fs/promises";
import { apiAuth } from "@/lib/auth";
import {
  savedScore,
  updateScore,
  enqueue,
  scorePath,
  workerOnline,
  transaction,
} from "@/lib/store";
import { isKey } from "@/lib/keys";
import { parseMusicXML } from "@/lib/musicxml";
import { refreshScoreCache } from "@/lib/cache";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, { params }: Context) {
  const denied = await apiAuth();
  if (denied) return denied;
  const { id } = await params;
  const s =
    new URL(request.url).searchParams.get("original") === "1"
      ? savedScore(id)
      : await refreshScoreCache(id);
  if (!s) return Response.json({ error: "악보가 없습니다." }, { status: 404 });
  if (new URL(request.url).searchParams.get("original") === "1") {
    try {
      return new Response(await readFile(scorePath(id, "original.png")), {
        headers: {
          "Content-Type": "image/png",
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }
  return Response.json(
    { score: s, workerOnline: workerOnline() },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
export async function POST(request: Request, { params }: Context) {
  const denied = await apiAuth(request);
  if (denied) return denied;
  const { id } = await params;
  const s = await refreshScoreCache(id);
  if (!s) return Response.json({ error: "악보가 없습니다." }, { status: 404 });
  try {
    const body = await request.json();
    if (body.action === "retry-analysis") {
      if (s.kind !== "upload" || s.status !== "error")
        throw new Error("실패한 분석만 재시도할 수 있어요.");
      transaction(() => {
        updateScore(id, (x) => {
          x.status = "queued";
          delete x.error;
        });
        enqueue(id, "analyze");
      });
    } else if (body.action === "generate") {
      if (!["review", "ready", "generating"].includes(s.status))
        throw new Error("분석이 완료된 뒤 생성할 수 있어요.");
      const keys = body.keys ?? s.requestedKeys;
      if (
        !Array.isArray(keys) ||
        !keys.length ||
        keys.length > 13 ||
        !keys.every(isKey)
      )
        throw new Error("생성할 조를 확인해 주세요.");
      transaction(() => {
        const record = updateScore(id, (x) => {
          x.requestedKeys = [...new Set([...x.requestedKeys, ...keys])];
          for (const k of keys as (keyof typeof x.keyErrors)[])
            delete x.keyErrors[k];
          x.status = "generating";
        });
        for (const k of record.requestedKeys)
          if (!record.results[k]) enqueue(id, "render", k);
        if (record.requestedKeys.every((k) => record.results[k]))
          updateScore(id, (x) => {
            x.status = "ready";
          });
      });
    } else if (body.action === "mode") {
      if (
        s.kind !== "upload" ||
        !["review", "ready"].includes(s.status) ||
        !["major", "minor"].includes(body.mode)
      )
        throw new Error("작업이 끝난 뒤 장·단조를 선택해 주세요.");
      const parsed = parseMusicXML(
        await readFile(scorePath(id, "score.musicxml"), "utf8"),
        body.mode,
      );
      transaction(() => {
        updateScore(id, (x) => {
          x.modeOverride = body.mode;
          x.mode = parsed.mode;
          x.sourceKey = parsed.sourceKey;
          x.results = {};
          x.keyErrors = {};
          x.preview = undefined;
          x.status = "analyzing";
          x.revision++;
          x.warnings = parsed.warnings;
        });
        enqueue(id, "preview");
      });
    } else if (body.action === "rename") {
      const title = String(body.title || "").trim(),
        number = Number(body.number || 0);
      if (
        s.kind !== "upload" ||
        !title ||
        title.length > 120 ||
        !Number.isInteger(number) ||
        number < 0 ||
        number > 645
      )
        throw new Error("제목과 번호를 확인해 주세요.");
      if (["queued", "analyzing", "generating"].includes(s.status))
        throw new Error("작업이 끝난 뒤 수정해 주세요.");
      // Title is printed in generated files. Re-render after a title edit.
      transaction(() => {
        updateScore(id, (x) => {
          x.title = title;
          x.number = number;
          x.results = {};
          x.keyErrors = {};
          x.preview = undefined;
          x.status = "analyzing";
          x.revision++;
        });
        enqueue(id, "preview");
      });
    } else throw new Error("지원하지 않는 요청입니다.");
    return Response.json({ score: savedScore(id) });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "요청 오류" },
      { status: 400 },
    );
  }
}
