import colors from 'tailwindcss/colors';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      // Semantic design tokens (see DESIGN.md). `brand` deliberately owns the
      // incumbent indigo family and `accent` its violet companion (the tour
      // gradient), so surfaces reference intent (`brand-600`) rather than a
      // raw hue. `muted`/`muted-dark` are the only sanctioned secondary-text
      // colors: `muted` (neutral-500, 4.6:1 on white) for light panes,
      // `muted-dark` (neutral-400) for dark chrome — never neutral-400 on a
      // light surface (fails WCAG AA at ~2.8:1).
      colors: {
        brand: colors.indigo,
        accent: colors.violet,
        muted: colors.neutral[500],
        'muted-dark': colors.neutral[400],
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
