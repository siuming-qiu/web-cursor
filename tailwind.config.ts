import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#050505",
        panel: "#0c0c0b",
        panel2: "#11110f",
        border: "#24231f",
        fg: "#f7f7f4",
        muted: "#807d72",
        accent: "#f54e00",
        accent2: "#c0a8dd",
        green: "#1f8a65",
        red: "#cf2d56",
        yellow: "#c08532",
        orange: "#dfa88f",
        bubble: "#f54e00",
        codebg: "#050505",
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
