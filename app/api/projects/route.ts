import { db } from "@/server/db";
import { projects } from "@/server/db/schema";
import { ownerIdFrom } from "@/server/owner";
import { and, desc, eq, isNull } from "drizzle-orm";
import z from "zod";


const CreateSchema = z.object({
    title: z.string().min(1),
}).strict()

// 列我的项目：排除软删，最近更新在前
export async function GET(req: Request) {
    const ownerId = ownerIdFrom(req);
    if (!ownerId) return new Response("Unauthorized", { status: 401 });
    const rows = await db.select().from(projects)
        .where(and(eq(projects.ownerId, ownerId), isNull(projects.deletedAt)))
        .orderBy(desc(projects.updatedAt));
    return Response.json(rows);
}

export async function POST(req: Request)  {
    const ownerId = ownerIdFrom(req);
    if (!ownerId) {
        return new Response("Unauthorized", { status: 401 });
    }

    const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
        return Response.json({ error: "bad request", detail: parsed.error.flatten() }, { status: 400 });
    }

    try {
        const project = await db.insert(projects).values({
            ownerId,
            title: parsed.data.title,
        }).returning()
        return Response.json(project, { status: 201 });
    } catch (e) {
        console.error("Failed to create project", e);
        return Response.json({ error: "internal error" }, { status: 500 });
    }
}