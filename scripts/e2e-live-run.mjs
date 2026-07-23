// Live end-to-end run: boot the app locally, create a REAL project from a
// plain-language idea, wait for actual Gemini PRD generation to settle, then
// walk every stage, artifact, and sub-tab and write full-height screenshots +
// a machine-readable report. Built so a human — or a coding agent that can
// read images (e.g. Claude Code) — can visually assess the product without
// hand-driving the UI.
//
// Run with:
//   npm run e2e            # live run (needs a Gemini key, see below)
//   npm run e2e:smoke      # no-LLM smoke walk (no key needed)
//   npm run e2e -- --prompt="A recipe box app for families" --name="Recipe Box"
//   npm run e2e -- --out=./e2e-results/my-run --timeout-min=15
//   npm run e2e -- --viewport=both --views=screens,implementation-plan
//   npm run e2e -- --state=e2e-results/run-<stamp>/state.json --views=prd
//
// MODES
//   --live   Full flow: home → idea → "Draft a working plan" → real PRD
//            generation → commit through the readiness gate → asset bundle →
//            full view/tab inventory walk. Requires a Gemini API key in the
//            SYNAPSE_E2E_GEMINI_KEY or GEMINI_API_KEY env var. The key is
//            seeded into the browser's localStorage only (same place the app
//            itself stores it) and is never written to the report or logs.
//   --smoke  Everything up to (but not including) generation, with a dummy
//            key: home renders, idea form fills, start-mode dialog opens.
//            Verifies the harness + app boot without spending tokens.
//   --state=<file>  Replay mode: rehydrate a previous live run's exported
//            state.json (written into every live run's output dir), skip all
//            generation, and jump straight to the view inventory walk. Zero
//            LLM spend — the "screenshot an existing project" tier. Combine
//            with --views/--viewport for targeted subsets. Note: mockup
//            images live in IndexedDB, not localStorage, so they are not in
//            the dump (they never render locally anyway — see below).
//   Default: --live when a key env var is present, otherwise --smoke.
//
// SCENARIO FLAGS
//   --viewport=desktop|mobile|both   Which viewport(s) the inventory walk
//            runs at (default desktop, 1440x900; mobile is 390x844 and uses
//            the artifact-drawer navigation). Generation always runs desktop.
//   --views=<csv>   Restrict the inventory walk to these slugs:
//            prd, challenge, design-system, user-flows, screens, data-model,
//            implementation-plan, dependency-graph, history.
//   --interactions  (live mode) Additionally exercise the interactive loop
//            with canned inputs: select PRD text → edit dialog → branch
//            conversation → consolidate into the spine, and answer one
//            decision in the Decision Center. Costs ~2 extra Gemini calls;
//            the consolidate *commit* is best-effort (its exact-substring
//            anchor replace can legitimately fail on LLM formatting drift —
//            the screenshots of each state are the point, not the commit).
//
// FULL-HEIGHT SCREENSHOTS
//   The app shell is h-screen with per-stage internal scroll panes
//   (ProjectWorkspace/ArtifactWorkspace overflow-y-auto), so Playwright's
//   fullPage capture alone stops at the viewport. fullShot() measures the
//   dominant internal scroller and temporarily grows the browser viewport by
//   its overflow (everything in the app — including modals — is sized
//   relative to the viewport, so the layout expands naturally), captures,
//   then restores. Known limitation: inner widgets with a fixed non-vh
//   max-height still clip.
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
//   NN-<step>.png        full-height screenshots in step order (mobile-pass
//                        shots carry a -mobile suffix)
//   state.json           localStorage dump of the generated project (live
//                        runs only) — feed it back via --state=…
//   report.json          steps (ok/failed/skipped + timing), console errors &
//                        warnings, uncaught page errors, failed network
//                        requests, generation outcome
//
// Requires the Chromium binary (pre-installed in CI/web envs via
// PLAYWRIGHT_BROWSERS_PATH; locally: `npx playwright install chromium`).

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, isAbsolute, resolve } from 'node:path';
import { existsSync, readdirSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

// ---------------------------------------------------------------------------
// Args & config
// ---------------------------------------------------------------------------
function parseArgs(argv) {
    const out = {
        mode: undefined, prompt: undefined, name: undefined,
        out: undefined, timeoutMin: undefined, relay: undefined, port: undefined,
        assets: undefined, viewport: undefined, views: undefined,
        state: undefined, interactions: false,
    };
    for (const a of argv) {
        if (a === '--live') out.mode = 'live';
        else if (a === '--smoke') out.mode = 'smoke';
        else if (a === '--fetch-relay') out.relay = true;
        else if (a === '--no-relay') out.relay = false;
        else if (a === '--skip-assets') out.assets = false;
        else if (a === '--assets') out.assets = true;
        else if (a === '--interactions') out.interactions = true;
        else if (a.startsWith('--prompt=')) out.prompt = a.slice('--prompt='.length);
        else if (a.startsWith('--name=')) out.name = a.slice('--name='.length);
        else if (a.startsWith('--out=')) out.out = a.slice('--out='.length);
        else if (a.startsWith('--timeout-min=')) out.timeoutMin = Number(a.slice('--timeout-min='.length));
        else if (a.startsWith('--port=')) out.port = Number(a.slice('--port='.length));
        else if (a.startsWith('--viewport=')) out.viewport = a.slice('--viewport='.length);
        else if (a.startsWith('--views=')) out.views = a.slice('--views='.length).split(',').map((s) => s.trim()).filter(Boolean);
        else if (a.startsWith('--state=')) out.state = a.slice('--state='.length);
    }
    return out;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const args = parseArgs(process.argv.slice(2));

const GEMINI_KEY = process.env.SYNAPSE_E2E_GEMINI_KEY || process.env.GEMINI_API_KEY || '';
const STATE_FILE = args.state
    ? (isAbsolute(args.state) ? args.state : resolve(repoRoot, args.state))
    : null;
const MODE = STATE_FILE ? 'state' : (args.mode ?? (GEMINI_KEY ? 'live' : 'smoke'));
if (MODE === 'live' && !GEMINI_KEY) {
    console.error(
        'Live mode needs a Gemini API key in SYNAPSE_E2E_GEMINI_KEY (or GEMINI_API_KEY).\n' +
        'Use a dedicated low-quota test key, not a production key. Or run: npm run e2e:smoke',
    );
    process.exit(1);
}
if (MODE === 'state' && !existsSync(STATE_FILE)) {
    console.error(`--state file not found: ${STATE_FILE}`);
    process.exit(1);
}

const VIEWPORT_ARG = args.viewport ?? 'desktop';
if (!['desktop', 'mobile', 'both'].includes(VIEWPORT_ARG)) {
    console.error(`--viewport must be desktop, mobile, or both (got: ${VIEWPORT_ARG})`);
    process.exit(1);
}
const DESKTOP_VIEWPORT = { name: 'desktop', width: 1440, height: 900, mobile: false };
const MOBILE_VIEWPORT = { name: 'mobile', width: 390, height: 844, mobile: true };
const RUN_VIEWPORTS = VIEWPORT_ARG === 'both'
    ? [DESKTOP_VIEWPORT, MOBILE_VIEWPORT]
    : VIEWPORT_ARG === 'mobile' ? [MOBILE_VIEWPORT] : [DESKTOP_VIEWPORT];

const PORT = args.port || 5181; // dedicated port; 5173 dev / 5179 tour / 5180 demo already taken
const BASE_URL = `http://localhost:${PORT}`;
const GENERATION_TIMEOUT_MS = (args.timeoutMin || 12) * 60_000;
const PROGRESS_SHOT_EVERY_MS = 45_000;
// Downstream asset generation (the 7-core artifact bundle + mockup spec) is a
// much larger token spend than the PRD alone, so it's opt-outable. Default: on
// in live mode. It requires committing the plan through the readiness gate.
const GENERATE_ASSETS = args.assets ?? true;
const INTERACTIONS = args.interactions && MODE === 'live';
// The 5 *visible* core subtypes a fresh bundle produces (component_inventory is
// hidden but generates; prompt_pack is retired and does not). Used for settle.
const VISIBLE_CORE_SUBTYPES = ['design_system', 'user_flows', 'screen_inventory', 'data_model', 'implementation_plan'];

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

// The persist key the app scopes to the dev-skip-auth user. On a cold load the
// store's FIRST hydration reads the un-namespaced base key (the dev-user
// namespace only applies after an effect runs — see docs/E2E_LIVE_TESTING.md),
// so --state seeds the project blob under BOTH names to make the first
// hydration already correct and keep /p/:id deep links from bouncing to
// "Project not found".
const PROJECTS_KEY_BASE = 'synapse-projects-storage';
const PROJECTS_KEY_DEV_USER = 'synapse-projects-storage::u:dev-user';

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
    ideaPrompt: MODE === 'state' ? null : IDEA_PROMPT,
    projectName: MODE === 'state' ? null : PROJECT_NAME,
    projectId: null,
    viewport: VIEWPORT_ARG,
    views: args.views ?? null,
    stateFile: STATE_FILE,
    interactions: INTERACTIONS,
    generation: null, // { ms, phase, error }
    assets: null,     // { ms, readySubtypes: [], settleReason, note } — asset bundle
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

// Full-height capture. The app never scrolls the document (h-screen shell +
// per-stage overflow-y-auto panes), so plain fullPage stops at the viewport.
// Measure the dominant internal scroller (widest/deepest overflow), reset its
// scroll position, temporarily grow the viewport by the overflow delta (the
// whole layout — including modals — is viewport-relative, so it expands
// naturally), capture, then restore. Falls back to a plain fullPage shot when
// nothing overflows. Known limitation: inner widgets with a fixed non-vh
// max-height still clip.
async function fullShot(page, slug, { cap = 8000, buffer = 80 } = {}) {
    const original = page.viewportSize() ?? { width: 1440, height: 900 };
    let delta = 0;
    try {
        delta = await page.evaluate(() => {
            const vw = window.innerWidth;
            const chosen = [];
            for (const el of document.querySelectorAll('*')) {
                const cs = getComputedStyle(el);
                if (cs.overflowY !== 'auto' && cs.overflowY !== 'scroll') continue;
                const d = el.scrollHeight - el.clientHeight;
                if (d <= 40) continue;
                // Skip narrow rails/lists (the branches right-rail, dropdowns) —
                // the "page pane" for a view is at least half the viewport wide.
                if (el.clientWidth < vw * 0.5) continue;
                // One candidate per independent pane: skip scrollers nested
                // inside an already-collected one (code blocks, comment lists).
                if (chosen.some((c) => c.el.contains(el))) continue;
                chosen.push({ el, d });
            }
            if (!chosen.length) return 0;
            chosen.sort((a, b) => b.d - a.d);
            // Growing the viewport doesn't reset an existing scroll offset, so
            // normalize to the top before measuring the capture.
            for (const c of chosen) c.el.scrollTop = 0;
            return chosen[0].d;
        });
    } catch { delta = 0; }
    if (delta > 0) {
        await page.setViewportSize({
            width: original.width,
            height: Math.min(original.height + delta + buffer, cap),
        });
        // Two rAFs let the flex/vh relayout settle before painting.
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => {});
        await settle(200);
    }
    const file = await shot(page, slug, { fullPage: true });
    if (delta > 0) {
        await page.setViewportSize(original);
        await settle(100);
    }
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

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Never leak the key into artifacts.
const redact = (s) => (GEMINI_KEY ? String(s).replaceAll(GEMINI_KEY, '<gemini-key>') : String(s));

// ---------------------------------------------------------------------------
// Navigation helpers (see the Maintenance list in docs/E2E_LIVE_TESTING.md —
// selector drift here should be fixed alongside the UI change that caused it)
//
// The old 4-stage PipelineStageBar ("Plan:/Challenge:/Explore:/History:") was
// replaced by the 6-step JourneyRail (nav[aria-label="Product journey"]).
// Journey buttons' accessible names concatenate "<n> · <status> <label>
// <description>", and some labels collide with description words ("Review"
// appears in Finalize's description), so steps are matched by a unique
// snippet of their sr-only description (source: src/lib/journeyPresentation.ts).
// ---------------------------------------------------------------------------
const JOURNEY_STEP_PATTERNS = {
    define: /Describe the product/,
    refine: /challenge its reasoning/,
    finalize: /record the plan checkpoint/,
    generate: /implementation outputs/,
    review: /Inspect generated outputs/,
    build: /Export the reviewed handoff/,
};

async function gotoJourneyStep(page, step) {
    await page.getByRole('navigation', { name: 'Product journey' })
        .getByRole('button', { name: JOURNEY_STEP_PATTERNS[step] })
        .click({ timeout: 6000 });
    await settle(800);
}

// Map the harness's historical stage vocabulary onto the journey rail:
//   prd → Define (always lands on the Plan surface)
//   review (Challenge) → Define, then PlanningStateBar's "Challenge this plan"
//   workspace → Review (enabled once outputs exist; the walk runs post-assets)
// History is a slide-over panel now — see the history step below.
async function gotoStage(page, stage) {
    if (stage === 'prd') return gotoJourneyStep(page, 'define');
    if (stage === 'review') {
        await gotoJourneyStep(page, 'define');
        await page.getByRole('button', { name: 'Challenge this plan' }).click({ timeout: 6000 });
        await settle(800);
        return;
    }
    if (stage === 'workspace') return gotoJourneyStep(page, 'review');
    throw new Error(`unknown stage: ${stage}`);
}

// Open an entry of the top-bar "More actions" overflow menu (portaled).
// Scoped to the top-bar banner landmark: FlowSummaryCard renders its own
// "More actions" button, so an unscoped lookup is a strict-mode violation
// whenever the User Flows view is on screen.
async function openOverflowMenuItem(page, label) {
    await page.getByRole('banner').getByRole('button', { name: 'More actions' }).click({ timeout: 6000 });
    await settle(300);
    await page.getByRole('menu').getByRole('button', { name: label }).click({ timeout: 6000 });
    await settle(800);
}

// Select an artifact sidebar row; on mobile the sidebar is a slide-in drawer
// behind the "Open artifact list" hamburger (it auto-closes on selection).
async function selectArtifactRow(page, isMobile, title) {
    if (isMobile) {
        const hamburger = page.getByRole('button', { name: 'Open artifact list' });
        if (await hamburger.isVisible().catch(() => false)) {
            await hamburger.click();
            await settle(350);
        }
    }
    await page.locator('nav[aria-label="Artifacts"] button')
        .filter({ hasText: title }).first().click({ timeout: 6000 });
    await settle(400);
}

// Click an in-artifact tab scoped to its own nav landmark.
async function selectTab(page, navLabel, label) {
    const nav = page.locator(`nav[aria-label="${navLabel}"]`);
    await nav.waitFor({ state: 'visible', timeout: 8000 });
    await nav.getByRole('button', { name: new RegExp(`^${escapeRegExp(label)}`) }).first().click();
    await settle(700);
}

// ---------------------------------------------------------------------------
// View inventory — the full walk of stages, artifacts, and sub-tabs.
// `--views=<csv>` filters by slug; every leaf is an optional step so a missed
// selector (or data a --skip-assets/--state run never generated) degrades to
// `skipped`, never a dead run.
// ---------------------------------------------------------------------------
const VIEW_SLUGS = [
    'prd', 'challenge', 'design-system', 'user-flows', 'screens',
    'data-model', 'implementation-plan', 'dependency-graph', 'history',
];
const IMPLEMENTATION_PLAN_TABS = [
    // Source of truth: ConsolidatedPlanView.tsx section nav labels.
    { slug: 'build-brief', label: 'Build Brief' },
    { slug: 'roadmap', label: 'Roadmap' },
    { slug: 'prompts', label: 'Prompts' },
    { slug: 'validation', label: 'Validation' },
    { slug: 'coverage', label: 'Coverage' },
];
const SCREEN_DETAIL_TABS = ['Overview', 'Flow', 'Mockups'];
const MAX_FLOWS_CAPTURED = 3;

async function captureViews(page, viewport, wantedViews) {
    const suffix = viewport.mobile ? '-mobile' : '';
    const want = (slug) => !wantedViews || wantedViews.includes(slug);
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await settle(1200);

    if (want('prd')) {
        await step(`PRD views${suffix}`, async () => {
            await gotoStage(page, 'prd');
            for (const view of ['overview', 'features']) {
                await page.locator(`#prd-tab-${view}`).click({ timeout: 5000 });
                await settle(1200);
                await fullShot(page, `prd-${view}${suffix}`);
            }
        }, { optional: true });
    }

    if (want('challenge')) {
        await step(`Challenge stage (findings + history)${suffix}`, async () => {
            await gotoStage(page, 'review');
            await fullShot(page, `challenge-workspace${suffix}`);
            for (const [label, slug] of [['Review findings', 'review-findings'], ['Review history', 'review-history']]) {
                await page.getByRole('button', { name: label }).click({ timeout: 4000 });
                await settle(1000);
                await fullShot(page, `challenge-${slug}${suffix}`);
            }
        }, { optional: true });

        // The Decision Center is a slide-over dialog now (overflow menu entry),
        // not a Challenge-stage tab.
        await step(`Decision Center slide-over${suffix}`, async () => {
            await openOverflowMenuItem(page, 'Decision Center');
            await page.getByRole('dialog', { name: 'Decision Center' }).waitFor({ timeout: 8000 });
            await settle(800);
            await fullShot(page, `challenge-decision-center${suffix}`);
            const firstRecord = page.locator('[aria-label="Decision queue"] button:not([role="tab"])').first();
            if (await firstRecord.isVisible().catch(() => false)) {
                await firstRecord.click();
                await settle(800);
                await fullShot(page, `challenge-decision-detail${suffix}`);
            }
            await page.getByRole('button', { name: 'Close Decision Center' }).click({ timeout: 4000 });
            await settle(400);
        }, { optional: true });
    }

    // --- Build/Explore workspace artifacts ---------------------------------
    const anyArtifact = ['design-system', 'user-flows', 'screens', 'data-model', 'implementation-plan', 'dependency-graph']
        .some((slug) => want(slug));
    if (anyArtifact) {
        const workspaceReachable = await step(`open workspace stage${suffix}`, async () => {
            await gotoStage(page, 'workspace');
            await page.locator('nav[aria-label="Artifacts"]').waitFor({ state: 'attached', timeout: 8000 });
        }, { optional: true });

        if (workspaceReachable) {
            if (want('design-system')) {
                await step(`artifact: Design System${suffix}`, async () => {
                    await selectArtifactRow(page, viewport.mobile, 'Design System');
                    await settle(2200);
                    await fullShot(page, `artifact-design-system${suffix}`);
                }, { optional: true });
            }

            if (want('user-flows')) {
                await step(`artifact: User Flows${suffix}`, async () => {
                    await selectArtifactRow(page, viewport.mobile, 'User Flows');
                    await settle(1800);
                    await fullShot(page, `artifact-user-flows${suffix}`);
                    // Per-flow walk: the flow list is a selection nav, not a
                    // tablist ("Flow navigation" is the stable landmark).
                    const flowNav = page.locator('[aria-label="Flow navigation"]');
                    if (await flowNav.isVisible().catch(() => false)) {
                        const flows = flowNav.getByRole('button', { name: /^Flow \d+:/ });
                        const count = Math.min(await flows.count(), MAX_FLOWS_CAPTURED);
                        for (let i = 1; i < count; i++) { // flow 0 is the default view above
                            await flows.nth(i).click({ timeout: 4000 });
                            await settle(1200);
                            await fullShot(page, `artifact-user-flows-flow-${i + 1}${suffix}`);
                        }
                    }
                }, { optional: true });
            }

            if (want('screens')) {
                await step(`artifact: Screens (list + detail tabs)${suffix}`, async () => {
                    await selectArtifactRow(page, viewport.mobile, 'Screens');
                    await settle(2800);
                    await fullShot(page, `artifact-screens-list${suffix}`);
                    // Open the first screen card (cards are buttons wrapping an
                    // <h4> screen name) and walk the detail tabs.
                    const firstCard = page.locator('main button:has(h4)').first();
                    if (await firstCard.isVisible().catch(() => false)) {
                        await firstCard.click();
                        await settle(1500);
                        const tablist = page.locator('[aria-label="Screen detail sections"]');
                        for (const tab of SCREEN_DETAIL_TABS) {
                            await tablist.getByRole('tab', { name: tab }).click({ timeout: 4000 });
                            await settle(1200);
                            await fullShot(page, `artifact-screens-detail-${tab.toLowerCase()}${suffix}`);
                        }
                        await page.getByRole('button', { name: 'All screens' }).click({ timeout: 4000 }).catch(() => {});
                        await settle(500);
                    }
                }, { optional: true });
            }

            if (want('data-model')) {
                await step(`artifact: Data Model${suffix}`, async () => {
                    await selectArtifactRow(page, viewport.mobile, 'Data Model');
                    await settle(1800);
                    await fullShot(page, `artifact-data-model${suffix}`);
                }, { optional: true });
            }

            if (want('implementation-plan')) {
                await step(`artifact: Implementation Plan (all sections)${suffix}`, async () => {
                    await selectArtifactRow(page, viewport.mobile, 'Implementation Plan');
                    await settle(2000);
                    await fullShot(page, `artifact-implementation-plan${suffix}`);
                    for (const tab of IMPLEMENTATION_PLAN_TABS) {
                        await selectTab(page, 'Implementation plan sections', tab.label);
                        await fullShot(page, `artifact-implementation-plan-${tab.slug}${suffix}`);
                    }
                }, { optional: true });
            }

            if (want('dependency-graph')) {
                await step(`artifact: Dependency Graph${suffix}`, async () => {
                    await selectArtifactRow(page, viewport.mobile, 'Dependency Graph');
                    await settle(1800);
                    await fullShot(page, `artifact-dependency-graph${suffix}`);
                }, { optional: true });
            }
        }
    }

    if (want('history')) {
        // Project history is a slide-over panel now (overflow menu entry),
        // not a pipeline stage.
        await step(`history panel${suffix}`, async () => {
            await openOverflowMenuItem(page, 'Project History');
            await page.getByRole('dialog', { name: 'Project history' }).waitFor({ timeout: 8000 });
            await settle(1200);
            await fullShot(page, `history-panel${suffix}`);
            await page.getByRole('button', { name: 'Close project history' }).click({ timeout: 4000 });
            await settle(400);
        }, { optional: true });
    }
}

// ---------------------------------------------------------------------------
// --interactions: the canned interactive loop (live mode only, opt-in).
// Costs ~2 extra Gemini calls (branch reply + consolidation patch).
// ---------------------------------------------------------------------------
async function runPrdEditInteraction(page) {
    await step('interaction: select PRD text → edit dialog', async () => {
        await gotoStage(page, 'prd');
        await page.locator('#prd-tab-overview').click({ timeout: 5000 }).catch(() => {});
        await settle(1200);
        // Programmatic selection: the selection popover listens to the native
        // selectionchange event and only requires a non-collapsed selection
        // inside the PRD content panel — no pixel-accurate mouse drag needed.
        const selectedText = await page.evaluate(() => {
            const panel = document.querySelector('[id^="prd-panel-"]');
            if (!panel) return null;
            for (const p of panel.querySelectorAll('p, li')) {
                const text = p.textContent?.trim() ?? '';
                if (text.length < 60) continue;
                const node = [...p.childNodes].find(
                    (n) => n.nodeType === Node.TEXT_NODE && (n.textContent?.trim().length ?? 0) > 40,
                );
                if (!node) continue;
                p.scrollIntoView({ block: 'center' });
                const range = document.createRange();
                range.setStart(node, 0);
                range.setEnd(node, Math.min(node.textContent.length, 80));
                const sel = window.getSelection();
                sel.removeAllRanges();
                sel.addRange(range);
                return sel.toString();
            }
            return null;
        });
        if (!selectedText) throw new Error('no selectable PRD paragraph found');
        const dialog = page.locator('[role="dialog"][aria-label="PRD edit actions"]');
        await dialog.waitFor({ timeout: 8000 });
        await fullShot(page, 'interaction-edit-dialog');
        await dialog.getByPlaceholder('How should this change?').fill(
            'Clarify this so a first-time reader immediately understands the user benefit.',
        );
        await dialog.getByRole('button', { name: 'Branch' }).click();
    }, { optional: true });

    await step('interaction: branch conversation (live Gemini call)', async () => {
        // The "Consolidate to Document" bar appears once the AI reply lands.
        await page.getByRole('button', { name: 'Consolidate to Document' }).waitFor({ timeout: 180_000 });
        await settle(800);
        await fullShot(page, 'interaction-branch-conversation');
    }, { optional: true });

    await step('interaction: consolidate branch into PRD (live Gemini call)', async () => {
        await page.getByRole('button', { name: 'Consolidate to Document' }).click({ timeout: 5000 });
        await settle(800);
        await fullShot(page, 'interaction-consolidation-scope');
        await page.getByRole('button', { name: /^Generate (Local|Global) Patch/ }).click({ timeout: 5000 });
        await page.getByRole('button', { name: 'Commit to New Spine' }).waitFor({ timeout: 180_000 });
        await settle(600);
        await fullShot(page, 'interaction-consolidation-preview');
        // Best-effort: the commit's exact-substring anchor replace can
        // legitimately fail on LLM formatting drift — the error banner is
        // itself useful visual coverage, so capture the after-state either way.
        await page.getByRole('button', { name: 'Commit to New Spine' }).click();
        await settle(3000);
        await fullShot(page, 'interaction-after-consolidation');
        // Dismiss the modal if the commit failed and it's still open.
        const stillOpen = page.getByRole('button', { name: 'Commit to New Spine' });
        if (await stillOpen.isVisible().catch(() => false)) {
            await page.keyboard.press('Escape').catch(() => {});
            await settle(400);
        }
    }, { optional: true });
}

async function runDecisionInteraction(page) {
    await step('interaction: answer a decision', async () => {
        await openOverflowMenuItem(page, 'Decision Center');
        await page.getByRole('dialog', { name: 'Decision Center' }).waitFor({ timeout: 8000 });
        await settle(1000);
        const first = page.locator('[aria-label="Decision queue"] button:not([role="tab"])').first();
        if (!(await first.isVisible().catch(() => false))) throw new Error('no decision records to answer');
        await first.click();
        await settle(800);
        await fullShot(page, 'interaction-decision-before');
        // The available control depends on the record shape — try in order:
        // assumption confirm → option radiogroup + save → defer.
        const yes = page.getByRole('button', { name: "Yes, that's right" });
        const save = page.getByRole('button', { name: 'Save decision' });
        const defer = page.getByRole('button', { name: 'Defer' });
        if (await yes.isVisible().catch(() => false)) {
            await yes.click();
        } else if (await save.isVisible().catch(() => false)) {
            const radio = page.getByRole('radio').first();
            if (await radio.isVisible().catch(() => false)) await radio.click().catch(() => {});
            await save.click();
        } else if (await defer.isVisible().catch(() => false)) {
            await defer.click();
        } else {
            throw new Error('no answer control found for the first decision record');
        }
        await settle(1500);
        await fullShot(page, 'interaction-decision-after');
    }, { optional: true });
}

// ---------------------------------------------------------------------------
// State export / replay
// ---------------------------------------------------------------------------
async function exportState(page) {
    await step('export project state (state.json)', async () => {
        // The store's localStorage writer is debounced at 500ms with no
        // external flush — wait past the window so the dump isn't stale.
        await settle(700);
        const keys = await page.evaluate((prefix) => {
            const out = {};
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k) continue;
                if (k.startsWith(prefix) || k === 'synapse-tour-completed') out[k] = localStorage.getItem(k);
            }
            return out;
        }, PROJECTS_KEY_BASE);
        writeFileSync(
            join(outDir, 'state.json'),
            JSON.stringify({ projectId: report.projectId, exportedAt: new Date().toISOString(), keys }, null, 2),
        );
        console.log(`  💾 state.json (${Object.keys(keys).length} keys) — replay with --state=`);
    }, { optional: true });
}

function loadStateBundle() {
    const bundle = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    if (!bundle?.projectId || !bundle?.keys) {
        throw new Error(`--state file is not a state.json export (missing projectId/keys): ${STATE_FILE}`);
    }
    // The project blob to mirror under both storage names (see PROJECTS_KEY_*
    // comment above): prefer the dev-user namespaced key, else the largest
    // projects blob present.
    const storageKeys = Object.keys(bundle.keys).filter((k) => k.startsWith(PROJECTS_KEY_BASE));
    const blob = bundle.keys[PROJECTS_KEY_DEV_USER]
        ?? storageKeys.map((k) => bundle.keys[k]).sort((a, b) => (b?.length ?? 0) - (a?.length ?? 0))[0];
    if (!blob) throw new Error(`--state file contains no ${PROJECTS_KEY_BASE}* keys: ${STATE_FILE}`);
    return { ...bundle, blob };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
console.log(`Mode: ${MODE}${USE_RELAY ? ' (fetch relay on)' : ''} | viewport: ${VIEWPORT_ARG}` +
    `${args.views ? ` | views: ${args.views.join(',')}` : ''}${INTERACTIONS ? ' | interactions: on' : ''}`);
console.log(`Output: ${outDir}`);

const stateBundle = MODE === 'state' ? loadStateBundle() : null;

const devServer = startDevServer();
let browser;
let exitCode = 0;

try {
    await waitForServer(BASE_URL);

    browser = await chromium.launch({ executablePath: findChromiumExecutable() });
    const context = await browser.newContext({
        viewport: { width: DESKTOP_VIEWPORT.width, height: DESKTOP_VIEWPORT.height },
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
    // the active user on first read), the tour-completed flag, and — in state
    // mode — the replayed project blob under BOTH storage names (see the
    // PROJECTS_KEY_* comment for why both).
    await context.addInitScript(([key, seed]) => {
        window.localStorage.setItem('GEMINI_API_KEY', key);
        window.localStorage.setItem('synapse-tour-completed', 'true');
        if (seed) {
            for (const [k, v] of Object.entries(seed.keys)) {
                if (typeof v === 'string') window.localStorage.setItem(k, v);
            }
            window.localStorage.setItem(seed.baseKey, seed.blob);
            window.localStorage.setItem(seed.devUserKey, seed.blob);
        }
    }, [
        GEMINI_KEY || 'e2e-placeholder-key',
        stateBundle
            ? { keys: stateBundle.keys, blob: stateBundle.blob, baseKey: PROJECTS_KEY_BASE, devUserKey: PROJECTS_KEY_DEV_USER }
            : null,
    ]);

    if (MODE === 'state') {
        // --- Replay path: no generation, straight to the inventory walk ------
        report.projectId = stateBundle.projectId;
        await step('open replayed project from state dump', async () => {
            await page.goto(`${BASE_URL}/p/${stateBundle.projectId}`, { waitUntil: 'domcontentloaded' });
            try {
                await page.getByRole('navigation', { name: 'Product journey' })
                    .waitFor({ timeout: 30_000 });
            } catch {
                // The both-keys seeding contract is supposed to make the first
                // hydration correct — a bounce here is a regression signal, not
                // something to silently retry (see docs/E2E_LIVE_TESTING.md).
                throw new Error(
                    'project did not load from the state dump (possible "Project not found" ' +
                    'bounce — the storage-key seeding contract may have regressed)',
                );
            }
            await settle(2000);
        });

        for (const viewport of RUN_VIEWPORTS) {
            await captureViews(page, viewport, args.views);
        }
    } else {
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

        // --- Smoke path (shared by both modes) --------------------------------
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
            // --- Live path ------------------------------------------------------
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

            // On current builds the visual-direction picker renders INLINE on
            // the Plan stage as soon as the working plan drafts (covering the
            // PRD) — capture it and confirm the recommended preset so the PRD
            // becomes visible. Older builds only show the picker as a modal
            // during the commit flow (still handled below), so this is a
            // guarded no-op there.
            await step('design preset (inline picker after draft)', async () => {
                await settle(2500);
                const picker = page.getByText('Choose your visual direction');
                if (!(await picker.isVisible().catch(() => false))) {
                    throw new Error('inline preset picker not shown (older commit-flow-modal build)');
                }
                await fullShot(page, 'design-preset-choice');
                await page.getByRole('button', { name: /^Continue with/ }).click({ timeout: 6000 });
                await settle(1500);
            }, { optional: true });

            await step('PRD generated (first render)', async () => {
                await settle(1500);
                await fullShot(page, 'prd-generated');
            });

            // Canned PRD-edit loop BEFORE committing, so it exercises the same
            // working-plan editing surface a user sees first.
            if (INTERACTIONS) await runPrdEditInteraction(page);

            // --- Downstream asset generation -------------------------------------
            // Committing a plan and generating its build assets (the core-artifact
            // bundle + mockup spec). This is the expensive tail; --skip-assets stops
            // after the PRD. The path: top-bar "Review readiness" → ReadinessCheckpoint
            // (Commit plan, or Proceed-with-accepted-risk for an exploring-phase
            // working plan) → FinalizationSuccessModal → DesignSystemPresetChoice →
            // artifactJobController.startAll runs the bundle.
            const finalizeModalButton = () => page
                .locator('[aria-labelledby="finalize-success-title"]')
                .getByRole('button', { name: /Generate build foundation|Explore outputs/ });
            let assetsTriggered = false;
            if (GENERATE_ASSETS) {
                await step('commit plan (readiness checkpoint)', async () => {
                    await page.getByRole('button', { name: 'Review readiness' }).click({ timeout: 8000 });
                    await settle(1200);
                    await fullShot(page, 'readiness-checkpoint');
                    // "Finalize plan" appears only when the plan is ready-to-build; an
                    // immediately-generated working plan is in the exploring phase, so
                    // it takes the "Finalize with accepted risk" override (reveal the
                    // override section, then rationale + confirm).
                    const commitReady = page.getByRole('button', { name: 'Finalize plan' });
                    if (await commitReady.isVisible().catch(() => false)) {
                        await commitReady.click();
                    } else {
                        await page.getByRole('button', { name: 'Finalize with accepted risk' }).click({ timeout: 6000 });
                        await settle(500);
                        await page.locator('#readiness-rationale').fill(
                            'Automated E2E run: committing to exercise the full downstream asset-generation ' +
                            'flow for visual assessment. Remaining open items are acceptable for this test build.',
                        );
                        await fullShot(page, 'readiness-override');
                        await page.getByRole('button', { name: /^Finalize with \d+ accepted blocker/ }).click({ timeout: 6000 });
                    }
                    // Scope to the finalize dialog: once the plan is committed, the
                    // top-bar green pill ALSO reads "Explore outputs", so an unscoped
                    // match is a strict-mode violation.
                    await finalizeModalButton().waitFor({ timeout: 12_000 });
                    await settle(500);
                    await fullShot(page, 'finalize-success');
                }, { optional: true });

                await step('trigger asset generation ("Generate build foundation")', async () => {
                    await finalizeModalButton().click({ timeout: 8000 });
                    // The one-time visual-direction picker gates the first bundle. Note
                    // the app opens it WITHOUT closing the finalize modal, so the
                    // finalize card sits on top of the picker and intercepts clicks —
                    // capture that state, then — only if the finalize modal is still
                    // stacked on top (legacy behavior) — dismiss it so the picker is
                    // reachable. The app now closes it automatically when the picker
                    // opens, so this is a guarded no-op on current builds.
                    const preset = page.getByText('Choose your visual direction');
                    if (await preset.isVisible({ timeout: 6000 }).catch(() => false)) {
                        await fullShot(page, 'design-preset-choice');
                        const stackedFinalize = page.locator('[aria-labelledby="finalize-success-title"]')
                            .getByRole('button', { name: 'Keep reviewing the plan' });
                        if (await stackedFinalize.isVisible().catch(() => false)) {
                            await stackedFinalize.click().catch(() => {});
                            await settle(400);
                        }
                        // The picker is now a preview grid: click the Modern SaaS card
                        // to select it (accessible name starts with the label — the
                        // "Continue with…" button starts with "Continue", so the
                        // anchored patterns don't collide), then confirm.
                        await page.getByRole('button', { name: /^Modern SaaS/ }).click({ timeout: 6000 });
                        await settle(300);
                        await page.getByRole('button', { name: /^Continue with/ }).click({ timeout: 6000 });
                    }
                    await page.waitForTimeout(3000);
                    assetsTriggered = true;
                    await shot(page, 'assets-generating-start', { fullPage: false });
                }, { optional: true });

                if (assetsTriggered) {
                    await step('asset bundle settles (live Gemini artifacts)', async () => {
                        const t0 = Date.now();
                        let lastShotAt = t0;
                        let lastReady = -1;
                        let lastChangeAt = t0;
                        let settleReason = 'timeout';
                        let subtypes = [];
                        for (;;) {
                            const info = await page.evaluate((projectId) => {
                                for (let i = 0; i < localStorage.length; i++) {
                                    const k = localStorage.key(i);
                                    if (!k || !k.startsWith('synapse-projects-storage')) continue;
                                    try {
                                        const state = JSON.parse(localStorage.getItem(k) || '{}').state;
                                        const arr = state?.artifacts?.[projectId];
                                        if (!arr?.length) continue;
                                        const ready = arr.filter((a) => a.currentVersionId);
                                        return { ready: ready.length, subtypes: ready.map((a) => a.subtype || a.type) };
                                    } catch { /* ignore malformed blobs */ }
                                }
                                return { ready: 0, subtypes: [] };
                            }, report.projectId);
                            subtypes = info.subtypes;
                            // In-flight signals in the workspace: spinning StatusDots in
                            // the artifact rail + the "Creating your build assets…" pane.
                            const spinners = await page.locator('nav[aria-label="Artifacts"] .animate-spin').count().catch(() => 0);
                            const building = await page.getByText('Creating your build assets…').isVisible().catch(() => false);
                            const domIdle = spinners === 0 && !building;
                            const haveAllVisibleCore = VISIBLE_CORE_SUBTYPES.every((s) => info.subtypes.includes(s));

                            if (info.ready !== lastReady) { lastReady = info.ready; lastChangeAt = Date.now(); }
                            if (haveAllVisibleCore && domIdle) { settleReason = 'all-core-done'; break; }
                            // Fallback: some slot errored (no artifact written) but the run
                            // is quiescent and most assets are present — don't hang.
                            if (domIdle && info.ready >= 3 && Date.now() - lastChangeAt > 60_000) { settleReason = 'quiescent'; break; }
                            if (Date.now() - t0 > GENERATION_TIMEOUT_MS) { settleReason = 'timeout'; await shot(page, 'assets-TIMEOUT', { fullPage: false }); break; }
                            if (Date.now() - lastShotAt >= PROGRESS_SHOT_EVERY_MS) {
                                lastShotAt = Date.now();
                                await shot(page, `assets-generating-${Math.round((Date.now() - t0) / 1000)}s`, { fullPage: false });
                            }
                            await settle(5000);
                        }
                        report.assets = {
                            ms: Date.now() - t0,
                            settleReason,
                            readySubtypes: [...new Set(subtypes)].sort(),
                            // Mockup *images* come from the /api/image/generate backend proxy
                            // (server-side, gated by the provider-key status endpoint), and
                            // hasOpenAIKey() reflects that server status — NOT any shell env
                            // var. Plain `vite dev` runs no `api/` functions, so images never
                            // render here regardless of key; the mockup *spec* still generates
                            // via Gemini and screens show as wireframe/placeholder.
                            note: 'Local harness: mockup screen images are always wireframe/placeholder — the /api image backend does not run under vite dev. The mockup spec generates via Gemini.',
                        };
                        console.log(`  assets settled in ${Math.round((Date.now() - t0) / 1000)}s (${settleReason})`,
                            report.assets.readySubtypes);
                        // A timeout means the asset path did not complete — fail the run
                        // (report.assets is already recorded above) rather than exit 0 and
                        // mask the regression this harness exists to catch.
                        if (settleReason === 'timeout') {
                            throw new Error(`asset generation did not settle within ${GENERATION_TIMEOUT_MS / 60000} min`);
                        }
                    }); // non-optional: a stalled/failed asset bundle must fail `npm run e2e`
                }
            }

            // --- Full view/tab inventory walk (per requested viewport) -----------
            for (const viewport of RUN_VIEWPORTS) {
                await captureViews(page, viewport, args.views);
            }
            // Restore the desktop viewport for any post-inventory interaction.
            await page.setViewportSize({ width: DESKTOP_VIEWPORT.width, height: DESKTOP_VIEWPORT.height });
            await settle(600);

            // Decision answering AFTER the inventory so the baseline shots show
            // the pristine generated state.
            if (INTERACTIONS) await runDecisionInteraction(page);

            await exportState(page);
        }
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
