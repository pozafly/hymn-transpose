import { isKey } from "@/lib/keys";
import { render, RenderError } from "@/lib/render";
import { apiAuth } from "@/lib/auth";
import { enqueue, updateScore, transaction } from "@/lib/store";
import { refreshScoreCache } from "@/lib/cache";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const denied = await apiAuth(request);
  if (denied) return denied;
  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON 요청이 필요합니다." }, { status: 400 });
  }
  if (!body || typeof body.hymnId !== "string" || !isKey(body.key)) {
    return Response.json(
      { error: "곡 번호와 지원하는 조를 선택해 주세요." },
      { status: 400 },
    );
  }
  try {
    const stored = await refreshScoreCache(body.hymnId);
    if (stored) {
      if (stored.results[body.key as keyof typeof stored.results])
        return Response.json(
          stored.results[body.key as keyof typeof stored.results],
        );
      if (
        stored.kind === "upload" &&
        ["queued", "analyzing", "error", "review"].includes(stored.status)
      )
        return Response.json(
          { error: "분석 결과를 먼저 확인해 주세요." },
          { status: 409 },
        );
      transaction(() => {
        updateScore(stored.id, (s) => {
          if (!s.requestedKeys.includes(body.key))
            s.requestedKeys.push(body.key);
          s.status = "generating";
        });
        enqueue(stored.id, "render", body.key);
      });
      return Response.json({ pending: true }, { status: 202 });
    }
    return Response.json(await render(body.hymnId, body.key));
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof RenderError
            ? error.message
            : "서버 오류가 발생했습니다.",
      },
      { status: error instanceof RenderError ? error.status : 500 },
    );
  }
}
