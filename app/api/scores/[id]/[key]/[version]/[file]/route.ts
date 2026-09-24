import { readFile } from "node:fs/promises";
import path from "node:path";
import { getHymns } from "@/lib/catalog";
import { isKey } from "@/lib/keys";
import { cacheDirectory } from "@/lib/render";

export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: {
    params: Promise<{ id: string; key: string; version: string; file: string }>;
  },
) {
  const { id, key, version, file } = await context.params;
  if (
    !isKey(key) ||
    !/^[a-f0-9]{16}$/.test(version) ||
    !/^(score\.pdf|page-\d+\.png)$/.test(file) ||
    !(await getHymns()).some((hymn) => hymn.id === id)
  )
    return new Response("Not found", { status: 404 });
  try {
    const content = await readFile(
      path.join(cacheDirectory(), id, key, version, file),
    );
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(content, {
      headers: {
        "Content-Type": file.endsWith("pdf") ? "application/pdf" : "image/png",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="hymn${id}_${key}_${file}"`,
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
