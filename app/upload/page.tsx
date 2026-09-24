import { requirePageAuth } from "@/lib/auth";
import { getHymns } from "@/lib/catalog";
import LibraryShell from "@/components/library-shell";
import UploadForm from "@/components/upload-form";
export const dynamic = "force-dynamic";
export default async function Upload() {
  await requirePageAuth();
  return (
    <LibraryShell hymns={await getHymns()}>
      <UploadForm />
    </LibraryShell>
  );
}
