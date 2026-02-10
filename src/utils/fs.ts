import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export async function ensureDir(path: string) {
  await mkdir(path, { recursive: true });
}

export async function writeTextFile(path: string, content: string) {
  await ensureDir(dirname(path));
  await writeFile(path, content, "utf8");
}

export async function writeJsonFile(path: string, value: unknown) {
  await writeTextFile(path, JSON.stringify(value, null, 2));
}

export async function readJsonFile<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as T;
}

