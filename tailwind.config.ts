import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0d1117",
        panel: "#161b22",
        panel2: "#1c2330",
        border: "#2a313c",
        fg: "#e6edf3",
        muted: "#8b949e",
        accent: "#58a6ff",
        accent2: "#d2a8ff",
        green: "#3fb950",
        red: "#f85149",
        yellow: "#d29922",
        orange: "#ffa657",
        bubble: "#1f6feb",
        codebg: "#0b0f14",
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', '"PingFang SC"', '"Microsoft YaHei"', 'sans-serif'],
        mono: ['"SF Mono"', '"JetBrains Mono"', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
