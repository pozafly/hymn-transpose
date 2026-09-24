import { randomUUID } from "node:crypto";
import { mkdir, writeFile, rm } from "node:fs/promises";
import sharp from "sharp";
import { apiAuth } from "@/lib/auth";
import { isKey } from "@/lib/keys";
import {
  insertScore,
  scorePath,
  enqueue,
  savedScores,
  transaction,
} from "@/lib/store";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const denied = await apiAuth(request);
  if (denied) return denied;
  if (savedScores().filter((s) => s.kind === "upload").length >= 500)
    return Response.json(
      { error: "개인 악보는 최대 500개까지 보관할 수 있어요." },
      { status: 409 },
    );
  const max = 13 * 1024 * 1024;
  if (Number(request.headers.get("content-length")) > max)
    return Response.json(
      { error: "사진은 12MB 이하로 올려 주세요." },
      { status: 413 },
    );
  let id = "";
  try {
    const reader = request.body?.getReader();
    if (!reader) throw new Error("사진을 선택해 주세요.");
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      length += r.value.length;
      if (length > max) {
        await reader.cancel();
        throw new Error("사진은 12MB 이하로 올려 주세요.");
      }
      chunks.push(r.value);
    }
    const form = await new Response(Buffer.concat(chunks), {
      headers: { "content-type": request.headers.get("content-type") || "" },
    }).formData();
    const title = String(form.get("title") || "").trim(),
      number = Number(form.get("number") || 0);
    const keys = JSON.parse(String(form.get("keys") || "[]"));
    const file = form.get("file");
    if (
      !title ||
      title.length > 120 ||
      !Number.isInteger(number) ||
      number < 0 ||
      number > 645
    )
      throw new Error("제목과 찬송가 번호(1~645)를 확인해 주세요.");
    if (
      !Array.isArray(keys) ||
      !keys.length ||
      keys.length > 13 ||
      !keys.every(isKey)
    )
      throw new Error("생성할 조를 선택해 주세요.");
    if (!(file instanceof File) || file.size > 12 * 1024 * 1024 || !file.size)
      throw new Error("12MB 이하의 사진을 선택해 주세요.");
    const bytes = Buffer.from(await file.arrayBuffer());
    const input = sharp(bytes, {
      limitInputPixels: 32_000_000,
      failOn: "warning",
    });
    const meta = await input.metadata();
    if (
      !["jpeg", "png", "webp"].includes(meta.format || "") ||
      (meta.pages || 1) > 1
    )
      throw new Error("JPG·PNG·WebP 사진 한 장을 올려 주세요.");
    if (!meta.width || !meta.height || meta.width < 400 || meta.height < 400)
      throw new Error("사진이 너무 작아요. 원본 사진으로 올려 주세요.");
    const normalized = await input
      .rotate()
      .flatten({ background: "white" })
      .resize({
        // A4 at 300 DPI can be 2481px wide. Avoid resampling clean scans by 1px:
        // antialiasing changes can make Audiveris lose most Korean lyrics.
        width: 2500,
        height: 3508,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
    id = "u-" + randomUUID();
    await mkdir(scorePath(id), { recursive: true });
    await writeFile(scorePath(id, "original.png"), normalized);
    await writeFile(scorePath(id, "uploaded-original"), bytes);
    transaction(() => {
      insertScore({
        id,
        title,
        number,
        category: "내 악보",
        template: "",
        kind: "upload",
        mode: "major",
        sourceKey: "c",
        createdAt: new Date().toISOString(),
        status: "queued",
        requestedKeys: [...new Set(keys)],
        results: {},
        keyErrors: {},
        warnings: [],
        revision: 0,
        originalCount: 1,
      });
      enqueue(id, "analyze");
    });
    return Response.json({ id }, { status: 201 });
  } catch (e) {
    if (id) await rm(scorePath(id), { recursive: true, force: true });
    return Response.json(
      { error: e instanceof Error ? e.message : "사진을 올리지 못했습니다." },
      { status: 400 },
    );
  }
}
