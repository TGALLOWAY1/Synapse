// Live end-to-end run: boot the app locally, create a REAL project from a
// plain-language idea, wait for actual Gemini PRD generation to settle, then
// walk the resulting pages and write full-page screenshots + a machine-readable
// report. Built so a human — or a coding agent that can read images (e.g.
// Claude Code) — can visually assess the product without hand-driving the UI.
//
// Run with:
//   npm run e2e            # live run (needs a Gemini key, see below)
//   npm run e2e:smoke      # no-LLM smoke walk (no key needed)
//   npm run e2e -- --prompt="A recipe box app for families" --name="Recipe Box"
//   npm run e2e -- --out=./e2e-results/my-run --timeout-min=15
//
// MODES
//   --live   Full flow: home → idea → "Draft a working plan" → real PRD
//            generation → PRD Overview/Features/Decisions tabs → workspace
//            stage → mobile viewport pass. Requires a Gemini API key in the
//            SYNAPSE_E2E_GEMINI_KEY or GEMINI_API_KEY env var. The key is
//            seeded into the browser's localStorage only (same place the app
//            itself stores it) and is never written to the report or logs.
//   --smoke  Everything up to (but not including) generation, with a dummy
//            key: home renders, idea form fills, start-mode dialog opens.
//            Verifies the harness + app boot without spending tokens.
//   Default: --live when a key env var is present, otherwise --smoke.
//
// AUTH — intentionally NOT your real account:
//   The dev server is booted with VITE_DEV_SKIP_AUTH=true, the dev-only bypass
//   in src/store/authStore.ts ("Dev User", fully local, no backend, no project
//   sync). Production builds ignore that flag, and no OAuth or real credentials
//   are involved, so runs can't touch synced projects on a real account.
//
// RESTRICTED-EGRESS SANDBOXES (Claude Code web/CI containers):
//   When HTTPS_PROXY is set, Chromium's own TLS handshakes to external hosts
//   (including generativelanguage.googleapis.com — the app calls Gemini
//   directly from the browser) get fingerprint-filtered and reset by the
//   egress gateway. Like capture-demo-screenshots.mjs, this script then
//   auto-enables a "fetch relay": every page request is intercepted and
//   fulfilled from Node fetch (localhost directly; external hosts through an
//   undici ProxyAgent pinned to the proxy). Force with --fetch-relay, disable
//   with --no-relay.
//
// COMPLETION DETECTION
//   Generation settle is read from the app's own persisted store (the Zustand
//   localStorage blob): the latest SpineVersion's `generationPhase` flips to
//   'complete' when the run settles (success, error, or safety block) — see
//   src/types/index.ts. Progress screenshots are taken along the way.
//
// OUTPUT (default e2e-results/run-<timestamp>/, gitignored):
//   NN-<step>.png        full-page screenshots in step order
//   report.json          steps (ok/failed/skipped + timing), console errors &
//                        warnings, uncaught page errors, failed network
//                        requests, generation outcome
//
// Requires the Chromium binary (pre-installed in CI/web envs via
// PLAYWRIGHT_BROWSERS_PATH; locally: `npx playwright install chromium`).

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute, resolve } from 'node:path';
import { existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

// ---------------------------------------------------------------------------
// Args & config
// ---------------------------------------------------------------------------
function parseArgs(argv) {
    const out = {
        mode: undefined, prompt: undefined, name: undefined,
        out: undefined, timeoutMin: undefined, relay: undefined, port: undefined,
    };
    for (const a of argv) {
        if (a === '--live') out.mode = 'live';
        else if (a === '--smoke') out.mode = 'smoke';
        else if (a === '--fetch-relay') out.relay = true;
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
const MODE = args.mode ?? (GEMINI_KEY ? 'live' : 'smoke');
if (MODE === 'live' && !GEMINI_KEY) {
    console.error(
        'Live mode needs a Gemini API key in SYNAPSE_E2E_GEMINI_KEY (or GEMINI_API_KEY).\n' +
        'Use a dedicated low-quota test key, not a production key. Or run: npm run e2e:smoke',
    );
    process.exit(1);
}

const PORT = args.port || 5181; // dedicated port; 5173 dev / 5179 tour / 5180 demo already taken
const BASE_URL = `http://localhost:${PORT}`;
const GENERATION_TIMEOUT_MS = (args.timeoutMin || 12) * 60_000;
const PROGRESS_SHOT_EVERY_MS = 45_000;

const IDEA_PROMPT = args.prompt ||
    'A simple habit tracker for busy parents: log daily habits in one tap, ' +
    'see weekly streaks, and share progress with a partner. Mobile-first, ' +
    'calm and encouraging tone, no gamification pressure.';
const PROJECT_NAME = args.name || 'E2E Habit Tracker';

const startedAt = new Date();
const stamp = startedAt.toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outDir = args.out
    ? (isAbsolute(args.out) ? args.out : resolve(repoRoot, args.out))
    : join(repoRoot, 'e2e-results', `run-${stamp}`);
mkdirSync(outDir, { recursive: true });

const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy;
const USE_RELAY = args.relay ?? Boolean(PROXY_URL);

// ---------------------------------------------------------------------------
// Chromium / dev-server helpers (mirrors capture-demo-screenshots.mjs)
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
    const child = spawn('npm', ['run', 'dev', '--', '--port', String(PORT), '--strictPort'], {
        cwd: repoRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        // The dev-only auth bypass: a fully local "Dev User" with no backend,
        // no OAuth, and no project sync. Production builds never honor this.
        env: { ...process.env, BROWSER: 'none', VITE_DEV_SKIP_AUTH: 'true' },
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
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Dev server did not come up at ${url} within ${timeoutMs}ms`);
}

// ---------------------------------------------------------------------------
// Fetch relay (see header). localhost is fetched directly; external hosts go
// through an undici ProxyAgent pinned to HTTPS_PROXY (Node fetch does not
// honor that env var on its own).
// ---------------------------------------------------------------------------
const RELAY_STRIP_REQ = new Set(['host', 'accept-encoding']);
const RELAY_STRIP_RES = new Set(['content-encoding', 'content-length', 'transfer-encoding']);

async function buildProxiedFetch() {
    if (!PROXY_URL) return globalThis.fetch;
    try {
        const undici = await import('undici');
        const dispatcher = new undici.ProxyAgent(PROXY_URL);
        return (url, opts) => undici.fetch(url, { ...opts, dispatcher });
    } catch (err) {
        console.warn(
            `undici ProxyAgent unavailable (${err?.message || err}); ` +
            'relay falling back to global fetch, which may not tunnel through the proxy.',
        );
        return globalThis.fetch;
    }
}

async function attachFetchRelay(context) {
    const proxiedFetch = await buildProxiedFetch();
    await context.route('**/*', async (route) => {
        const req = route.request();
        const url = req.url();
        if (url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
        const isLocal = new URL(url).hostname === 'localhost' || new URL(url).hostname === '127.0.0.1';
        const doFetch = isLocal ? globalThis.fetch : proxiedFetch;
        try {
            const headers = { ...req.headers() };
            for (const k of Object.keys(headers)) {
                if (RELAY_STRIP_REQ.has(k.toLowerCase())) delete headers[k];
            }
            const method = req.method();
            const body = method === 'GET' || method === 'HEAD' ? undefined : req.postDataBuffer() || undefined;
            const resp = await doFetch(url, { method, headers, body, redirect: 'manual' });
            const buf = Buffer.from(await resp.arrayBuffer());
            const outHeaders = {};
            resp.headers.forEach((v, k) => {
                if (!RELAY_STRIP_RES.has(k.toLowerCase())) outHeaders[k] = v;
            });
            await route.fulfill({ status: resp.status, headers: outHeaders, body: buf });
        } catch {
            await route.abort().catch(() => {});
        }
    });
}

// ---------------------------------------------------------------------------
// Report plumbing
// ---------------------------------------------------------------------------
const report = {
    mode: MODE,
    baseUrl: BASE_URL,
    startedAt: startedAt.toISOString(),
    ideaPrompt: IDEA_PROMPT,
    projectName: PROJECT_NAME,
    projectId: null,
    generation: null, // { ms, phase, error }
    steps: [],        // { name, status: ok|failed|skipped, ms, error?, screenshots: [] }
    consoleErrors: [],
    consoleWarnings: [],
    pageErrors: [],
    failedRequests: [],
    ignoredRequests: [],
    httpErrors: [],
    // Plain `vite dev` does not run the `api/` serverless functions, so every
    // /api/* call 404s locally by design (this also produces the "Cloud save
    // failed" header badge). Bucketed separately so they don't read as app
    // defects.
    expectedLocalApiErrors: [],
    screenshots: [],
};

let shotIndex = 0;
async function shot(page, slug, { fullPage = true } = {}) {
    shotIndex += 1;
    const file = `${String(shotIndex).padStart(2, '0')}-${slug}.png`;
    await page.screenshot({ path: join(outDir, file), fullPage });
    report.screenshots.push(file);
    console.log(`  📸 ${file}`);
    return file;
}

async function step(name, fn, { optional = false } = {}) {
    const entry = { name, status: 'ok', ms: 0, screenshots: [] };
    report.steps.push(entry);
    const t0 = Date.now();
    console.log(`\n▶ ${name}`);
    try {
        await fn(entry);
    } catch (err) {
        entry.status = optional ? 'skipped' : 'failed';
        entry.error = String(err?.message || err);
        console[optional ? 'warn' : 'error'](`  ${optional ? '⏭' : '✗'} ${name}: ${entry.error}`);
    }
    entry.ms = Date.now() - t0;
    return entry.status === 'ok';
}

const settle = (ms) => new Promise((r) => setTimeout(r, ms));

// Never leak the key into artifacts.
const redact = (s) => (GEMINI_KEY ? String(s).replaceAll(GEMINI_KEY, '<gemini-key>') : String(s));

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log(`Mode: ${MODE}${USE_RELAY ? ' (fetch relay on)' : ''}`);
console.log(`Output: ${outDir}`);

const devServer = startDevServer();
let browser;
let exitCode = 0;

try {
    await waitForServer(BASE_URL);

    browser = await chromium.launch({ executablePath: findChromiumExecutable() });
    const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
    });
    if (USE_RELAY) await attachFetchRelay(context);

    const page = await context.newPage();
    page.on('console', (msg) => {
        const rec = { type: msg.type(), text: redact(msg.text()).slice(0, 2000), url: page.url() };
        if (msg.type() === 'error') report.consoleErrors.push(rec);
        else if (msg.type() === 'warning') report.consoleWarnings.push(rec);
    });
    page.on('pageerror', (err) => {
        report.pageErrors.push({ message: redact(err.message).slice(0, 2000), url: page.url() });
    });
    page.on('response', (resp) => {
        if (resp.status() < 400) return;
        const url = redact(resp.url());
        const rec = { url, status: resp.status(), method: resp.request().method() };
        const isLocalApi = url.startsWith(BASE_URL) && new URL(resp.url()).pathname.startsWith('/api/');
        (isLocalApi ? report.expectedLocalApiErrors : report.httpErrors).push(rec);
    });
    page.on('requestfailed', (req) => {
        const failure = req.failure()?.errorText || 'unknown';
        const url = redact(req.url());
        // Known environmental noise: blocked Vercel Analytics, and aborted
        // localhost /api/* calls (vite dev runs no serverless functions).
        const isNoise = /vercel-scripts\.com|vitals\.vercel/.test(url)
            || (url.startsWith(BASE_URL) && new URL(req.url()).pathname.startsWith('/api/'));
        (isNoise ? report.ignoredRequests : report.failedRequests)
            .push({ url, method: req.method(), failure });
    });

    // Seed browser state before any app code runs: the Gemini key in the same
    // localStorage slot the app uses (its legacy-key migration namespaces it to
    // the active user on first read), plus the tour-completed flag.
    await context.addInitScript(([key]) => {
        window.localStorage.setItem('GEMINI_API_KEY', key);
        window.localStorage.setItem('synapse-tour-completed', 'true');
    }, [GEMINI_KEY || 'e2e-smoke-placeholder-key']);

    // Warm-up pass: on a cold dev server, Vite discovers + optimizes deps on
    // first load and then force-reloads the page ("optimized dependencies
    // changed"), which would wipe in-progress form state mid-step. Load once,
    // give the optimizer time to settle, and start the real steps fresh.
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.getByPlaceholder('What product shall we design?')
        .waitFor({ timeout: 60_000 }).catch(() => {});
    await settle(6000);

    const fillIdeaForm = async () => {
        await page.getByPlaceholder(/Project name/).fill(PROJECT_NAME);
        await page.getByPlaceholder('What product shall we design?').fill(IDEA_PROMPT);
    };

    // --- Smoke path (shared by both modes) ------------------------------------
    await step('home renders (signed in as Dev User)', async () => {
        await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
        await page.getByPlaceholder('What product shall we design?').waitFor({ timeout: 30_000 });
        await settle(1500);
        await shot(page, 'home');
    });

    await step('fill idea prompt + project name', async () => {
        await fillIdeaForm();
        await settle(400);
        await shot(page, 'idea-filled');
    });

    await step('start-mode dialog opens', async () => {
        // If a late dev-server reload wiped the form, refill before submitting
        // (the submit button's accessible name is 'Generate PRD' only when the
        // form is valid).
        for (let attempt = 0; attempt < 2; attempt++) {
            const text = await page.getByPlaceholder('What product shall we design?').inputValue();
            if (text !== IDEA_PROMPT) await fillIdeaForm();
            try {
                await page.getByRole('button', { name: 'Generate PRD' }).click({ timeout: 10_000 });
                break;
            } catch (err) {
                if (attempt === 1) throw err;
            }
        }
        await page.getByText('How would you like to start?').waitFor({ timeout: 10_000 });
        await settle(400);
        await shot(page, 'start-mode-choice');
    });

    if (MODE === 'smoke') {
        await step('dismiss dialog (smoke mode stops before generation)', async () => {
            await page.getByRole('button', { name: 'Cancel' }).click();
            await settle(400);
        });
    } else {
        // --- Live path ---------------------------------------------------------
        await step('start immediate generation ("Draft a working plan")', async () => {
            await page.getByRole('button', { name: /Draft a working plan/ }).click();
            await page.waitForURL(/\/p\//, { timeout: 15_000 });
            report.projectId = page.url().split('/p/')[1]?.split(/[/?#]/)[0] || null;
            console.log(`  project: ${report.projectId}`);
            await settle(2000);
            await shot(page, 'generation-started');
        });

        await step('PRD generation settles (live Gemini call)', async () => {
            const t0 = Date.now();
            let lastShotAt = t0;
            let result = { phase: null, error: null };
            for (;;) {
                result = await page.evaluate((projectId) => {
                    // Read the app's own persisted store. Keys are per-user
                    // namespaced (synapse-projects-storage::u:<id>), so scan.
                    for (let i = 0; i < localStorage.length; i++) {
                        const k = localStorage.key(i);
                        if (!k || !k.startsWith('synapse-projects-storage')) continue;
                        try {
                            const state = JSON.parse(localStorage.getItem(k) || '{}').state;
                            const spines = state?.spineVersions?.[projectId];
                            if (!spines?.length) continue;
                            const latest = spines[spines.length - 1];
                            return {
                                phase: latest.generationPhase ?? null,
                                error: latest.generationError?.message ?? null,
                                hasStructuredPRD: Boolean(latest.structuredPRD),
                                safetyStatus: latest.safetyReview?.status ?? null,
                            };
                        } catch { /* ignore malformed blobs */ }
                    }
                    return { phase: null, error: null };
                }, report.projectId);

                if (result.phase === 'complete') break;
                if (Date.now() - t0 > GENERATION_TIMEOUT_MS) {
                    await shot(page, 'generation-TIMEOUT');
                    throw new Error(`generation did not settle within ${GENERATION_TIMEOUT_MS / 60000} min`);
                }
                if (Date.now() - lastShotAt >= PROGRESS_SHOT_EVERY_MS) {
                    lastShotAt = Date.now();
                    await shot(page, `generating-${Math.round((Date.now() - t0) / 1000)}s`, { fullPage: false });
                }
                await settle(5000);
            }
            report.generation = { ms: Date.now() - t0, ...result };
            console.log(`  settled in ${Math.round((Date.now() - t0) / 1000)}s`, result);
            if (result.error) throw new Error(`generation settled with error: ${result.error}`);
        });

        await step('PRD Overview view', async () => {
            await settle(2500);
            await shot(page, 'prd-overview');
        });

        for (const view of ['features', 'decisions']) {
            await step(`PRD ${view} view`, async () => {
                await page.locator(`#prd-tab-${view}`).click({ timeout: 5000 });
                await settle(1500);
                await shot(page, `prd-${view}`);
            }, { optional: true });
        }

        // The pipeline-stage nav (PipelineStageBar: Plan | Challenge |
        // Explore/Build | History). Each button's accessible name is
        // "<Label>: <description>", so match on the label prefix. Artifacts
        // aren't generated (large token spend), so the outputs stage shows the
        // pre-generation view; its label is Explore before readiness, Build
        // after.
        const stageBar = page.getByRole('navigation', { name: 'Planning progression' });
        for (const [slug, namePattern, wait] of [
            ['outputs', /^(Explore|Build):/, 2500],
            ['history', /^History:/, 2000],
        ]) {
            await step(`${slug} stage`, async () => {
                await stageBar.getByRole('button', { name: namePattern }).click({ timeout: 5000 });
                await settle(wait);
                await shot(page, `${slug}-stage`);
            }, { optional: true });
        }

        await step('mobile viewport pass (PRD)', async () => {
            // Resize in place rather than reloading the deep link: a reload
            // races the per-user store rehydration and can bounce to
            // "Project not found" (see docs/E2E_LIVE_TESTING.md).
            await page.getByRole('navigation', { name: 'Planning progression' })
                .getByRole('button', { name: /^Plan:/ })
                .click({ timeout: 5000 }).catch(() => {});
            await page.setViewportSize({ width: 390, height: 844 });
            await settle(2500);
            await shot(page, 'prd-mobile');
        }, { optional: true });
    }

    await context.close();
} catch (err) {
    console.error(`\nFatal: ${redact(err?.stack || err)}`);
    exitCode = 1;
} finally {
    if (browser) await browser.close().catch(() => {});
    devServer.kill();
}

// ---------------------------------------------------------------------------
// Write report + summary
// ---------------------------------------------------------------------------
report.finishedAt = new Date().toISOString();
report.durationMs = Date.now() - startedAt.getTime();
const failed = report.steps.filter((s) => s.status === 'failed');
if (failed.length) exitCode = 1;

writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));

console.log('\n================ E2E RUN SUMMARY ================');
for (const s of report.steps) {
    const icon = s.status === 'ok' ? '✓' : s.status === 'skipped' ? '⏭' : '✗';
    console.log(`${icon} ${s.name} (${Math.round(s.ms / 1000)}s)${s.error ? ` — ${s.error}` : ''}`);
}
console.log(`\nConsole errors: ${report.consoleErrors.length}, warnings: ${report.consoleWarnings.length}, ` +
    `page errors: ${report.pageErrors.length}, failed requests: ${report.failedRequests.length}, ` +
    `HTTP >=400: ${report.httpErrors.length} (+${report.expectedLocalApiErrors.length} expected local /api 404s)`);
console.log(`Screenshots + report.json in: ${outDir}`);
console.log('Review the PNGs for visual gaps (agents: Read each screenshot file), ' +
    'and report.json for console/network issues.');
process.exit(exitCode);
