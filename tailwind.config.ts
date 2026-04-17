import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        arabic: ["Amiri Quran", "Scheherazade New", "serif"],
        serif: ["Cormorant Garamond", "serif"],
      },
      colors: {
        meccan: "#6e8cff",
        medinan: "#ffb347",
        cosmos: "#03040a",
      },
    },
  },
  plugins: [],
};

export default config;
