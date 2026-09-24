import { readFile } from "node:fs/promises";
import path from "node:path";
import { getHymns } from "@/lib/catalog";
import { isKey } from "@/lib/keys";
import { cacheDirectory, render } from "@/lib/render";
import { apiAuth } from "@/lib/auth";
import { refreshScoreCache } from "@/lib/cache";

export const runtime = "nodejs";
export async function GET(
  request: Request,
  context: {
    params: Promise<{ id: string; key: string; version: string; file: string }>;
  },
) {
  const denied = await apiAuth();
  if (denied) return denied;
  const { id, key, version, file } = await context.params;
  if (
    !isKey(key) ||
    !/^[a-f0-9]{16}$/.test(version) ||
    !/^(score\.pdf|page-\d+\.png)$/.test(file) ||
    !(await getHymns()).some((hymn) => hymn.id === id)
  )
    return new Response("Not found", { status: 404 });
  try {
    const stored = await refreshScoreCache(id);
    const current = stored
      ? stored.results[key] ||
        (key === stored.sourceKey ? stored.preview : undefined)
      : await render(id, key);
    if (!current)
      return Response.json(
        { pending: true },
        {
          status: 202,
          headers: { "Cache-Control": "private, no-store", "Retry-After": "2" },
        },
      );
    if (current.version !== version) {
      const target =
        file === "score.pdf"
          ? current.pdfUrl
          : current.pages.find((p) => path.basename(p) === file);
      if (!target) return new Response("Not found", { status: 404 });
      const url = new URL(target, request.url);
      url.search = new URL(request.url).search;
      return new Response(null, {
        status: 307,
        headers: { Location: url.href, "Cache-Control": "private, no-store" },
      });
    }
    const content = await readFile(
      path.join(cacheDirectory(), id, key, version, file),
    );
    const download = new URL(request.url).searchParams.get("download") === "1";
    return new Response(content, {
      headers: {
        "Content-Type": file.endsWith("pdf") ? "application/pdf" : "image/png",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="hymn${id}_${key}_${file}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
