import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./store.ts";
const cookieName = "hymn_session";
const hash = (x: string) => createHash("sha256").update(x).digest("hex");
export async function authorized() {
  if (!process.env.APP_PASSWORD) return false;
  const token = (await cookies()).get(cookieName)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return false;
  const row = db()
    .prepare("SELECT expires,fingerprint FROM sessions WHERE token=?")
    .get(hash(token)) as { expires: number; fingerprint: string } | undefined;
  return (
    !!row &&
    row.expires > Date.now() &&
    row.fingerprint === hash(process.env.APP_PASSWORD)
  );
}
export async function requirePageAuth() {
  if (!(await authorized())) redirect("/login");
}
export async function apiAuth(request?: Request) {
  if (!(await authorized()))
    return Response.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (request && !["GET", "HEAD"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    let validOrigin = false;
    try {
      validOrigin = !!origin && new URL(origin).host === host;
    } catch {}
    if (!validOrigin)
      return Response.json(
        { error: "허용하지 않는 요청입니다." },
        { status: 403 },
      );
  }
  return null;
}
export async function login(password: string) {
  if (!process.env.APP_PASSWORD)
    throw new Error("서버에 APP_PASSWORD를 설정해 주세요.");
  const d = db();
  const lock = d
    .prepare("SELECT failures,until FROM login_attempts WHERE id=1")
    .get() as { failures: number; until: number } | undefined;
  if (lock && lock.until > Date.now())
    throw new Error("로그인 시도가 많습니다. 5분 뒤 다시 시도해 주세요.");
  const valid = timingSafeEqual(
    Buffer.from(hash(password)),
    Buffer.from(hash(process.env.APP_PASSWORD)),
  );
  if (!valid) {
    const failures = (lock && lock.until === 0 ? lock.failures : 0) + 1;
    d.prepare("INSERT OR REPLACE INTO login_attempts VALUES(1,?,?)").run(
      failures,
      failures >= 10 ? Date.now() + 300_000 : 0,
    );
    throw new Error("비밀번호를 확인해 주세요.");
  }
  d.exec("DELETE FROM login_attempts");
  d.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
  const token = randomBytes(32).toString("hex"),
    age = 60 * 60 * 24 * 30;
  d.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
    hash(token),
    Date.now() + age * 1000,
    hash(process.env.APP_PASSWORD),
  );
  const h = await headers();
  (await cookies()).set(cookieName, token, {
    httpOnly: true,
    secure:
      process.env.COOKIE_SECURE === "true" ||
      h.get("x-forwarded-proto") === "https",
    sameSite: "lax",
    maxAge: age,
    path: "/",
  });
}
export async function logout() {
  const c = await cookies();
  const t = c.get(cookieName)?.value;
  if (t) db().prepare("DELETE FROM sessions WHERE token=?").run(hash(t));
  c.delete(cookieName);
}
