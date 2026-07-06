// Local-filesystem object storage. Mirrors an S3 put/get interface so it can be
// swapped for MinIO/S3 later without touching call sites.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..", "storage");

export async function putObject(key: string, data: string): Promise<void> {
  const full = path.join(ROOT, key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data, "utf8");
}

export async function getObject(key: string): Promise<string> {
  const full = path.join(ROOT, key);
  return fs.readFile(full, "utf8");
}

export async function hasObject(key: string): Promise<boolean> {
  try {
    await fs.access(path.join(ROOT, key));
    return true;
  } catch {
    return false;
  }
}
