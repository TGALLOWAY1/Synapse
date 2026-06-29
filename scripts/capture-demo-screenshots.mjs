// Capture screenshots of every artifact in the public demo project, on both
// desktop and mobile viewports.
//
// Run with:  npm run capture:demo                 (defaults to the prod URL)
//            npm run capture:demo -- --base-url=https://synapse-prd.vercel.app
//            npm run capture:demo -- --out=./screenshots-demo
//            npm run capture:demo -- --local      (boot vite dev — see note)
//
// HOW THE DEMO LOADS — this is the important constraint:
//   The demo project's data is NOT a local fixture. It is fetched at runtime
//   from `/api/snapshots?demo=1` (a public, no-auth Vercel serverless route that
//   reads a pinned snapshot from Blob storage). So this script MUST point at a
//   deployment where that endpoint resolves and a demo snapshot has been pinned.
//   The default is the production URL.
//
//   `--local` boots `vite dev` for capturing un-deployed UI changes, BUT plain
//   `vite dev` does NOT run the `api/` serverless functions, so the demo fetch
//   404s and nothing loads. Use `--local` only together with a dev proxy that
//   forwards `/api/*` to a real deployment.
//
// WHAT IT DOES per viewport (desktop 1440x920, mobile 390x844, both @2x):
//   1. open `/` (signed out → LoginPage) and click "Demo project"
//   2. wait for navigation to /p/<DEMO_PROJECT_ID>
//   3. switch to the "Assets" pipeline stage (where one nav lists PRD + every
//      artifact)
//   4. select each artifact in turn (on mobile, via the slide-in drawer) and
//      write one full-page PNG: demo-<artifact>-<desktop|mobile>.png
//
// Requires the Chromium binary (pre-installed in CI/web envs via
// PLAYWRIGHT_BROWSERS_PATH; locally: `npx playwright install chromium`).

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute, resolve } from 'node:path';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
    const out = { baseUrl: undefined, out: undefined, local: false };
    for (const a of argv) {
        if (a === '--local') out.local = true;
        else if (a.startsWith('--base-url=')) out.baseUrl = a.slice('--base-url='.length);
        else if (a.startsWith('--out=')) out.out = a.slice('--out='.length);
    }
    return out;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const args = parseArgs(process.argv.slice(2));
const DEFAULT_PROD_URL = 'https://synapse-prd.vercel.app';
const LOCAL_PORT = 5180;
const BASE_URL = (args.local
    ? `http://localhost:${LOCAL_PORT}`
    : (args.baseUrl || process.env.DEMO_BASE_URL || DEFAULT_PROD_URL)
).replace(/\/$/, '');

const outDir = args.out
    ? (isAbsolute(args.out) ? args.out : resolve(repoRoot, args.out))
    : join(repoRoot, 'screenshots-demo');

// The artifact nav buttons, in sidebar order. `label` is matched against each
// button's accessible name (regex / substring); `slug` is the filename stem.
const ARTIFACTS = [
    { slug: 'prd', label: 'PRD' },
    { slug: 'user-flows', label: 'User Flows' },
    { slug: 'screen-inventory', label: 'Screen Inventory' },
    { slug: 'mockups', label: 'Mockups' },
    { slug: 'ui-components', label: 'UI Components' },
    { slug: 'design-system', label: 'Design System' },
    { slug: 'data-model', label: 'Data Model' },
    { slug: 'developer-prompts', label: 'Developer Prompts' },
    { slug: 'build-plan', label: 'Build Plan' },
];

// Mockups render images and can be slow; give them extra settle time.
const SETTLE_MS = (label) => (label === 'Mockups' ? 4000 : 1400);

const VIEWPORTS = [
    { name: 'desktop', width: 1440, height: 920, mobile: false },
    { name: 'mobile', width: 390, height: 844, mobile: true },
];

// ---------------------------------------------------------------------------
// Chromium / dev-server helpers (mirrors capture-tour-screenshots.mjs)
// ---------------------------------------------------------------------------
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

function startDevServer() {
    const child = spawn('npm', ['run', 'dev', '--', '--port', String(LOCAL_PORT), '--strictPort'], {
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

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------
async function openDemo(page) {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });

    // Signed-out `/` is the LoginPage with a "Demo project" button; a signed-in
    // session would show HomePage's "View demo project". Match both.
    const demoBtn = page.getByRole('button', { name: /demo project/i }).first();
    await demoBtn.waitFor({ state: 'visible', timeout: 30000 });
    await demoBtn.click();

    // loadDemoProject() fetches the snapshot, then navigates to /p/<demo id>.
    await page.waitForURL('**/p/**', { timeout: 45000 });

    // If the snapshot isn't pinned, the app shows a toast and stays put — surface
    // that clearly rather than timing out cryptically later.
    const notAvailable = page.getByText(/Demo (not available|could not)/i);
    if (await notAvailable.isVisible().catch(() => false)) {
        throw new Error(
            'The demo snapshot is not pinned on this deployment. Pin one from the ' +
            'Cloud Snapshots panel (owner-only), then re-run.',
        );
    }
}

async function gotoAssetsStage(page) {
    // The "Assets" pipeline-stage button carries aria-label "Assets: …".
    const assetsTab = page.getByRole('button', { name: /^Assets:/ });
    await assetsTab.waitFor({ state: 'visible', timeout: 20000 });
    await assetsTab.click();

    // The artifact sidebar (rendered for both viewports; off-canvas on mobile)
    // confirms ArtifactWorkspace mounted — i.e. the demo spine is final.
    await page
        .locator('nav[aria-label="Artifacts"]')
        .waitFor({ state: 'attached', timeout: 20000 })
        .catch(() => {
            throw new Error(
                'Artifact list never appeared after opening Assets — the demo spine ' +
                'may not be marked final, or the demo failed to load.',
            );
        });
}

async function selectArtifact(page, viewport, label) {
    if (viewport.mobile) {
        // Open the slide-in drawer, pick the item (which auto-closes the drawer).
        const hamburger = page.getByRole('button', { name: 'Open artifact list' });
        await hamburger.click();
        await page.waitForTimeout(250); // drawer slide-in
    }
    const nav = page.locator('nav[aria-label="Artifacts"]');
    await nav.getByRole('button', { name: new RegExp(escapeRegExp(label)) }).first().click();
    await page.waitForTimeout(250); // selection + (mobile) drawer slide-out
}

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function captureViewport(browser, viewport, executablePath) {
    const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 2,
        reducedMotion: 'reduce',
        ...(executablePath ? {} : {}),
    });
    const page = await context.newPage();
    try {
        await openDemo(page);
        await gotoAssetsStage(page);

        for (const art of ARTIFACTS) {
            await selectArtifact(page, viewport, art.label);
            await page.waitForTimeout(SETTLE_MS(art.label));
            const outPath = join(outDir, `demo-${art.slug}-${viewport.name}.png`);
            await page.screenshot({ path: outPath, fullPage: true });
            console.log(`captured ${outPath}`);
        }
    } finally {
        await context.close();
    }
}

async function main() {
    mkdirSync(outDir, { recursive: true });

    let server;
    if (args.local) {
        console.log(`Booting vite dev on :${LOCAL_PORT} (note: demo needs /api proxied to a deployment)`);
        server = startDevServer();
    }

    let browser;
    try {
        if (args.local) await waitForServer(`${BASE_URL}/`);
        console.log(`Capturing demo artifacts from ${BASE_URL} → ${outDir}`);

        const executablePath = findChromiumExecutable();
        browser = await chromium.launch(executablePath ? { executablePath } : undefined);

        for (const viewport of VIEWPORTS) {
            console.log(`\n— ${viewport.name} (${viewport.width}x${viewport.height}) —`);
            await captureViewport(browser, viewport, executablePath);
        }

        const total = VIEWPORTS.length * ARTIFACTS.length;
        console.log(`\nDone — ${total} screenshots written to ${outDir}`);
    } finally {
        if (browser) await browser.close().catch(() => {});
        if (server) server.kill('SIGTERM');
    }
}

main().catch((err) => {
    console.error('\n' + (err?.message || err));
    process.exit(1);
});
