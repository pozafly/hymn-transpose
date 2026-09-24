import { login, logout } from "@/lib/auth";
function sameOrigin(request: Request) {
  try {
    return (
      new URL(request.headers.get("origin") || "").host ===
      request.headers.get("host")
    );
  } catch {
    return false;
  }
}
export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  try {
    const body = await request.json();
    if (typeof body.password !== "string" || body.password.length > 500)
      throw new Error("비밀번호를 확인해 주세요.");
    await login(body.password);
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "로그인 실패" },
      { status: 401 },
    );
  }
}
export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return new Response("Forbidden", { status: 403 });
  await logout();
  return Response.json({ ok: true });
}
