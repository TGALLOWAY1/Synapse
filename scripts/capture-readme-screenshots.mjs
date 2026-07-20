// Capture real-product screenshots of Synapse for the README.
//
// Unlike capture-tour-screenshots.mjs (which shoots the /tour demo UI), this
// drives the ACTUAL app end-to-end with a real Gemini run and screenshots the
// core surfaces a reader cares about:
//   1. prompt         — the idea entry on the home page
//   2. generation     — live PRD generation with concurrent dependency waves
//   3. prd            — the generated PRD (Overview)
//   4. refine         — highlight-to-refine action popover (Clarify/Expand/…)
//   5. features       — the Features view with per-feature Confirm approval
//   6. decisions      — the Decision Center (Challenge stage)
//   7. artifacts      — downstream assets generated in Explore
//
// It reuses the same boot / fetch-relay / settle-detection machinery as
// scripts/e2e-live-run.mjs (see docs/E2E_LIVE_TESTING.md). Auth is the dev-only
// local bypass (VITE_DEV_SKIP_AUTH=true) — no real account, nothing synced.
//
// Run:
//   npm run capture:readme                       # live (needs a Gemini key)
//   npm run capture:readme -- --out=./shots      # custom output dir
//   npm run capture:readme -- --prompt="…" --name="…"
//
// Needs SYNAPSE_E2E_GEMINI_KEY (or GEMINI_API_KEY). Use a dedicated, quota-capped
// test key — never a production key, never committed. Output PNGs land in the
// out dir (default e2e-results/readme-<timestamp>/, gitignored); copy the ones
// you want into public/screenshots/ by hand.

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute, resolve } from 'node:path';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

// ---------------------------------------------------------------------------
// Args & config
// ---------------------------------------------------------------------------
function parseArgs(argv) {
    const out = { prompt: undefined, name: undefined, out: undefined, timeoutMin: undefined, relay: undefined, port: undefined };
    for (const a of argv) {
        if (a === '--fetch-relay') out.relay = true;
        else if (a === '--no-relay') out.relay = false;
        else if (a.startsWith('--prompt=')) out.prompt = a.slice('--prompt='.length);
        else if (a.startsWith('--name=')) out.name = a.slice('--name='.length);
        else if (a.startsWith('--out=')) out.out = a.slice('--out='.length);
        else if (a.startsWith('--timeout-min=')) out.timeoutMin = Number(a.slice('--timeout-min='.length));
        else if (a.startsWith('--port=')) out.port = Number(a.slice('--port='.length));
    }
    return out;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const args = parseArgs(process.argv.slice(2));

const GEMINI_KEY = process.env.SYNAPSE_E2E_GEMINI_KEY || process.env.GEMINI_API_KEY || '';
if (!GEMINI_KEY) {
    console.error('Needs a Gemini key in SYNAPSE_E2E_GEMINI_KEY (or GEMINI_API_KEY). Use a dedicated low-quota test key.');
    process.exit(1);
}

const PORT = args.port || 5182; // dedicated port (5173/5179/5180/5181 already used)
const BASE_URL = `http://localhost:${PORT}`;
const GENERATION_TIMEOUT_MS = (args.timeoutMin || 14) * 60_000;

const IDEA_PROMPT = args.prompt ||
    'FieldNote — a mobile-first field-service app for independent HVAC technicians. ' +
    'Snap a photo of a unit, dictate a repair note, auto-generate the customer invoice, ' +
    'and sync job history offline. Calm, practical, built for one-handed use on a job site.';
const PROJECT_NAME = args.name || 'FieldNote';

const startedAt = new Date();
const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = args.out
    ? (isAbsolute(args.out) ? args.out : resolve(repoRoot, args.out))
    : join(repoRoot, 'e2e-results', `readme-${stamp}`);
mkdirSync(outDir, { recursive: true });

const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy;
const USE_RELAY = args.relay ?? Boolean(PROXY_URL);

// ---------------------------------------------------------------------------
// Chromium / dev-server helpers (mirror e2e-live-run.mjs)
// ---------------------------------------------------------------------------
function findChromiumExecutable() {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (!root || !existsSync(root)) return undefined;
    for (const d of readdirSync(root).filter((x) => x.startsWith('chromium-'))) {
        const candidate = join(root, d, 'chrome-linux', 'chrome');
        if (existsSync(candidate)) return candidate;
    }
    return undefined;
}

function startDevServer() {
    const child = spawn('npm', ['run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, BROWSER: 'none', VITE_DEV_SKIP_AUTH: 'true' },
    });
    child.stdout.on('data', (d) => process.stdout.write(`[vite] ${d}`));
    child.stderr.on('data', (d) => process.stderr.write(`[vite] ${d}`));
    return child;
}

async function waitForServer(url, timeoutMs = 60000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try { const res = await fetch(url); if (res.ok) return; } catch { /* not up */ }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Dev server did not come up at ${url}`);
}

// Fetch relay (see e2e-live-run.mjs header): Chromium TLS handshakes to external
// hosts get fingerprint-filtered behind egress proxies, so intercept every page
// request and fulfil it from Node fetch (localhost direct; external via undici
// ProxyAgent pinned to HTTPS_PROXY).
const RELAY_STRIP_REQ = new Set(['host', 'accept-encoding']);
const RELAY_STRIP_RES = new Set(['content-encoding', 'content-length', 'transfer-encoding']);
async function buildProxiedFetch() {
    if (!PROXY_URL) return globalThis.fetch;
    try {
        const undici = await import('undici');
        const dispatcher = new undici.ProxyAgent(PROXY_URL);
        return (url, opts) => undici.fetch(url, { ...opts, dispatcher });
    } catch (err) {
        console.warn(`undici ProxyAgent unavailable (${err?.message || err}); relay falling back to global fetch.`);
        return globalThis.fetch;
    }
}
async function attachFetchRelay(context) {
    const proxiedFetch = await buildProxiedFetch();
    await context.route('**/*', async (route) => {
        const req = route.request();
        const url = req.url();
        if (url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
        const host = new URL(url).hostname;
        const isLocal = host === 'localhost' || host === '127.0.0.1';
        const doFetch = isLocal ? globalThis.fetch : proxiedFetch;
        try {
            const headers = { ...req.headers() };
            for (const k of Object.keys(headers)) if (RELAY_STRIP_REQ.has(k.toLowerCase())) delete headers[k];
            const method = req.method();
            const body = method === 'GET' || method === 'HEAD' ? undefined : req.postDataBuffer() || undefined;
            const resp = await doFetch(url, { method, headers, body, redirect: 'manual' });
            const buf = Buffer.from(await resp.arrayBuffer());
            const outHeaders = {};
            resp.headers.forEach((v, k) => { if (!RELAY_STRIP_RES.has(k.toLowerCase())) outHeaders[k] = v; });
            await route.fulfill({ status: resp.status, headers: outHeaders, body: buf });
        } catch {
            await route.abort().catch(() => {});
        }
    });
}

// ---------------------------------------------------------------------------
// Shot helper
// ---------------------------------------------------------------------------
// Hide dev-only chrome that would look wrong in a marketing screenshot: the
// "Cloud save failed" sync badge is expected local noise (plain `vite dev`
// runs no `api/` backend, so project sync always 404s) — see
// docs/E2E_LIVE_TESTING.md. It says nothing about the product, so blank it.
async function hideDevChrome(page) {
    await page.evaluate(() => {
        const labels = ['Cloud save failed', 'Saved on this device', 'Cloud sync pending', 'Synced to cloud'];
        document.querySelectorAll('span').forEach((el) => {
            const t = (el.textContent || '').trim();
            if (labels.some((l) => t === l) || /^Synced /.test(t) || /^Last cloud save/.test(t)) {
                (el.parentElement || el).style.visibility = 'hidden';
            }
        });
    }).catch(() => {});
}

let shotIndex = 0;
async function shot(page, slug, { fullPage = false } = {}) {
    await hideDevChrome(page);
    shotIndex += 1;
    const file = `${String(shotIndex).padStart(2, '0')}-${slug}.png`;
    await page.screenshot({ path: join(outDir, file), fullPage });
    console.log(`  📸 ${file}`);
    return file;
}
const settle = (ms) => new Promise((r) => setTimeout(r, ms));

// Read the app's own persisted store for the latest spine's generation phase.
async function readSpinePhase(page, projectId) {
    return page.evaluate((id) => {
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k || !k.startsWith('synapse-projects-storage')) continue;
            try {
                const state = JSON.parse(localStorage.getItem(k) || '{}').state;
                const spines = state?.spineVersions?.[id];
                if (!spines?.length) continue;
                const latest = spines[spines.length - 1];
                return { phase: latest.generationPhase ?? null, error: latest.generationError?.message ?? null };
            } catch { /* ignore */ }
        }
        return { phase: null, error: null };
    }, projectId);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log(`Output: ${outDir}${USE_RELAY ? ' (fetch relay on)' : ''}`);
const devServer = startDevServer();
let browser;
let exitCode = 0;

try {
    await waitForServer(BASE_URL);
    browser = await chromium.launch({ executablePath: findChromiumExecutable() });
    const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2, // crisp README imagery
        reducedMotion: 'reduce',
    });
    if (USE_RELAY) await attachFetchRelay(context);

    const page = await context.newPage();
    await context.addInitScript(([key]) => {
        window.localStorage.setItem('GEMINI_API_KEY', key);
        window.localStorage.setItem('synapse-tour-completed', 'true');
    }, [GEMINI_KEY]);

    // Warm-up: let Vite's dep optimizer settle so it doesn't force-reload mid-flow.
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.getByPlaceholder('What product shall we design?').waitFor({ timeout: 60_000 }).catch(() => {});
    await settle(6000);

    let projectId = null;

    // --- 1. Prompt / home -----------------------------------------------------
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.getByPlaceholder('What product shall we design?').waitFor({ timeout: 30_000 });
    await settle(1500);
    await shot(page, 'prompt-empty');

    const fillIdeaForm = async () => {
        await page.getByPlaceholder(/Project name/).fill(PROJECT_NAME);
        await page.getByPlaceholder('What product shall we design?').fill(IDEA_PROMPT);
    };
    await fillIdeaForm();
    await settle(500);
    await shot(page, 'prompt-filled');

    // --- Start immediate generation ------------------------------------------
    for (let attempt = 0; attempt < 2; attempt++) {
        const text = await page.getByPlaceholder('What product shall we design?').inputValue();
        if (text !== IDEA_PROMPT) await fillIdeaForm();
        try { await page.getByRole('button', { name: 'Generate PRD' }).click({ timeout: 10_000 }); break; }
        catch (err) { if (attempt === 1) throw err; }
    }
    await page.getByText('How would you like to start?').waitFor({ timeout: 10_000 });
    await settle(400);
    await shot(page, 'start-mode-choice');

    await page.getByRole('button', { name: /Draft a working plan/ }).click();
    await page.waitForURL(/\/p\//, { timeout: 15_000 });
    projectId = page.url().split('/p/')[1]?.split(/[/?#]/)[0] || null;
    console.log(`  project: ${projectId}`);

    // On the immediate-generation path the app shows an inline "Choose your
    // visual direction" setup step in the plan area WHILE the PRD generates in
    // the background. Dismiss it with "Decide later" so the live dependency-wave
    // ProgressTimeline is revealed (the preset picker reappears later, on the
    // Explore-outputs path, and is handled there).
    await page.getByRole('button', { name: 'Decide later' }).click({ timeout: 10_000 }).catch(() => {
        console.warn('  no inline design setup to dismiss (timeline may already be visible)');
    });
    await settle(800);

    // --- 2. Generation with concurrency --------------------------------------
    // Capture the live dependency-wave timeline early, when parallel sections
    // are most visibly in flight, then a couple more along the way.
    const genT0 = Date.now();
    const genShotsAt = [1500, 6000, 14000, 26000];
    let genShotCursor = 0;
    for (;;) {
        const result = await readSpinePhase(page, projectId);
        if (result.phase === 'complete') { if (result.error) console.warn(`  generation error: ${result.error}`); break; }
        if (Date.now() - genT0 > GENERATION_TIMEOUT_MS) { await shot(page, 'generation-TIMEOUT'); throw new Error('generation did not settle'); }
        const elapsed = Date.now() - genT0;
        if (genShotCursor < genShotsAt.length && elapsed >= genShotsAt[genShotCursor]) {
            await page.evaluate(() => window.scrollTo(0, 0));
            await shot(page, `generation-${Math.round(elapsed / 1000)}s`);
            genShotCursor += 1;
        }
        await settle(1500);
    }
    console.log(`  generation settled in ${Math.round((Date.now() - genT0) / 1000)}s`);
    await settle(2500);

    // --- 3. PRD Overview ------------------------------------------------------
    await page.locator('#prd-tab-overview').click({ timeout: 5000 }).catch(() => {});
    await settle(1200);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 'prd-overview');

    // --- 4. Highlight-to-refine popover --------------------------------------
    // Programmatically select a phrase inside the PRD content container and
    // dispatch pointerup so useSelectionPopover surfaces the action dialog.
    await page.evaluate(() => {
        const panel = document.querySelector('#prd-panel-overview');
        if (!panel) return false;
        // Find a paragraph-ish text node with a decent phrase to anchor on.
        const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
        let node = null;
        while (walker.nextNode()) {
            const t = walker.currentNode.textContent || '';
            if (t.trim().length > 80) { node = walker.currentNode; break; }
        }
        if (!node) return false;
        const text = node.textContent || '';
        const start = text.indexOf(' ', 10) + 1;
        const end = Math.min(text.length, start + 60);
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, end);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        node.parentElement?.scrollIntoView({ block: 'center' });
        document.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
        return true;
    });
    await settle(700);
    // The popover is open; prefill an intent via the Expand chip so the shot
    // reads as an in-progress refinement.
    const refineDialog = page.getByRole('dialog', { name: 'PRD edit actions' });
    if (await refineDialog.isVisible().catch(() => false)) {
        await refineDialog.getByRole('button', { name: 'Expand' }).click().catch(() => {});
        await settle(300);
        // Type a realistic follow-on so the popover reads as an in-progress edit.
        await refineDialog.getByPlaceholder('How should this change?')
            .fill('Expand: spell out the offline-sync failure states').catch(() => {});
        await settle(500);
        await shot(page, 'refine-popover');
    } else {
        console.warn('  refine popover did not open — capturing PRD instead');
        await shot(page, 'refine-popover-MISSING');
    }
    // Clear the selection/dialog before moving on.
    await page.keyboard.press('Escape').catch(() => {});
    await settle(400);

    // --- 5. Features view + Confirm approval ---------------------------------
    await page.locator('#prd-tab-features').click({ timeout: 5000 }).catch(() => {});
    await settle(1200);
    await page.evaluate(() => window.scrollTo(0, 0));
    // Expand the first collapsed feature system so feature cards (and their
    // Confirm buttons) are visible.
    const groupToggle = page.locator('#prd-panel-features button[aria-expanded="false"]').first();
    if (await groupToggle.isVisible().catch(() => false)) {
        await groupToggle.click().catch(() => {});
        await settle(700);
    }
    // Approve the first feature so the shot shows a mix of confirmed/unconfirmed.
    const firstConfirm = page.getByRole('button', { name: /^Confirm feature / }).first();
    if (await firstConfirm.isVisible().catch(() => false)) {
        await firstConfirm.scrollIntoViewIfNeeded().catch(() => {});
        await firstConfirm.click().catch(() => {});
        await settle(800);
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 'features');

    // --- 6. Decision Center (Challenge stage) --------------------------------
    const stageNav = page.getByRole('navigation', { name: 'Planning progression' });
    await stageNav.getByRole('button', { name: /^Challenge:/ }).click({ timeout: 6000 }).catch(() => {});
    await settle(1800);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 'decision-center');

    // --- 7. Artifacts in Explore ---------------------------------------------
    // Commit through the readiness gate with accepted risk (a fresh working plan
    // is in the exploring phase), then take the "Explore outputs" path → visual
    // direction preset → real artifact bundle.
    await page.getByRole('button', { name: 'Review readiness' }).click({ timeout: 8000 }).catch(() => {});
    await settle(1200);
    const commitReady = page.getByRole('button', { name: 'Commit plan' });
    if (await commitReady.isVisible().catch(() => false)) {
        await commitReady.click();
    } else {
        await page.getByRole('button', { name: 'Proceed with accepted risk' }).click({ timeout: 6000 }).catch(() => {});
        await settle(500);
        await page.locator('#readiness-rationale').fill(
            'Screenshot capture run: committing to exercise the downstream asset generation for README imagery.',
        ).catch(() => {});
        const containment = page.locator('#readiness-containment');
        if (await containment.isVisible().catch(() => false)) {
            await containment.fill('Throwaway local capture build — generated artifacts are used only for screenshots.').catch(() => {});
        }
        await page.getByRole('button', { name: /^Proceed with \d+ open item/ }).click({ timeout: 6000 }).catch(() => {});
    }
    const finalizeButton = () => page.locator('[aria-labelledby="finalize-success-title"]')
        .getByRole('button', { name: /Generate build foundation|Explore outputs/ });
    await finalizeButton().waitFor({ timeout: 12_000 }).catch(() => {});
    await settle(400);
    await finalizeButton().click({ timeout: 8000 }).catch(() => {});
    // Visual-direction preset picker gates the first bundle.
    const preset = page.getByText('Choose your visual direction');
    if (await preset.isVisible({ timeout: 6000 }).catch(() => false)) {
        await shot(page, 'design-preset');
        await page.getByRole('button', { name: /^Modern SaaS/ }).click({ timeout: 6000 }).catch(() => {});
        await settle(300);
        await page.getByRole('button', { name: /^Continue with/ }).click({ timeout: 6000 }).catch(() => {});
    }
    await settle(3000);
    await shot(page, 'artifacts-generating');

    // Wait for the core bundle to settle (mirrors e2e settle logic).
    const VISIBLE_CORE = ['design_system', 'user_flows', 'screen_inventory', 'data_model', 'implementation_plan'];
    const aT0 = Date.now();
    let lastReady = -1, lastChangeAt = aT0;
    for (;;) {
        const info = await page.evaluate((id) => {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k || !k.startsWith('synapse-projects-storage')) continue;
                try {
                    const state = JSON.parse(localStorage.getItem(k) || '{}').state;
                    const arr = state?.artifacts?.[id];
                    if (!arr?.length) continue;
                    const ready = arr.filter((a) => a.currentVersionId);
                    return { ready: ready.length, subtypes: ready.map((a) => a.subtype || a.type) };
                } catch { /* ignore */ }
            }
            return { ready: 0, subtypes: [] };
        }, projectId);
        const spinners = await page.locator('nav[aria-label="Artifacts"] .animate-spin').count().catch(() => 0);
        const building = await page.getByText('Creating your build assets…').isVisible().catch(() => false);
        const domIdle = spinners === 0 && !building;
        const haveCore = VISIBLE_CORE.every((s) => info.subtypes.includes(s));
        if (info.ready !== lastReady) { lastReady = info.ready; lastChangeAt = Date.now(); }
        if (haveCore && domIdle) break;
        if (domIdle && info.ready >= 3 && Date.now() - lastChangeAt > 60_000) break;
        if (Date.now() - aT0 > GENERATION_TIMEOUT_MS) { console.warn('  asset settle timed out'); break; }
        await settle(5000);
    }
    console.log(`  assets settled in ${Math.round((Date.now() - aT0) / 1000)}s`);
    await settle(2000);

    // Ensure we're on the Explore stage, then screenshot the workspace + a few
    // individual artifacts.
    await stageNav.getByRole('button', { name: /^(Explore|Build):/ }).click({ timeout: 6000 }).catch(() => {});
    await settle(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(page, 'artifacts-explore');

    for (const title of ['Design System', 'Screens', 'User Flows', 'Data Model', 'Implementation Plan']) {
        await page.locator('nav[aria-label="Artifacts"] button').filter({ hasText: title }).first()
            .click({ timeout: 6000 }).catch(() => {});
        await settle(1600);
        await page.evaluate(() => window.scrollTo(0, 0));
        await shot(page, `artifact-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
    }

    await context.close();
} catch (err) {
    console.error(`\nFatal: ${String(err?.stack || err).replaceAll(GEMINI_KEY, '<gemini-key>')}`);
    exitCode = 1;
} finally {
    if (browser) await browser.close().catch(() => {});
    devServer.kill();
}

console.log(`\nScreenshots in: ${outDir}`);
console.log('Review the PNGs, then copy the keepers into public/screenshots/.');
process.exit(exitCode);
