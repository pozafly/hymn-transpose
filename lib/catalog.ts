import { readFile } from "node:fs/promises";
import path from "node:path";
import { isKey, type KeyId } from "./keys.ts";
import { savedScores, type SavedScore } from "./store.ts";

export type Hymn = {
  id: string;
  number: number;
  title: string;
  category: string;
  sourceKey: KeyId;
  template: string;
  kind?: "builtin" | "upload";
  mode?: "major" | "minor";
  createdAt?: string;
  status?: SavedScore["status"];
};
export const scoreDirectory = path.join(process.cwd(), "score");

// Number first for every source, with deterministic ties across reads and polling.
export function compareHymns(a: Hymn, b: Hymn): number {
  const numberOrder =
    (a.number > 0 ? a.number : Infinity) - (b.number > 0 ? b.number : Infinity);
  if (numberOrder) return numberOrder;
  const kindOrder = Number(a.kind === "upload") - Number(b.kind === "upload");
  if (kindOrder) return kindOrder;
  return (
    (a.createdAt || "").localeCompare(b.createdAt || "") ||
    a.id.localeCompare(b.id)
  );
}

export async function getHymns(): Promise<Hymn[]> {
  const entries: unknown = JSON.parse(
    await readFile(path.join(scoreDirectory, "catalog.json"), "utf8"),
  );
  if (!Array.isArray(entries)) throw new Error("곡 목록이 올바르지 않습니다.");
  const ids = new Set<string>();
  for (const entry of entries) {
    if (
      !entry ||
      !/^[0-9]+$/.test(entry.id) ||
      ids.has(entry.id) ||
      !Number.isInteger(entry.number) ||
      typeof entry.title !== "string" ||
      typeof entry.category !== "string" ||
      !isKey(entry.sourceKey) ||
      typeof entry.template !== "string" ||
      !/^[a-zA-Z0-9_-]+\.ly\.tmpl$/.test(entry.template)
    ) {
      throw new Error("곡 메타데이터가 올바르지 않습니다.");
    }
    ids.add(entry.id);
  }
  const extra = savedScores().map(
    ({
      id,
      number,
      title,
      category,
      sourceKey,
      template,
      kind,
      mode,
      createdAt,
      status,
    }) => ({
      id,
      number,
      title,
      category,
      sourceKey,
      template,
      kind,
      mode,
      createdAt,
      status,
    }),
  );
  const items = [
    ...entries.map((e) => ({ ...e, kind: "builtin", mode: "major" })),
    ...extra.filter((e) => !ids.has(e.id)),
  ] as Hymn[];
  return items.sort(compareHymns);
}
