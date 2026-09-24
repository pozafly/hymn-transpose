import { notFound } from "next/navigation";
import { getHymns } from "@/lib/catalog";
import { isKey } from "@/lib/keys";
import HymnViewer from "@/components/hymn-viewer";
import { requirePageAuth } from "@/lib/auth";
import { refreshScoreCache } from "@/lib/cache";
import LibraryShell from "@/components/library-shell";
import SavedViewer from "@/components/saved-viewer";
export const dynamic = "force-dynamic";
export default async function HymnPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ key?: string }>;
}) {
  await requirePageAuth();
  const [{ id }, query, hymns] = await Promise.all([
    params,
    searchParams,
    getHymns(),
  ]);
  const hymn = hymns.find((item) => item.id === id);
  if (!hymn) notFound();
  const stored = await refreshScoreCache(id);
  if (stored && !hymn.template)
    return (
      <LibraryShell hymns={hymns} currentId={id}>
        <SavedViewer key={id} initial={stored} />
      </LibraryShell>
    );
  return (
    <HymnViewer
      hymns={hymns}
      hymn={hymn}
      selectedKey={isKey(query.key) ? query.key : hymn.sourceKey}
    />
  );
}
