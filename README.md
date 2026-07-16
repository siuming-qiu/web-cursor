<div align="center">

# Web Cursor — AI React Coding Sandbox

Prompt → runnable React project → browser preview → runtime feedback → repair.

[Live Demo](https://web-cursor-seven.vercel.app/) · [Showcase](https://web-cursor-seven.vercel.app/showcase) · [How It Works](#how-it-works)

**English** · [简体中文](./README.zh-CN.md)

</div>

![Web Cursor home screen](./docs/assets/web-cursor-home.png)

Web Cursor is a browser-based AI React coding sandbox. Describe an interface in natural language and it generates a runnable, multi-file React project, starts it inside WebContainer, and uses real preview feedback to repair failures through an agent loop.

## Why Web Cursor

Most code generators stop after producing source code. Web Cursor closes the runtime loop: write the project, install its dependencies, run it in the browser, inspect errors and console output, then repair the project and run it again.

## Capabilities

- Generate complete Rsbuild + React projects from natural-language requests
- Edit project files with Monaco Editor and a file tree
- Run real `npm install` and `npm run dev` commands inside WebContainer
- Feed preview errors and runtime results back into the AI repair loop
- Persist projects, files, conversations, and messages in Postgres
- Share code across multiple conversations within the same project
- Upload images for visual understanding and generate images as project assets
- Use Figma OAuth to inspect design data from links that include a specific `node-id`
- Publish read-only project examples in the Showcase
- Switch the interface between English and Chinese

## How It Works

```text
Natural-language request
        ↓
Agent writes a React project
        ↓
WebContainer installs dependencies and starts the app
        ↓
Preview reports render status and browser runtime errors
        ↓
Agent repairs the project and runs it again
```

Web Cursor is organized into three execution domains:

| Domain | Location | Responsibility |
|---|---|---|
| A. LLM agent | Next.js Route Handlers | Holds API keys, calls the LLM, runs trusted server tools, and persists the transcript |
| B. Browser orchestration | Client Components | Runs client-only preview tools, returns preview results to the server loop, and manages the workbench |
| C. Sandbox | iframe / WebContainer preview | Executes untrusted AI-generated code and reports runtime results |

An optional fourth domain is reserved for backend validation:

| Domain | Location | Responsibility |
|---|---|---|
| D. Backend sandbox | Vercel Sandbox / external worker | Runs install, build, and browser validation in isolation, then returns structured results to the agent loop |

Key constraints:

- LLM credentials never enter the browser or preview iframe.
- AI-generated code is untrusted and is not executed in the main Next.js server process.
- The preview bridge reports `RENDER_OK` and `RUNTIME_ERROR` to the browser orchestration layer.
- Internal Route Handlers use only `GET` and `POST`; write operations use explicit request-body fields.

## Tech Stack

| Area | Technologies |
|---|---|
| Application | Next.js App Router, React 19, TypeScript |
| Interface | Tailwind CSS, Monaco Editor |
| Project runtime | WebContainer, Rsbuild |
| LLM integration | OpenAI SDK-compatible interface |
| Persistence | Postgres / Neon, drizzle-orm |
| Asset storage | Vercel Blob |
| Client state | Zustand |
| Internationalization | next-intl |

## Local Development

Install dependencies:

```bash
pnpm install
```

Start the Next.js development server:

```bash
pnpm dev
```

To poll asynchronous image-generation jobs locally, start the runner in another terminal:

```bash
pnpm dev:runner
```

Push the database schema:

```bash
pnpm db:push
```

Create a production build:

```bash
pnpm build
```

## Environment Variables

Copy the example environment file:

```bash
cp .env.example .env.local
```

The basic conversation → file generation → preview loop requires:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string, typically Neon. Also used by `pnpm db:push` |
| `DEEPSEEK_API_KEY` | LLM key used by the agent loop and code completion. The base URL is fixed to `https://api.deepseek.com` in `server/llm.ts` |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob read/write token used directly by the `@vercel/blob` SDK |

Optional capabilities:

| Variable | Purpose | Required when |
|---|---|---|
| `YUNWU_API_KEY` | Image generation through `generate_image` and image-attachment understanding | Using either capability |
| `YUNWU_IMAGE_MODEL` | Overrides the default image-generation model | Optional |
| `FIGMA_CLIENT_ID` / `FIGMA_CLIENT_SECRET` | Figma OAuth | Enabling Figma integration |
| `FIGMA_TOKEN_ENCRYPTION_KEY` | Encrypts stored Figma tokens | Figma integration is configured |
| `FIGMA_REDIRECT_URI` | Overrides the callback URL; otherwise derived from the request origin | Optional |
| `FIGMA_PROVIDER` | Figma provider; currently only `rest` is supported | Optional |
| `CRON_SECRET` / `IMAGE_RUNNER_SECRET` | Protects `/api/image-runner`; the production endpoint returns `401` when neither is configured | Production image runner |
| `IMAGE_RUNNER_URL` / `IMAGE_RUNNER_INTERVAL_MS` / `IMAGE_RUNNER_BATCH_SIZE` | Configures `scripts/image-runner-dev.mjs` | Optional |
| `NEXT_PUBLIC_SITE_URL` | Absolute site URL used by canonical URLs, sitemap, robots metadata, social metadata, and `llms.txt` | Optional |

## Project Structure

```text
app/
  api/                         Next.js Route Handlers
  p/[projectId]/               Project workbench route
  showcase/                    Public showcase pages

components/
  chat/                        Conversation and AI output
  editor/                      Monaco editor
  preview/                     Preview panel
  project/                     Home page and project entry points
  showcase/                    Read-only showcase workbench
  workbench/                   Workbench layout and state boundaries

hooks/
  useWorkbenchController.ts    Main workbench orchestration
  usePreview.ts                WebContainer preview state
  useProjectFiles.ts           Project file reads and writes
  useProjectSession.ts         Project restoration and conversation switching

lib/
  webcontainer/                WebContainer mounting, runtime, and contracts
  *.ts                         Client API, types, and state facades

server/
  db/                          Drizzle schema and database connection
  image/                       Asynchronous image jobs and asset storage
  figma/                       Figma OAuth and inspection
  tools/                       Agent tool definitions and execution
```

## Current Limitations

- Generated projects use the repository's Rsbuild + React project contract rather than arbitrary frameworks.
- Figma inspection requires OAuth and a link containing a specific `node-id`; it is not a general Figma-to-React converter.
- The preview bridge currently reports render success and browser runtime errors; console capture is not implemented.
- Static-site ZIP export, backend sandbox validation, and project rollback are not implemented yet.

## Roadmap

- Static-site ZIP export
- Optional isolated backend validation
- A more complete sharing and publishing workflow
- Project versions and rollback

## Design Notes

- [Async image generation](./docs/async-image-generation.md) — implemented asynchronous image jobs and project assets
- [Figma design inspection](./docs/figma-design-import.md) — current OAuth and node-level inspection design
- [Static ZIP export](./docs/export-zip.md) — planned export design
- [Backend sandbox](./docs/backend-sandbox.md) — planned isolated validation design
- [Multi-agent architecture](./docs/multi-agent-architecture.md) — autonomous delegation, context sharing, coordination, progress UI, and isolated changes
- [Requirements baseline](./REQUIREMENTS.md) — historical product baseline; some sections predate the current WebContainer and i18n implementation
