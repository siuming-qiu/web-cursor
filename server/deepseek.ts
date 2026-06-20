import "server-only"; // A 域守卫：持 key，误 import 进客户端组件会在编译期报错
import OpenAI from "openai";

export const SYSTEM_PROMPT = `你是 React单文件应用生成器。
  - 用户要做界面/改界面/修 bug → 调 write_app，输出完整 App.tsx（export default一个组件，只用 react，不要 markdown）。
  - 需求不清或纯闲聊 → 调 reply提问/回复，不要写代码。`

export enum TOOL_TYPE  {
    WRITE_APP = 'write_app',
    REPLY = 'reply'
}

const deepseekClient = new OpenAI({
    baseURL: 'https://api.deepseek.com',
    apiKey: process.env.DEEPSEEK_API_KEY,
});

export const tools = [
    {
        type: "function" as const,
        function: {
            name: TOOL_TYPE.WRITE_APP,
            description: "写或修改 React单文件应用并渲染（做界面/改界面/修 bug 时用）",
            parameters: {
                type: "object",
                properties: {
                    code: {
                        type: "string",
                        description: "完整的 App.tsx 内容（纯代码，无 markdown）",
                    },
                },
                required: ["code"],
            },
        }
    }, {
        type: "function" as const,
        function: {
            name: TOOL_TYPE.REPLY,
            description: "用一个自然回复（不做界面、不写代码时用）",
            parameters: {
                type: "object",
                properties: {
                    message: {
                        type: "string",
                        description: "要回复的内容",
                    },
                },
                required: ["message"],
            },
        }
    }
]



export default deepseekClient