"use client";
import { useActionState } from "react";
import { signIn } from "./actions";
export default function Login() {
  const [error, action, pending] = useActionState(signIn, "");
  return (
    <main className="login-card">
      <p className="eyebrow">PRIVATE MUSIC LIBRARY</p>
      <h1>유나와 함께 찬송을</h1>
      <p>우리에게 맞는 조로, 편안하게 연주하세요.</p>
      <form action={action}>
        <label>
          비밀번호
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
          />
        </label>
        <button className="button primary" disabled={pending}>
          {pending ? "로그인 중…" : "로그인"}
        </button>
        <p role="alert">{error}</p>
      </form>
      <small>로그인은 이 기기에서 30일 동안 유지됩니다.</small>
    </main>
  );
}
