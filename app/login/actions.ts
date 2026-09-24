"use server";
import { login, logout } from "@/lib/auth";
import { redirect } from "next/navigation";
export async function signIn(_state: string, form: FormData) {
  try {
    await login(String(form.get("password") || ""));
  } catch (e) {
    return e instanceof Error ? e.message : "로그인하지 못했습니다.";
  }
  redirect("/");
}
export async function signOut() {
  await logout();
  redirect("/login");
}
