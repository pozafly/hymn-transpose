import Link from "next/link";
import type { ReactNode } from "react";
import type { Hymn } from "@/lib/catalog";
import Library from "./library";
import { signOut } from "@/app/login/actions";
export default function LibraryShell({
  hymns,
  currentId,
  children,
}: {
  hymns: Hymn[];
  currentId?: string;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <header className="site-header">
        <Link href="/" className="brand">
          <span className="brand-mark">♫</span>유나와 함께 찬송을
        </Link>
        <form action={signOut}>
          <button className="button">로그아웃</button>
        </form>
      </header>
      <main className="workspace">
        <Library hymns={hymns} currentId={currentId} />
        <section className="score-section">{children}</section>
      </main>
    </div>
  );
}
