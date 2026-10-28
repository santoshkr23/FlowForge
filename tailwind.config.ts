import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#EEF1F6",
        paper: "#FFFFFF",
        line: "#D5DCE8",
        ink: { DEFAULT: "#14213D", soft: "#4A5672", faint: "#8792AA" },
        wire: { DEFAULT: "#2B59C3", dark: "#1F4499", tint: "#E3EBFA" },
        spark: { DEFAULT: "#F2B705", tint: "#FDF3D0" },
        ok: { DEFAULT: "#1F9D6B", tint: "#DDF3EA" },
        bad: { DEFAULT: "#C2412D", tint: "#F8E1DC" },
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', "system-ui", "sans-serif"],
        sans: ['"IBM Plex Sans"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      borderRadius: { node: "14px" },
    },
  },
  plugins: [],
};
export default config;
