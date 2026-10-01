import { configDefaults, defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Pure logic (src/lib), stores (src/store) and the serverless handlers (api)
// don't need a DOM, and jsdom's per-test-file startup was the largest single
// cost of the suite. These directories run under `node`; everything else
// (components, hooks, test helpers, and any directory added later) keeps
// `jsdom`. A suite under these directories that genuinely needs
// window/document/localStorage opts back in with a first-line
// `// @vitest-environment jsdom` docblock instead of widening the glob.
const NODE_ENV_DIRS = ['src/lib', 'src/store', 'api'];

// Local git worktrees can contain tests from older branches. Running
// them from this repository root makes their cwd-based source reads
// target the current checkout, producing duplicate and contradictory
// assertions.
const exclude = [...configDefaults.exclude, '**/.worktrees/**'];

export default defineConfig({
    plugins: [react()],
    // Mirror vite.config's build-time constants so components that read them
    // (e.g. SettingsModal's System Status) don't hit an undefined global.
    define: {
        __APP_VERSION__: JSON.stringify('test'),
        __BUILD_DATE__: JSON.stringify('test'),
    },
    test: {
        globals: true,
        setupFiles: ['./src/test/setup.ts'],
        projects: [
            {
                extends: true,
                test: {
                    name: 'node',
                    environment: 'node',
                    include: NODE_ENV_DIRS.map(dir => `${dir}/**/*.{test,spec}.?(c|m)[jt]s?(x)`),
                    exclude,
                },
            },
            {
                extends: true,
                test: {
                    name: 'jsdom',
                    environment: 'jsdom',
                    exclude: [...exclude, ...NODE_ENV_DIRS.map(dir => `${dir}/**`)],
                },
            },
        ],
    },
});
