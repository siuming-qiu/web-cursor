import { SITE_URL } from "@/lib/site";

const BODY = `# Web Cursor

> Web Cursor is an AI React playground that turns natural language into runnable React projects directly in the browser.

Web Cursor helps users generate, edit, preview, and repair React UI code in a browser-based sandbox. The system combines a server-side LLM agent, a browser workbench, and an isolated iframe runtime so generated code can be executed safely and validated with real preview feedback.

## Public Pages

- ${SITE_URL}/
- ${SITE_URL}/about
- ${SITE_URL}/ai-react-playground

## Core Capabilities

- Natural language to React project files.
- Browser-based React preview in an isolated iframe sandbox.
- Agent loop that uses compile, runtime, console, and render feedback to repair generated code.
- Figma design link inspection when the user connects Figma and provides a node-specific design URL.
- Project files are represented as a complete Vite React TypeScript project, including package.json, index.html, src/main.tsx, and src/App.tsx.

## Architecture

- Server: Next.js Route Handlers call the LLM and execute trusted backend tools.
- Workbench: The browser UI coordinates chat, project files, compilation, and preview state.
- Sandbox: Generated React code runs in an iframe sandbox and reports render or runtime results back to the agent loop.

## Indexing Notes

The public marketing and product explanation pages are / and /about. Private project routes under /p/ and API routes under /api/ should not be indexed or used as public source material.
`;

export function GET() {
  return new Response(BODY, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
