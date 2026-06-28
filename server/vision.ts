/**
 * [INPUT]: server-side image data URL from attachment storage
 * [OUTPUT]: visual observations from Yunwu Gemini chat-compatible API
 * [POS]: A 域视觉模型适配层 —— inspect_attachment 的内部子调用
 * [PROTOCOL]: 原图只在服务端读取并转发给视觉模型；主 agent transcript 不直接存 raw image
 */
import "server-only";
import OpenAI from "openai";
import { AGENT_MODEL } from "@/server/models";

const YUNWU_BASE_URL = "https://yunwu.ai/v1";

const visionClient = new OpenAI({
  baseURL: YUNWU_BASE_URL,
  apiKey: process.env.YUNWU_API_KEY ?? "missing-yunwu-api-key",
});

export async function inspectImageAttachment(dataUrl: string): Promise<string> {
  if (!process.env.YUNWU_API_KEY) {
    throw new Error("Missing YUNWU_API_KEY for attachment inspection.");
  }

  const result = await visionClient.chat.completions.create({
    model: AGENT_MODEL,
    temperature: 0.2,
    max_tokens: 1000,
    messages: [
      {
        role: "system",
        content:
          "你是图片识别工具。只描述图片中实际可见的内容，不推断用户意图，不给实现建议，不提代码或 agent。",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text:
              "请识别这张图片。按以下字段输出，未知则写“未见”：\n- 图片类型：\n- 主要对象：\n- 可见文字：\n- 颜色与视觉风格：\n- 布局/空间关系：\n- 其他可见细节：\n\n只描述可见事实，保持简洁。",
          },
          { type: "image_url", image_url: { url: dataUrl } },
        ],
      },
    ],
  });

  return result.choices[0]?.message?.content?.trim() || "未能从图片中提取到可用观察。";
}
