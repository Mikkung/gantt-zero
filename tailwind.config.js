/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["system-ui", "Inter", "sans-serif"],
      },
      colors: {
        primary: {
          DEFAULT: "#8B2332",
          soft: "#FBEAEC",
          muted: "#F2D6DA",
          dark: "#6B1A26",
        },
      },
      boxShadow: {
        card: "0 18px 45px -15px rgba(15,23,42,0.25)",
      },
      borderRadius: {
        "2xl": "1.25rem",
      },
    },
  },
  plugins: [],
};
