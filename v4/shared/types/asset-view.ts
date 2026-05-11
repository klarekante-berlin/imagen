import type { Asset } from "../../drizzle/schema";

export type PublicAsset = Omit<Asset, "embedding"> & { hasEmbedding: boolean };

export function toPublicAsset(asset: Asset): PublicAsset {
  const { embedding, ...rest } = asset;
  return { ...rest, hasEmbedding: !!embedding };
}
