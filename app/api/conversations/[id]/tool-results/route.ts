/**
 * [INPUT]: conversation id + tool_call_id + browser-side tool execution result
 * [OUTPUT]: 204 after appending one role=tool message
 * [POS]: A 域 tool-call 闭合接口 —— 只记录沙箱/转译结果，不触发 LLM
 * [PROTOCOL]: assistant.tool_calls 必须和 tool.tool_call_id 成对；成功和失败都要闭合。
 */
import { z } from "zod";
import { appendMessage } from "@/server/messages";
import { ownsConversation } from "@/server/guard";
import { ownerIdFrom } from "@/server/owner";
import { ToolResultSchema } from "@/types/toolSchema";

const ToolResultBodySchema = z.object({
  toolCallId: z.string().min(1),
  result: ToolResultSchema,
}).strict();

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const ownerId = ownerIdFrom(req);
  if (!ownerId) return new Response("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  if (!(await ownsConversation(id, ownerId))) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  try {
    const body = ToolResultBodySchema.parse(await req.json());
    await appendMessage(id, {
      role: "tool",
      content: JSON.stringify(body.result),
      meta: { toolCallId: body.toolCallId },
    });
    return new Response(null, { status: 204 });
  } catch (e) {
    return Response.json({ error: "bad request", detail: String(e) }, { status: 400 });
  }
}
