import colors from 'tailwindcss/colors';
import defaultTheme from 'tailwindcss/defaultTheme';

// "Electric iris" — Synapse's owned brand scale (OKLCH hue 285, built and
// contrast-validated in DESIGN.md). Deliberately NOT stock Tailwind indigo:
// warmer, more electric, and applied at system scale by overriding the
// `indigo` alias below so every legacy `indigo-*` call site renders the
// owned hue without a 200-file migration.
const iris = {
  50: '#f4f4ff',
  100: '#e8e8ff',
  200: '#d4d4ff',
  300: '#b6b4ff',
  400: '#968cff',
  500: '#7962f8',
  600: '#653bec',
  700: '#542bcb',
  800: '#4426a3',
  900: '#34217c',
  950: '#211552',
};

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Semantic design tokens (see DESIGN.md). `brand` is the owned iris
      // scale; `indigo` aliases it so the whole app shifts together (raw
      // indigo-* in older code is legacy spelling of the same brand role).
      // `accent` (violet) is the tour-gradient companion. `muted`/`muted-dark`
      // are the only sanctioned secondary-text colors: `muted` (neutral-500,
      // 4.6:1 on white) for light panes, `muted-dark` (neutral-400) for dark
      // chrome — never neutral-400 on a light surface (fails WCAG AA).
      colors: {
        brand: iris,
        indigo: iris,
        accent: colors.violet,
        muted: colors.neutral[500],
        'muted-dark': colors.neutral[400],
      },
      fontFamily: {
        // Display voice for brand moments only (wordmark, hero, splash, tour
        // headings) — self-hosted Space Grotesk Variable. Operate surfaces
        // stay on the system sans for scanability.
        display: ['"Space Grotesk Variable"', ...defaultTheme.fontFamily.sans],
      },
      keyframes: {
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
      },
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
