import { isKey } from "@/lib/keys";
import { render, RenderError } from "@/lib/render";

export const runtime = "nodejs";
export async function POST(request: Request) {
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
