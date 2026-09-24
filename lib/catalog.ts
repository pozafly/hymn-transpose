import { readFile } from "node:fs/promises";
import path from "node:path";
import { isKey, type KeyId } from "./keys.ts";

export type Hymn = {
  id: string;
  number: number;
  title: string;
  category: string;
  sourceKey: KeyId;
  template: string;
};
export const scoreDirectory = path.join(process.cwd(), "score");

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
  return entries;
}
