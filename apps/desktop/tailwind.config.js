/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        darkBg: "#0f1013",
        darkSurface: "#181a1f",
        darkBorder: "#2a2d35",
        accentBlue: "#3b82f6",
        accentGreen: "#22c55e",
        accentAmber: "#f59e0b",
        accentRed: "#ef4444"
      }
    },
  },
  plugins: [],
}
