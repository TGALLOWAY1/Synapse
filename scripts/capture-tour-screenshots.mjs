// Capture screenshots of the live interactive product tour (/tour) for the
// README. The tour (src/components/tour/) is entirely live React with no static
// images, so we drive it with Playwright and snapshot each of its seven screens.
//
// Run with: npm run capture:screenshots
// Requires the Chromium binary: `npx playwright install chromium` (one-time).
//
// The script boots the Vite dev server itself, seeds the tour-completed flag so
// the tour opens in Overview mode (progress rail visible), forces
// prefers-reduced-motion so animated sequences settle to their final state, then
// walks the seven screens (ArrowRight) and writes one PNG per beat.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readdirSync } from 'node:fs';
import { chromium } from 'playwright';

// Some provisioned environments ship a Chromium build that doesn't match the
// installed Playwright's expected revision (no chrome-headless-shell). If a
// usable Chromium binary already exists under PLAYWRIGHT_BROWSERS_PATH, point
// Playwright at it directly so capture works without a fresh download.
function findChromiumExecutable() {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (!root || !existsSync(root)) return undefined;
    const dirs = readdirSync(root).filter((d) => d.startsWith('chromium-'));
    for (const d of dirs) {
        const candidate = join(root, d, 'chrome-linux', 'chrome');
        if (existsSync(candidate)) return candidate;
    }
    return undefined;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const outDir = join(repoRoot, 'public', 'screenshots');

const PORT = 5179; // dedicated port to avoid clashing with a running dev server
const BASE_URL = `http://localhost:${PORT}`;

// One output file per tour beat, in screen order.
const SHOTS = [
    'tour-idea.png',
    'tour-spec.png',
    'tour-refine.png',
    'tour-decisions.png',
    'tour-versions.png',
    'tour-assets.png',
    'tour-connections.png',
];

// Per-screen settle time before capture. The Assets screen runs a sequential
// asset-generation sequence, so it gets the longest wait.
const SETTLE_MS = [2200, 2600, 2200, 2200, 2200, 5000, 3000];

function startDevServer() {
    const child = spawn('npm', ['run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, BROWSER: 'none' },
    });
    child.stdout.on('data', (d) => process.stdout.write(`[vite] ${d}`));
    child.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
    return child;
}

async function waitForServer(url, timeoutMs = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            const res = await fetch(url);
            if (res.ok) return;
        } catch {
            // not up yet
        }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Dev server did not come up at ${url} within ${timeoutMs}ms`);
}

async function main() {
    const server = startDevServer();
    let browser;
    try {
        await waitForServer(`${BASE_URL}/`);

        const executablePath = findChromiumExecutable();
        browser = await chromium.launch(executablePath ? { executablePath } : undefined);
        const context = await browser.newContext({
            viewport: { width: 1440, height: 920 },
            deviceScaleFactor: 2, // crisp on Retina/HiDPI README displays
            reducedMotion: 'reduce', // tour renders final state instantly
        });

        // Boot the tour in Overview mode (returning-user view with progress rail).
        await context.addInitScript(() => {
            try {
                window.localStorage.setItem('synapse-tour-completed', 'true');
            } catch {
                /* ignore */
            }
        });

        const page = await context.newPage();
        await page.goto(`${BASE_URL}/tour`, { waitUntil: 'networkidle' });

        for (let i = 0; i < SHOTS.length; i++) {
            // Give the lazy chunk + any timed sequence time to settle.
            await page.waitForTimeout(SETTLE_MS[i]);
            const outPath = join(outDir, SHOTS[i]);
            await page.screenshot({ path: outPath });
            console.log(`captured ${SHOTS[i]}`);

            if (i < SHOTS.length - 1) {
                // Advance to the next screen. Arrow keys work in both modes and
                // are ignored only while typing in a field.
                await page.keyboard.press('ArrowRight');
            }
        }

        await browser.close();
        browser = undefined;
        console.log(`\nDone — ${SHOTS.length} screenshots written to public/screenshots/`);
    } finally {
        if (browser) await browser.close().catch(() => {});
        server.kill('SIGTERM');
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
