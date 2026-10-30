/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        rubik: ["Rubik-Regular", "sans-serif"],
        "rubik-bold": ["Rubik-Bold", "sans-serif"],
        "rubik-extrabold": ["Rubik-ExtraBold", "sans-serif"],
        "rubik-medium": ["Rubik-Medium", "sans-serif"],
        "rubik-semibold": ["Rubik-SemiBold", "sans-serif"],
        "rubik-light": ["Rubik-Light", "sans-serif"],
      },
      colors: {
        // Brand (unchanged — ReState identity)
        primary: {
          // Theme variables (see app/global.css): these two are fills, and a
          // 4%-alpha blue that works on white is invisible on a dark surface.
          // The solid brand blues below stay fixed — they are the identity.
          100: "rgb(var(--primary-100) / <alpha-value>)",
          200: "rgb(var(--primary-200) / <alpha-value>)",
          300: "#0061FF",
          400: "#0052D9",
          500: "#003EA6",
        },
        accent: { 100: "#FBFBFD" },
        black: {
          DEFAULT: "#000000",
          100: "#8C8E98",
          200: "#666876",
          300: "#191D31",
        },
        danger: "#F75555",
        success: "#12B76A",
        warning: "#F79009",

        // Semantic surface tokens, so screens stop hardcoding raw values.
        // Dark values are applied via the `dark:` variants in components.
        surface: {
          DEFAULT: "#FFFFFF",
          muted: "#F5F7FB",
          sunken: "#EDF1F7",
          dark: "#12141C",
          "dark-muted": "#1B1E28",
          "dark-elevated": "#232735",
        },
        line: {
          DEFAULT: "#E6EAF2",
          strong: "#CBD3E1",
          dark: "#2A2F3D",
        },
        // Glass layers (design-system: glassmorphism, backdrop blur + 1px light border)
        glass: {
          light: "#FFFFFFCC",
          "light-border": "#FFFFFF66",
          dark: "#12141CB3",
          "dark-border": "#FFFFFF1A",
        },
      },
      // 4/8dp rhythm (pro-rules: "8dp spacing rhythm").
      // Values MUST carry units — bare numbers emit invalid CSS and are dropped.
      spacing: {
        "2xs": "4px",
        xs: "8px",
        sm: "12px",
        md: "16px",
        lg: "24px",
        xl: "32px",
        "2xl": "48px",
        "3xl": "64px",
      },
      borderRadius: {
        xs: "6px",
        sm: "10px",
        md: "14px",
        lg: "20px",
        xl: "28px",
        "2xl": "36px",
      },
      fontSize: {
        // Body never below 12px (priority 6: Typography)
        caption: ["12px", { lineHeight: "16px" }],
        body: ["16px", { lineHeight: "24px" }],   // base 16 / 1.5
        lead: ["18px", { lineHeight: "27px" }],
        h3: ["20px", { lineHeight: "28px" }],
        h2: ["24px", { lineHeight: "32px" }],
        h1: ["30px", { lineHeight: "38px" }],
        display: ["36px", { lineHeight: "44px" }],
      },
    },
  },
  plugins: [],
};
