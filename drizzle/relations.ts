import { relations } from "drizzle-orm";
import { assets, characters } from "./schema";

export const charactersRelations = relations(characters, ({ many, one }) => ({
  assets: many(assets),
  primaryAsset: one(assets, {
    fields: [characters.primaryAssetId],
    references: [assets.id],
    relationName: "primary_asset",
  }),
}));

export const assetsRelations = relations(assets, ({ one }) => ({
  character: one(characters, {
    fields: [assets.characterId],
    references: [characters.id],
  }),
}));
