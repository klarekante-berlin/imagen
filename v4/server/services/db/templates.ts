import { eq } from "drizzle-orm";
import { db } from "../../_core/db";
import { templates, type InsertTemplate, type Template } from "../../../drizzle/schema";

export async function listTemplates(): Promise<Template[]> {
  return db.select().from(templates).orderBy(templates.name);
}

export async function getTemplate(id: string): Promise<Template | undefined> {
  const [row] = await db.select().from(templates).where(eq(templates.id, id)).limit(1);
  return row;
}

export async function getTemplateByName(name: string): Promise<Template | undefined> {
  const [row] = await db.select().from(templates).where(eq(templates.name, name)).limit(1);
  return row;
}

export async function createTemplate(input: InsertTemplate): Promise<Template> {
  const [row] = await db.insert(templates).values(input).returning();
  return row;
}
