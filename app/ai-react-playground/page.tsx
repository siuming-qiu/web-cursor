import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "AI React Playground",
  description: "Web Cursor is an AI React playground for generating, editing, previewing, and repairing runnable React projects directly in the browser.",
  alternates: {
    canonical: "/ai-react-playground",
  },
  openGraph: {
    title: "AI React Playground by Web Cursor",
    description: "Generate React UI with an AI agent, run it in a browser sandbox, and repair it with real preview feedback.",
    url: "/ai-react-playground",
  },
};

const useCases = [
  ["Prototype React UI from a prompt", "Describe a dashboard, landing page, tool, or interactive component and let the agent create a runnable React project."],
  ["Turn Figma frames into implementation context", "Connect Figma, paste a node-specific design URL, and let the agent inspect layout facts before writing code."],
  ["Repair with real browser feedback", "Install errors, dev server failures, and browser runtime errors become feedback for the next agent turn."],
];

const facts = [
  ["Project format", "Complete Rsbuild React TypeScript files"],
  ["Runtime", "WebContainer + browser iframe preview"],
  ["Feedback loop", "Preview result to agent repair"],
  ["Model boundary", "LLM key stays on the server"],
];

export default function AiReactPlaygroundPage() {
  return (
    <main className="min-h-screen bg-[#f4f1e8] text-[#16130f]">
      <section className="border-b border-[#d8cfbd] px-5 py-5 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <nav className="flex h-12 items-center justify-between gap-4">
            <Link href="/" className="font-mono text-[13px] font-semibold text-[#c74618]">
              Web Cursor
            </Link>
            <div className="flex items-center gap-3 text-sm">
              <Link href="/about" className="text-[#6e6252] transition hover:text-[#16130f]">
                About
              </Link>
              <Link href="/" className="rounded-md bg-[#16130f] px-3 py-2 font-medium text-[#f4f1e8] transition hover:bg-[#c74618]">
                Open app
              </Link>
            </div>
          </nav>

          <div className="grid min-h-[74vh] items-center gap-12 py-16 lg:grid-cols-[1.08fr_0.92fr]">
            <div>
              <p className="font-mono text-[12px] font-semibold uppercase tracking-[0.18em] text-[#746856]">AI React Playground</p>
              <h1 className="mt-5 max-w-4xl text-5xl font-normal leading-[1.02] sm:text-7xl lg:text-[88px]">
                Generate React UI in the browser.
              </h1>
              <p className="mt-7 max-w-2xl text-lg leading-8 text-[#5f5548]">
                Web Cursor is a browser-based AI React playground. It creates real React project files, runs them in an isolated preview sandbox, and uses runtime feedback to repair the result.
              </p>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link href="/" className="rounded-md bg-[#c74618] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#a93612]">
                  Start building
                </Link>
                <a href="#how-it-works" className="rounded-md border border-[#c8bea9] px-5 py-3 text-sm font-semibold text-[#16130f] transition hover:border-[#c74618]">
                  How it works
                </a>
              </div>
            </div>

            <div className="border border-[#d8cfbd] bg-[#fffaf0] p-4 shadow-[14px_14px_0_#16130f]">
              <div className="border-b border-[#d8cfbd] pb-3 font-mono text-[12px] text-[#746856]">src/App.tsx</div>
              <pre className="mt-5 overflow-x-auto whitespace-pre-wrap font-mono text-[13px] leading-7 text-[#2b261f]">
{`export default function App() {
  return (
    <main className="product">
      <h1>AI writes React.</h1>
      <p>Sandbox runs it.</p>
      <p>Errors become feedback.</p>
    </main>
  );
}`}
              </pre>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="border-b border-[#d8cfbd] px-5 py-20 sm:px-8 lg:px-10">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-3xl">
            <h2 className="text-3xl font-normal leading-tight sm:text-5xl">A playground with a real agent loop</h2>
            <p className="mt-5 text-base leading-8 text-[#5f5548]">
              The output is not treated as finished until it has been compiled and executed. The preview sandbox reports what actually happened, then the agent can continue editing project files.
            </p>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {useCases.map(([title, body]) => (
              <article key={title} className="border border-[#d8cfbd] bg-[#fffaf0] p-6">
                <h3 className="text-xl font-semibold">{title}</h3>
                <p className="mt-4 text-sm leading-7 text-[#5f5548]">{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="px-5 py-20 sm:px-8 lg:px-10">
        <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.85fr_1.15fr]">
          <div>
            <h2 className="text-3xl font-normal leading-tight sm:text-5xl">Built for runnable React, not snippets</h2>
            <p className="mt-5 text-base leading-8 text-[#5f5548]">
              Every generated app is represented as a complete project. The browser workbench can compile it, render it, and feed concrete failures back into the conversation.
            </p>
          </div>
          <dl className="grid gap-3 sm:grid-cols-2">
            {facts.map(([term, description]) => (
              <div key={term} className="border border-[#d8cfbd] bg-[#fffaf0] p-5">
                <dt className="font-mono text-[12px] font-semibold uppercase tracking-[0.12em] text-[#c74618]">{term}</dt>
                <dd className="mt-3 text-sm leading-6 text-[#5f5548]">{description}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </main>
  );
}
