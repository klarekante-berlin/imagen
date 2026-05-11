import { desc, eq } from "drizzle-orm";
import { db } from "../../_core/db";
import {
  projects,
  type InsertProject,
  type Project,
} from "../../../drizzle/schema";

export async function listProjects(): Promise<Project[]> {
  return db.select().from(projects).orderBy(desc(projects.updatedAt));
}

export async function getProject(id: string): Promise<Project | undefined> {
  const [row] = await db.select().from(projects).where(eq(projects.id, id)).limit(1);
  return row;
}

export async function createProject(input: InsertProject): Promise<Project> {
  const [row] = await db.insert(projects).values(input).returning();
  return row;
}

export async function updateProject(
  id: string,
  patch: Partial<InsertProject>,
): Promise<Project | undefined> {
  const [row] = await db
    .update(projects)
    .set({ ...patch, updatedAt: new Date().toISOString() })
    .where(eq(projects.id, id))
    .returning();
  return row;
}
