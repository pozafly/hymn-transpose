"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { KeyId } from "@/lib/keys";
import KeyPicker from "./key-picker";
export default function UploadForm() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(""),
    [keys, setKeys] = useState<KeyId[]>(["f", "g", "a"]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!file || !keys.length) {
      setError("사진과 생성할 조를 선택해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const form = new FormData(e.currentTarget);
      form.set("file", file);
      form.set("keys", JSON.stringify(keys));
      const r = await fetch("/api/upload", { method: "POST", body: form });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      router.push(`/hymns/${d.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "업로드하지 못했습니다.");
      setBusy(false);
    }
  }
  return (
    <>
      <p className="eyebrow">ADD YOUR SCORE</p>
      <h2 className="page-title">악보 사진 올리기</h2>
      <p className="page-intro">
        사진을 읽어 원하는 조의 악보로 만들어 드려요.
        <br />
        등록한 악보는 보관함에서 언제든 다시 찾을 수 있어요.
      </p>
      <form className="upload-form panel" onSubmit={submit}>
        <label className="file-drop">
          <strong>{file ? file.name : "악보 사진 선택"}</strong>
          <span>JPG · PNG · WebP / 한 페이지 / 최대 12MB</span>
          <input
            aria-label="악보 사진"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={busy}
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setError("");
            }}
          />
        </label>
        {preview && (
          <img
            className="upload-preview"
            src={preview}
            alt="선택한 원본 악보"
          />
        )}
        <div className="form-grid">
          <label>
            악보 제목
            <input
              name="title"
              required
              maxLength={120}
              placeholder="예: 영광의 왕께 다 경배하며"
              disabled={busy}
            />
          </label>
          <label>
            찬송가 번호 <small>선택</small>
            <input
              name="number"
              type="number"
              min={1}
              max={645}
              placeholder="예: 67"
              disabled={busy}
            />
          </label>
        </div>
        <KeyPicker value={keys} onChange={setKeys} disabled={busy} />
        <p className="hint">
          악보 전체가 정면으로, 글자와 오선이 선명하게 나오도록 찍어 주세요.
          분석 후 원본과 비교해 확인할 수 있어요.
        </p>
        <p className="error-message" role="alert">
          {error}
        </p>
        <button
          className="button primary"
          disabled={busy || !file || !keys.length}
        >
          {busy ? "사진을 올리고 있어요…" : "사진 분석 시작"}
        </button>
      </form>
    </>
  );
}
