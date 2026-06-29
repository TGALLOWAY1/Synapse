import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [react()],
    // Mirror vite.config's build-time constants so components that read them
    // (e.g. SettingsModal's System Status) don't hit an undefined global.
    define: {
        __APP_VERSION__: JSON.stringify('test'),
        __BUILD_DATE__: JSON.stringify('test'),
    },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/test/setup.ts'],
    },
});
