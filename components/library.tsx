"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Hymn } from "@/lib/catalog";
export const statusText: Record<string, string> = {
  queued: "분석 대기",
  analyzing: "분석 중",
  review: "결과 확인",
  generating: "조 생성 중",
  ready: "준비됨",
  error: "분석 실패",
};
export default function Library({
  hymns,
  currentId,
}: {
  hymns: Hymn[];
  currentId?: string;
}) {
  const [items, setItems] = useState(hymns),
    [query, setQuery] = useState("");
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await fetch("/api/hymns", { cache: "no-store" });
        if (r.status === 401) {
          location.href = "/login";
          return;
        }
        if (r.ok && live) setItems((await r.json()).hymns);
      } catch {}
    };
    void load();
    const t = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, []);
  const term = query.trim().replaceAll(" ", "").toLowerCase();
  const numberQuery = /^(\d{1,3})장?$/.exec(term);
  const visible = items.filter((s) =>
    numberQuery
      ? s.number === Number(numberQuery[1])
      : s.title.replaceAll(" ", "").toLowerCase().includes(term),
  );
  return (
    <aside className="library" aria-label="찬송가 목록">
      <p className="eyebrow">MY MUSIC LIBRARY</p>
      <h1>
        오늘의 찬송을
        <br />
        준비해 보세요.
      </h1>
      <p className="intro">
        기본 찬송가와 직접 올린 악보를
        <br />
        한곳에서 찾아보세요.
      </p>
      <Link href="/upload" className="button primary upload-link">
        ＋ 악보 사진 올리기
      </Link>
      <label className="search-box">
        <span aria-hidden>⌕</span>
        <input
          aria-label="찬송가 검색"
          placeholder="장 번호 또는 제목 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="list-heading">
        <h2>악보 보관함</h2>
        <span>{visible.length}개</span>
      </div>
      <nav className="hymn-list" aria-label="곡 선택">
        {visible.map((s) => (
          <Link
            key={s.id}
            href={`/hymns/${s.id}`}
            className={`hymn-card ${s.id === currentId ? "selected" : ""}`}
            aria-current={s.id === currentId ? "page" : undefined}
          >
            <span className="hymn-number">
              {s.number || "♫"}
              {s.number > 0 && <small>장</small>}
            </span>
            <span className="hymn-info">
              <strong>{s.title}</strong>
              <small>
                {s.kind === "upload"
                  ? `내 악보 · ${s.createdAt?.slice(5, 10).replace("-", "월 ")}일`
                  : "기본 찬송가"}
                {s.status && s.status !== "ready"
                  ? ` · ${statusText[s.status]}`
                  : ""}
              </small>
            </span>
          </Link>
        ))}
        {!visible.length && (
          <p className="empty-search">
            검색 결과가 없어요.
            <br />
            번호나 제목을 다시 확인해 주세요.
          </p>
        )}
      </nav>
    </aside>
  );
}
