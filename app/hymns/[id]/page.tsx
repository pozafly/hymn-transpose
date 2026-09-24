import { notFound } from "next/navigation";
import { getHymns } from "@/lib/catalog";
import { isKey } from "@/lib/keys";
import HymnViewer from "@/components/hymn-viewer";
export const dynamic = "force-dynamic";
export default async function HymnPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ key?: string }>;
}) {
  const [{ id }, query, hymns] = await Promise.all([
    params,
    searchParams,
    getHymns(),
  ]);
  const hymn = hymns.find((item) => item.id === id);
  if (!hymn) notFound();
  return (
    <HymnViewer
      hymns={hymns}
      hymn={hymn}
      selectedKey={isKey(query.key) ? query.key : hymn.sourceKey}
    />
  );
}
