import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(220 13% 91%)",
        input: "hsl(220 13% 91%)",
        ring: "hsl(217 91% 60%)",
        background: "hsl(0 0% 100%)",
        foreground: "hsl(222 47% 11%)",
        muted: {
          DEFAULT: "hsl(220 14% 96%)",
          foreground: "hsl(220 9% 46%)",
        },
        card: {
          DEFAULT: "hsl(0 0% 100%)",
          foreground: "hsl(222 47% 11%)",
        },
        primary: {
          DEFAULT: "hsl(222 47% 11%)",
          foreground: "hsl(0 0% 100%)",
        },
        secondary: {
          DEFAULT: "hsl(220 14% 96%)",
          foreground: "hsl(222 47% 11%)",
        },
        // 状态色
        status: {
          notStarted: "hsl(210 14% 89%)",
          clarifying: "hsl(45 93% 58%)",
          pendingGoal: "hsl(142 71% 45%)",
          implementing: "hsl(217 91% 60%)",
          testsPending: "hsl(280 67% 55%)",
          qaPassed: "hsl(170 76% 40%)",
          done: "hsl(142 76% 36%)",
          blocked: "hsl(0 84% 60%)",
          abandoned: "hsl(220 9% 46%)",
        },
      },
      borderRadius: {
        lg: "0.5rem",
        md: "calc(0.5rem - 2px)",
        sm: "calc(0.5rem - 4px)",
      },
      fontFamily: {
        sans: ["-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        mono: ["SF Mono", "Monaco", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
