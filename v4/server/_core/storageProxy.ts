import type { Express } from "express";
import { STORAGE_URL_PREFIX, storageRead } from "../services/storage";

export function registerStorageProxy(app: Express) {
  app.get(`${STORAGE_URL_PREFIX}/*`, async (req, res) => {
    const key = req.path.slice(STORAGE_URL_PREFIX.length + 1);
    const file = await storageRead(key);
    if (!file) {
      res.status(404).end();
      return;
    }
    res.set("Content-Type", file.contentType);
    res.set("Cache-Control", "public, max-age=31536000, immutable");
    res.end(file.buffer);
  });
}
