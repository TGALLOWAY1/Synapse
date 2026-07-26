import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', '.vite', 'src/styles/mockup-tailwind.generated.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  // The Vercel serverless functions under `api/`. This is production
  // auth/session/DB code and it is NOT type-checked — `tsc -b` only builds the
  // `src/` projects — so ESLint is the only static analysis it gets. Rules are
  // the JS recommended set only (no type-aware rules; there are no types here).
  //
  // `scripts/` is deliberately excluded: those .mjs files embed browser-context
  // callbacks (page.evaluate) whose DOM globals read as no-undef in a Node
  // config, so linting them needs per-file globals rather than one block.
  {
    files: ['api/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
])
