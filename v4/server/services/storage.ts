import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const STORAGE_ROOT = path.resolve(process.cwd(), "storage-data/v4");
export const STORAGE_URL_PREFIX = "/v4-storage";

function localPathFor(key: string): string {
  const root = path.resolve(STORAGE_ROOT);
  const target = path.resolve(root, key);
  if (!target.startsWith(root + path.sep) && target !== root) {
    throw new Error(`Refusing path-traversing storage key: ${key}`);
  }
  return target;
}

function appendHash(relKey: string): string {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const dot = relKey.lastIndexOf(".");
  if (dot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, dot)}_${hash}${relKey.slice(dot)}`;
}

export type StoredFile = {
  key: string;
  url: string;
  contentHash: string;
  byteLength: number;
};

export async function storagePut(relKey: string, data: Buffer): Promise<StoredFile> {
  const key = appendHash(relKey.replace(/^\/+/, ""));
  const target = localPathFor(key);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, data);
  const contentHash = crypto.createHash("sha256").update(data).digest("hex");
  return {
    key,
    url: `${STORAGE_URL_PREFIX}/${key}`,
    contentHash,
    byteLength: data.byteLength,
  };
}

export async function storageRead(relKey: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  const key = relKey.replace(/^\/+/, "");
  try {
    const target = localPathFor(key);
    const buffer = await fs.readFile(target);
    const ext = path.extname(target).toLowerCase();
    const contentType =
      ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".gif"
            ? "image/gif"
            : "image/png";
    return { buffer, contentType };
  } catch {
    return null;
  }
}

export async function storageDelete(relKey: string): Promise<void> {
  const key = relKey.replace(/^\/+/, "");
  try {
    await fs.unlink(localPathFor(key));
  } catch {
    /* ignore */
  }
}

export function hashBuffer(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}
