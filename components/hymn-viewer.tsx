"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Library from "./library";
import { signOut } from "@/app/login/actions";
import type { Hymn } from "@/lib/catalog";
import type { RenderResult } from "@/lib/render";
import { KEYS, chord_labels, type KeyId } from "@/lib/keys";
function Icon({ name }: { name: "download" | "share" | "search" | "music" }) {
  const paths = {
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5" />
        <path d="M4 16v5h16v-5" />
      </>
    ),
    share: (
      <>
        <path d="M9 13 15 7m-6 1V4h11v11h-4" />
        <path d="M13 4H4v16h16v-9" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    music: (
      <>
        <path d="M9 18V5l11-2v13M9 9l11-2" />
        <ellipse cx="6" cy="18" rx="3" ry="2" />
        <ellipse cx="17" cy="16" rx="3" ry="2" />
      </>
    ),
  };
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}
export default function HymnViewer({
  hymns,
  hymn,
  selectedKey,
}: {
  hymns: Hymn[];
  hymn: Hymn;
  selectedKey: KeyId;
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [output, setOutput] = useState<{
    identity: string;
    data: RenderResult;
  } | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [zoom, setZoom] = useState(false);
  const [shareMessage, setShareMessage] = useState("");
  const identity = `${hymn.id}:${selectedKey}`;
  const result = output?.identity === identity ? output.data : null;
  const keyInfo = KEYS.find((key) => key.id === selectedKey)!;
  const chords = chord_labels(selectedKey);
  const visibleHymns = hymns.filter((item) =>
    `${item.number} ${item.title}`.includes(search.trim()),
  );
  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setOutput(null);
    async function load() {
      try {
        const response = await fetch("/api/render", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hymnId: hymn.id, key: selectedKey }),
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok)
          throw new Error(data.error || "악보를 불러오지 못했습니다.");
        if (!controller.signal.aborted) setOutput({ identity, data });
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error ? error.message : "다시 시도해 주세요.",
          );
      }
    }
    void load();
    return () => controller.abort();
  }, [hymn.id, selectedKey, identity, retry]);
  async function share() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareMessage("현재 조의 링크를 복사했어요.");
    } catch {
      setShareMessage("주소창의 링크를 복사해 공유해 주세요.");
    }
  }
  return (
    <div className="app-shell">
      <header className="site-header">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <Icon name="music" />
          </span>
          유나와 함께 찬송을<span className="brand-divider" />
          <span className="brand-description">
            마음을 모으는 찬송, 우리에게 맞는 조로
          </span>
        </Link>
        <form action={signOut}>
          <button className="button">로그아웃</button>
        </form>
      </header>
      <main className="workspace">
        <Library hymns={hymns} currentId={hymn.id} />
        <section className="score-section" aria-label="악보">
          <div className="score-heading">
            <div>
              <p className="eyebrow">
                새찬송가 <span> / </span> {hymn.number}장
              </p>
              <h2>{hymn.title}</h2>
              <p className="song-subtitle">
                {hymn.category}
                <span>·</span>LYONS<span>·</span>3/4박자
              </p>
            </div>
            <button
              className="button share-button"
              aria-label="링크 공유"
              onClick={share}
            >
              <Icon name="share" />
              링크 공유
            </button>
          </div>
          <p className="share-message" role="status">
            {shareMessage}
          </p>
          <div className="score-controls">
            <div className="key-control">
              <label htmlFor="key-select">연주할 조</label>
              <select
                id="key-select"
                value={selectedKey}
                onChange={(event) => {
                  setError("");
                  setShareMessage("");
                  router.replace(
                    `/hymns/${hymn.id}?key=${event.target.value}`,
                    { scroll: false },
                  );
                }}
              >
                {KEYS.map((key) => (
                  <option key={key.id} value={key.id}>
                    {key.label}장조{key.id === hymn.sourceKey ? " · 기본" : ""}
                  </option>
                ))}
              </select>
              <span className="key-signature">{keyInfo.signature}</span>
            </div>
            <div className="download-actions">
              {result ? (
                <>
                  <a className="button" href={`${result.pdfUrl}?download=1`}>
                    <Icon name="download" />
                    PDF 다운로드
                  </a>
                  {result.pages.length > 0 && (
                    <a
                      className="button primary"
                      href={`${result.pages[0]}?download=1`}
                    >
                      <Icon name="download" />
                      PNG 다운로드{result.pages.length > 1 ? " · 1쪽" : ""}
                    </a>
                  )}
                </>
              ) : (
                <>
                  <button className="button" disabled>
                    <Icon name="download" />
                    PDF 다운로드
                  </button>
                  <button className="button primary" disabled>
                    <Icon name="download" />
                    PNG 다운로드
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="preview-toolbar">
            <span>
              <span className="status-dot" />
              {keyInfo.label}장조 악보{" "}
              <span className="preview-divider">|</span> {chords.I} ·{" "}
              {chords.IV} · {chords.V} · {chords.V7}
            </span>
            <button onClick={() => setZoom(!zoom)} aria-pressed={zoom}>
              {zoom ? "너비에 맞추기" : "확대해서 보기"}
              <span aria-hidden="true"> ↗</span>
            </button>
          </div>
          <div
            className={`preview-area ${zoom ? "zoomed" : ""}`}
            aria-busy={!result && !error}
          >
            {error ? (
              <div className="preview-state" role="alert">
                <span className="state-symbol">!</span>
                <h3>잠시, 악보를 준비하지 못했어요.</h3>
                <p>{error}</p>
                <button
                  className="button primary"
                  onClick={() => {
                    setError("");
                    setRetry((value) => value + 1);
                  }}
                >
                  다시 시도
                </button>
              </div>
            ) : !result ? (
              <div className="preview-state" role="status">
                <span className="loading-notes">♫</span>
                <h3>{keyInfo.label}장조 악보를 준비하고 있어요.</h3>
                <p>처음 준비하는 악보는 잠시 시간이 걸려요.</p>
              </div>
            ) : result.pages.length ? (
              result.pages.map((page, index) => (
                <figure className="score-paper" key={page}>
                  <img
                    src={page}
                    alt={`${hymn.number}장 ${hymn.title}, ${keyInfo.label}장조 악보 ${index + 1}쪽`}
                    onError={() =>
                      setError(
                        "악보 이미지를 불러오지 못했습니다. 다시 시도해 주세요.",
                      )
                    }
                  />
                  {result.pages.length > 1 && (
                    <figcaption>
                      {index + 1} / {result.pages.length}쪽{" "}
                      <a href={`${page}?download=1`}>이 페이지 PNG 다운로드</a>
                    </figcaption>
                  )}
                </figure>
              ))
            ) : (
              <div className="preview-state">
                <Icon name="music" />
                <h3>PDF 악보가 준비됐어요.</h3>
                <p>{result.warning}</p>
                <a
                  className="button primary"
                  href={result.pdfUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  PDF 열기
                </a>
              </div>
            )}
          </div>
          <footer className="score-footer">
            <span>인쇄할 때는 PDF를 사용해 주세요.</span>
            <span>함께 부르는 기쁨을 위해</span>
          </footer>
        </section>
      </main>
    </div>
  );
}
