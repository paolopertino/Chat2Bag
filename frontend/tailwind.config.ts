import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cream: "#faf6ed",
        ink: "#111315",
        coral: "#f26a4b",
        teal: "#2d7f85",
      },
      fontFamily: {
        sans: ["'Space Grotesk'", "system-ui", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "monospace"],
      },
      boxShadow: {
        soft: "0 16px 40px -22px rgba(17, 19, 21, 0.35)",
      },
    },
  },
  plugins: [],
} satisfies Config;
