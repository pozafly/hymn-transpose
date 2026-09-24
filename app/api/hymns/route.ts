import { getHymns } from "@/lib/catalog";
import { KEYS } from "@/lib/keys";
import { apiAuth } from "@/lib/auth";

export async function GET() {
  const denied = await apiAuth();
  if (denied) return denied;
  return Response.json({
    hymns: (await getHymns()).map(({ template: _template, ...hymn }) => hymn),
    keys: KEYS,
  });
}
