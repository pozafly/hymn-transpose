"use client";
import { useEffect, useState } from "react";
import type { SavedScore } from "@/lib/store";
import { KEYS, type KeyId } from "@/lib/keys";
import KeyPicker from "./key-picker";
import { statusText } from "./library";
export default function SavedViewer({ initial }: { initial: SavedScore }) {
  const [score, setScore] = useState(initial),
    [selected, setSelected] = useState<KeyId>(
      initial.requestedKeys[0] || initial.sourceKey,
    ),
    [keys, setKeys] = useState<KeyId[]>(initial.requestedKeys),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [online, setOnline] = useState(true),
    [editing, setEditing] = useState(false);
  useEffect(() => {
    if (
      initial.kind === "builtin" &&
      !initial.results[initial.sourceKey] &&
      !initial.keyErrors[initial.sourceKey]
    )
      void action({ action: "generate", keys: [initial.sourceKey] });
  }, [initial.id]);
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/library/${initial.id}`, {
          cache: "no-store",
        });
        if (r.status === 401) {
          location.href = "/login";
          return;
        }
        if (!r.ok) throw new Error("악보 상태를 불러오지 못했어요.");
        const d = await r.json();
        if (live) {
          setScore(d.score);
          setOnline(d.workerOnline);
        }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "연결 오류");
      }
    };
    void load();
    const t = setInterval(load, 2000);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [initial.id]);
  async function action(body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/library/${score.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setScore(d.score);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "요청 실패");
    } finally {
      setBusy(false);
    }
  }
  const reviewing = score.status === "review";
  const output = reviewing ? score.preview : score.results[selected];
  const active = ["queued", "analyzing", "generating"].includes(score.status);
  const label = KEYS.find(
    (k) => k.id === (reviewing ? score.sourceKey : selected),
  )?.label;
  return (
    <>
      <div className="score-heading">
        <div>
          <p className="eyebrow">
            {score.kind === "upload" ? "내 악보" : "기본 찬송가"}
            {score.number > 0 ? ` / ${score.number}장` : ""}
          </p>
          <h2>{score.title}</h2>
          <p className="song-subtitle">
            {statusText[score.status]} ·{" "}
            {score.mode === "minor" ? "단조" : "장조"}
          </p>
        </div>
        {score.kind === "upload" && (
          <button
            className="button"
            disabled={active}
            onClick={() => setEditing(!editing)}
          >
            이름 수정
          </button>
        )}
      </div>
      {editing && (
        <form
          className="panel form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void action({
              action: "rename",
              title: f.get("title"),
              number: f.get("number"),
            });
          }}
        >
          <label>
            악보 제목
            <input
              name="title"
              defaultValue={score.title}
              required
              maxLength={120}
            />
          </label>
          <label>
            찬송가 번호
            <input
              name="number"
              type="number"
              min={1}
              max={645}
              defaultValue={score.number || ""}
            />
          </label>
          <button className="button primary" disabled={busy}>
            저장
          </button>
        </form>
      )}
      <div className="workflow-status" role="status">
        <span className={active ? "loading-notes" : ""}>
          {active ? "♫" : "✓"}
        </span>
        <div>
          <strong>{statusText[score.status]}</strong>
          <p>
            {score.status === "queued" || score.status === "analyzing"
              ? "사진에서 음표와 가사를 읽고 있어요. 다른 화면으로 이동해도 작업은 계속됩니다."
              : reviewing
                ? "아래 원본과 분석된 악보를 비교한 뒤 조 생성을 시작해 주세요."
                : score.status === "generating"
                  ? `${Object.keys(score.results).length} / ${score.requestedKeys.length}개 조가 준비됐어요.`
                  : score.status === "error"
                    ? score.error
                    : "준비된 조를 선택해 악보를 내려받으세요."}
          </p>
        </div>
      </div>
      {!online && active && (
        <p className="notice">
          분석 서버 연결을 기다리고 있어요. 연결되면 작업을 이어갑니다.
        </p>
      )}
      {score.status === "error" && (
        <button
          className="button primary"
          disabled={busy}
          onClick={() => action({ action: "retry-analysis" })}
        >
          분석 다시 시도
        </button>
      )}
      <p role="alert" className="error-message">
        {error}
      </p>
      {(reviewing ||
        score.status === "ready" ||
        score.status === "generating") && (
        <div className="panel">
          {score.kind === "upload" && (
            <label className="key-control">
              원곡의 장·단조
              <select
                value={score.mode}
                disabled={busy || active}
                onChange={(e) =>
                  action({ action: "mode", mode: e.target.value })
                }
              >
                <option value="major">장조</option>
                <option value="minor">단조</option>
              </select>
            </label>
          )}
          <KeyPicker value={keys} onChange={setKeys} disabled={busy} />
          <button
            className="button primary"
            disabled={busy || !keys.length}
            onClick={() => action({ action: "generate", keys })}
          >
            {reviewing
              ? "분석 결과 확인 · 선택한 조 생성"
              : "선택한 조 생성 / 재시도"}
          </button>
        </div>
      )}
      {!reviewing && score.requestedKeys.length > 0 && (
        <div className="result-tabs" aria-label="생성한 조">
          {score.requestedKeys.map((k) => (
            <button
              className={`button ${selected === k ? "primary" : ""}`}
              key={k}
              onClick={() => setSelected(k)}
            >
              {KEYS.find((i) => i.id === k)?.label}
              {score.results[k]
                ? " ✓"
                : score.keyErrors[k]
                  ? " · 실패"
                  : " · 대기"}
            </button>
          ))}
        </div>
      )}
      {score.keyErrors[selected] && (
        <p role="alert" className="notice">
          {score.keyErrors[selected]} 위에서 이 조를 선택해 다시 생성할 수
          있어요.
        </p>
      )}
      {score.warnings.length > 0 && (
        <details className="notice" open={reviewing}>
          <summary>분석 결과 확인 사항 ({score.warnings.length})</summary>
          <ul>
            {score.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </details>
      )}
      {score.sourceCredit && <p className="hint">{score.sourceCredit}</p>}
      <div className="comparison">
        {score.kind === "upload" && (
          <details className="original-panel" open={reviewing || !output}>
            <summary>올린 원본 사진</summary>
            <img
              src={`/api/library/${score.id}?original=1`}
              alt="올린 원본 악보"
            />
          </details>
        )}
        <div>
          {output && (
            <>
              <div className="score-controls">
                <strong>
                  {label}
                  {score.mode === "minor" ? "단조" : "장조"}
                  {reviewing ? " · 분석 미리보기" : ""}
                </strong>
                <a className="button" href={`${output.pdfUrl}?download=1`}>
                  PDF 다운로드
                </a>
              </div>
              {output.warning && <p className="notice">{output.warning}</p>}
              <div className="preview-area">
                {output.pages.map((p, i) => (
                  <figure className="score-paper" key={p}>
                    <img src={p} alt={`${label} 악보 ${i + 1}쪽`} />
                    <figcaption>
                      <a href={`${p}?download=1`}>PNG 다운로드 · {i + 1}쪽</a>
                    </figcaption>
                  </figure>
                ))}
                {!output.pages.length && (
                  <a href={output.pdfUrl} className="button">
                    PDF 열기
                  </a>
                )}
              </div>
            </>
          )}
          {!output && active && (
            <div className="preview-state">
              <span className="loading-notes">♫</span>
              <h3>악보를 준비하고 있어요.</h3>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
