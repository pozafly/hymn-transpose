import { apiAuth } from "@/lib/auth";
import { savedScores, workerOnline } from "@/lib/store";
import { refreshScoreCache } from "@/lib/cache";
import { compareHymns } from "@/lib/catalog";
export async function GET() {
  const denied = await apiAuth();
  if (denied) return denied;
  return Response.json(
    {
      scores: await Promise.all(
        savedScores()
          .sort(compareHymns)
          .map((s) => refreshScoreCache(s.id)),
      ),
      workerOnline: workerOnline(),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
