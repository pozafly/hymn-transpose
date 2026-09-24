import { getHymns } from "@/lib/catalog";
import { KEYS } from "@/lib/keys";

export async function GET() {
  return Response.json({
    hymns: (await getHymns()).map(({ template: _template, ...hymn }) => hymn),
    keys: KEYS,
  });
}
