import deepseekClient, { SYSTEM_PROMPT, TOOL_TYPE, tools } from "@/server/deepseek"
import extractField from "@/server/sse"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"





export async function POST(req: Request) {
  const { message } = await req.json()
  const stream = await deepseekClient.chat.completions.create({
    messages: [{ role: "system", content: SYSTEM_PROMPT }, {
      role: "user",
      content: message,
    }],
    model: "deepseek-v4-pro",
    tools,
    stream: true,
  })
  const encoder = new TextEncoder()
  const sse = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(o)}\n\n`))
      }
      let name = ""
        let args = ""
        let text = ""
        try {
          for await (const chunk of stream) {
            const d = chunk.choices[0]?.delta
            const tc = d?.tool_calls?.[0]
            if (tc?.function?.name) {
              name = tc.function.name
            }
            if (tc?.function?.arguments) {
              args += tc.function?.arguments
              if (name === TOOL_TYPE.WRITE_APP) {
                send({
                  type: "code",
                  code: extractField(args, "code")
                })
              } else if (name === TOOL_TYPE.REPLY) {
                send({
                  type: "chat",
                  message: extractField(args, "message")
                })
              }
            }
            if (d?.content) {
              text += d.content
              send({
                type: "chat",
                message: text
              })
            }
            
          }
          send({type: "done"})
        } catch(e) {
          send({type: "error", message: String(e)})
        } finally {
          controller.close()
        }
    }
  })
  return new Response(sse, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform"
    },
  })
}