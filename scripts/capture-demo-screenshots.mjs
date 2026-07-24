// Capture screenshots of every artifact in the public demo project, on both
// desktop and mobile viewports.
//
// Run with:  npm run capture:demo                 (defaults to the prod URL)
//            npm run capture:demo -- --base-url=https://synapse-prd.vercel.app
//            npm run capture:demo -- --out=./screenshots-demo
//            npm run capture:demo -- --local      (boot vite dev — see note)
//            npm run capture:demo -- --fetch-relay (force the egress workaround)
//            npm run capture:demo -- --no-relay    (disable the egress workaround)
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
// RESTRICTED-EGRESS / PROXIED ENVIRONMENTS — the "fetch relay" workaround:
//   Some sandboxes (e.g. Claude Code's web/CI containers) route all outbound
//   HTTPS through a policy proxy (HTTPS_PROXY). In those environments Chromium's
//   own navigation to the deployment fails with net::ERR_CONNECTION_RESET even
//   though Node `fetch` / `curl` to the exact same URL succeed — the egress
//   gateway TLS-fingerprint-filters browser traffic and resets the browser's
//   handshake, while it happily tunnels non-browser clients.
//
//   The fix: when a proxy is detected (or `--fetch-relay` is passed) the script
//   launches Chromium WITHOUT a browser proxy and instead intercepts every page
//   request (`context.route`) and fulfils it from a Node `fetch` that is pinned
//   to the proxy via an undici `ProxyAgent` dispatcher (Node's built-in fetch
//   does NOT tunnel through HTTPS_PROXY on its own, so the proxy is configured
//   explicitly rather than relied on ambiently; if undici is somehow unavailable
//   it falls back to global fetch). The browser never opens a real socket, so
//   there is no TLS handshake to reset and no fingerprint to filter. This
//   transparently covers the app HTML, the `/api/*` calls, AND the cross-origin
//   Blob image fetches, so mockup images load too. Auto-enabled when
//   HTTPS_PROXY/https_proxy is set; force with `--fetch-relay`, disable with
//   `--no-relay`.
//
// SYNAPSE_OWNER_TOKEN (optional env var): capturing the demo needs NO auth, but
//   if this is set the script first verifies a demo snapshot is actually pinned
//   on the target deployment (clearer, faster failure if it isn't). The token is
//   only sent to the configured base URL's owner API and is never logged.
//
// WHAT IT DOES per viewport (desktop 1440x920, mobile 390x844, both @2x):
//   1. open `/` (signed out → LoginPage) and click "Demo project"
//   2. wait for navigation to /p/<DEMO_PROJECT_ID>
//   3. switch to the "Assets" pipeline stage (where one nav lists PRD + every
//      artifact)
//   4. select each artifact in turn (on mobile, via the slide-in drawer) and
//      write one full-page PNG: demo-<artifact>-<desktop|mobile>.png. Artifacts
//      with in-page tabs (e.g. the Implementation Plan) additionally have each
//      tab captured on desktop: demo-<artifact>-<tab>-<desktop>.png
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
    const out = { baseUrl: undefined, out: undefined, local: false, relay: undefined };
    for (const a of argv) {
        if (a === '--local') out.local = true;
        else if (a === '--fetch-relay') out.relay = true;
        else if (a === '--no-relay') out.relay = false;
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

// Egress workaround: on by default when a proxy is configured (unless the caller
// overrode it with --fetch-relay / --no-relay). See the header block.
const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy;
const USE_RELAY = args.relay ?? Boolean(PROXY_URL);

const outDir = args.out
    ? (isAbsolute(args.out) ? args.out : resolve(repoRoot, args.out))
    : join(repoRoot, 'screenshots-demo');

// The artifact nav buttons, in current sidebar order. `label` is matched against
// each button's accessible name (regex / substring); `slug` is the filename stem.
// NOTE: the sidebar is grouped (Project Foundation / Experience / Architecture /
// Development / Project Map) but every entry is one button in the shared
// nav[aria-label="Artifacts"]. Screen Inventory + Mockups are consolidated into
// the single "Screens" experience view; UI Components is a hidden artifact (no
// row); Developer Prompts is retired into the Implementation Plan.
//
// `tabs` (optional) drives in-artifact navigation: after the artifact is
// selected, each tab is clicked and captured as its own screenshot. `desktopOnly`
// restricts tab capture to the desktop viewport (mobile still gets one base shot).
const ARTIFACTS = [
    { slug: 'prd', label: 'PRD' },
    { slug: 'design-system', label: 'Design System' },
    { slug: 'user-flows', label: 'User Flows' },
    { slug: 'screens', label: 'Screens' },
    { slug: 'data-model', label: 'Data Model' },
    {
        slug: 'implementation-plan',
        label: 'Implementation Plan',
        tabs: {
            navLabel: 'Implementation plan sections',
            desktopOnly: true,
            // Labels track ConsolidatedPlanView's section nav — keep in sync.
            items: [
                { slug: 'build-brief', label: 'Build Brief' },
                { slug: 'roadmap', label: 'Roadmap' },
                { slug: 'prompts', label: 'Prompts' },
                { slug: 'validation', label: 'Validation' },
                { slug: 'coverage', label: 'Coverage' },
            ],
        },
    },
    { slug: 'dependency-graph', label: 'Dependency Graph' },
];

// Image-heavy views need extra settle time before the full-page snapshot.
const SETTLE_MS = (label) => {
    if (label === 'Screens') return 6000; // mockup images hydrate lazily
    if (label === 'Design System') return 2500;
    return 1400;
};

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
// Fetch relay — see the header block. Intercepts every page request and fulfils
// it from Node `fetch` (which inherits HTTPS_PROXY), so Chromium never opens a
// socket the egress gateway could reset. A relayed request that itself fails is
// aborted so the page's own error handling kicks in (e.g. a dropped demo image
// is tolerated rather than hanging the capture).
const RELAY_STRIP_REQ = new Set(['host', 'accept-encoding']);
const RELAY_STRIP_RES = new Set(['content-encoding', 'content-length', 'transfer-encoding']);

// Build the fetch the relay uses. When a proxy is configured, pin the request to
// it with an undici ProxyAgent — Node's built-in fetch does NOT honor
// HTTPS_PROXY on its own, so relying on the global fetch would (silently) make
// direct connections that the restricted egress refuses. Falls back to global
// fetch if undici can't be loaded.
async function buildRelayFetch() {
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

async function attachFetchRelay(context, relayFetch) {
    await context.route('**/*', async (route) => {
        const req = route.request();
        const url = req.url();
        if (url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
        try {
            const headers = { ...req.headers() };
            for (const k of Object.keys(headers)) {
                if (RELAY_STRIP_REQ.has(k.toLowerCase())) delete headers[k];
            }
            const method = req.method();
            const body = method === 'GET' || method === 'HEAD' ? undefined : req.postDataBuffer() || undefined;
            const resp = await relayFetch(url, { method, headers, body, redirect: 'manual' });
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
// Optional owner-token preflight
// ---------------------------------------------------------------------------
// Capturing the demo needs NO auth — `?demo=1` is a public read. But if a
// SYNAPSE_OWNER_TOKEN is provided (e.g. as a CI secret), use it to confirm a
// demo snapshot is actually pinned before we spin up a browser, so a
// misconfigured deployment fails fast with a clear message instead of a cryptic
// "Demo project never loaded" timeout. The token is only ever sent to the
// configured BASE_URL's owner API and is never logged.
async function preflightDemoPinned(token) {
    try {
        const res = await fetch(`${BASE_URL}/api/snapshots`, {
            headers: { authorization: `Bearer ${token}` },
        });
        if (res.status === 401) {
            throw new Error(
                'SYNAPSE_OWNER_TOKEN was rejected by the deployment (401). Check the ' +
                'secret matches the value set in the Vercel project env.',
            );
        }
        if (!res.ok) {
            console.warn(`Preflight skipped: owner list returned HTTP ${res.status}.`);
            return;
        }
        const body = await res.json().catch(() => ({}));
        if (!body.demoSnapshotId) {
            throw new Error(
                'No demo snapshot is pinned on this deployment. Open the app as the ' +
                'owner → Cloud Snapshots → pin one as the demo, then re-run.',
            );
        }
        console.log(`Preflight OK — demo snapshot pinned (id ${body.demoSnapshotId}).`);
    } catch (err) {
        // A genuine "not pinned" / "token rejected" should stop the run; a bare
        // network blip on the diagnostic call should not block the public capture.
        if (err instanceof Error && /pinned|rejected/.test(err.message)) throw err;
        console.warn(`Preflight check could not run (${err?.message || err}); continuing.`);
    }
}

// ---------------------------------------------------------------------------
// Capture
// ---------------------------------------------------------------------------
async function openDemo(page) {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // Signed-out `/` is the LoginPage with a "Demo project" button; a signed-in
    // session would show HomePage's "View demo project". Match both.
    const demoBtn = page.getByRole('button', { name: /demo project/i }).first();
    await demoBtn.waitFor({ state: 'visible', timeout: 30000 });
    await demoBtn.click();

    // loadDemoProject() fetches the snapshot, then navigates to /p/<demo id>.
    await page.waitForURL('**/p/**', { timeout: 60000 });

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
    // The read-only demo now opens directly on the Assets (workspace) stage as
    // a view-only exploration — its journey navigation is intentionally hidden.
    // If an "Assets" pipeline-stage button is present (non-demo/editable
    // workspaces), click it; otherwise the demo is already there.
    const assetsTab = page.getByRole('button', { name: /^Assets:/ });
    if (await assetsTab.isVisible().catch(() => false)) {
        await assetsTab.click();
    }

    // The artifact sidebar (rendered for both viewports; off-canvas on mobile)
    // confirms ArtifactWorkspace mounted — i.e. the demo spine is final.
    await page
        .locator('nav[aria-label="Artifacts"]')
        .waitFor({ state: 'attached', timeout: 20000 })
        .catch(() => {
            throw new Error(
                'Artifact list never appeared on the Assets stage — the demo spine ' +
                'may not be marked final, or the demo failed to load.',
            );
        });
}

async function selectArtifact(page, viewport, label) {
    if (viewport.mobile) {
        // Open the slide-in drawer, pick the item (which auto-closes the drawer).
        const hamburger = page.getByRole('button', { name: 'Open artifact list' });
        await hamburger.click();
        await page.waitForTimeout(300); // drawer slide-in
    }
    const nav = page.locator('nav[aria-label="Artifacts"]');
    await nav.getByRole('button', { name: new RegExp(escapeRegExp(label)) }).first().click();
    await page.waitForTimeout(300); // selection + (mobile) drawer slide-out
}

// Click an in-artifact tab (scoped to the artifact's own tab nav) and let the
// panel settle before the caller snapshots it.
async function selectTab(page, navLabel, label) {
    const nav = page.locator(`nav[aria-label="${navLabel}"]`);
    await nav.waitFor({ state: 'visible', timeout: 15000 });
    await nav.getByRole('button', { name: new RegExp(escapeRegExp(label)) }).first().click();
    await page.waitForTimeout(500);
}

function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function shoot(page, name) {
    const outPath = join(outDir, name);
    await page.screenshot({ path: outPath, fullPage: true });
    console.log(`captured ${outPath}`);
}

async function captureArtifact(page, viewport, art) {
    await selectArtifact(page, viewport, art.label);
    await page.waitForTimeout(SETTLE_MS(art.label));

    // Always write the artifact-level shot first, so the documented, stable
    // filename demo-<artifact>-<viewport>.png exists for every artifact (a
    // tabbed artifact shows its default tab here) — downstream comparisons /
    // publishing steps rely on it.
    await shoot(page, `demo-${art.slug}-${viewport.name}.png`);

    // Then, for tabbed artifacts, additionally capture each tab. `fullPage`
    // captures the whole panel below the tab nav even when it overflows.
    const tabs = art.tabs;
    if (!tabs || (tabs.desktopOnly && viewport.mobile)) return;
    for (const t of tabs.items) {
        try {
            await selectTab(page, tabs.navLabel, t.label);
        } catch (e) {
            console.log(`  skip tab ${art.label} › ${t.label}: ${e.message.split('\n')[0]}`);
            continue;
        }
        await shoot(page, `demo-${art.slug}-${t.slug}-${viewport.name}.png`);
    }
}

async function captureViewport(browser, viewport, relayFetch) {
    const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 2,
        reducedMotion: 'reduce',
        ignoreHTTPSErrors: true,
    });
    if (USE_RELAY) await attachFetchRelay(context, relayFetch);
    const page = await context.newPage();
    try {
        await openDemo(page);
        await gotoAssetsStage(page);

        for (const art of ARTIFACTS) {
            await captureArtifact(page, viewport, art);
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
        if (USE_RELAY) {
            console.log('Fetch relay ON — routing browser requests through Node fetch (proxied-egress workaround).');
        }

        const ownerToken = process.env.SYNAPSE_OWNER_TOKEN;
        if (ownerToken) await preflightDemoPinned(ownerToken);

        const relayFetch = USE_RELAY ? await buildRelayFetch() : undefined;

        const executablePath = findChromiumExecutable();
        // When the relay is active the browser must NOT use a proxy of its own —
        // it makes no real network connections; every request is fulfilled from
        // Node fetch. When the relay is off we launch plainly (direct egress).
        browser = await chromium.launch(executablePath ? { executablePath } : undefined);

        for (const viewport of VIEWPORTS) {
            console.log(`\n— ${viewport.name} (${viewport.width}x${viewport.height}) —`);
            await captureViewport(browser, viewport, relayFetch);
        }

        console.log(`\nDone — screenshots written to ${outDir}`);
    } finally {
        if (browser) await browser.close().catch(() => {});
        if (server) server.kill('SIGTERM');
    }
}

main().catch((err) => {
    console.error('\n' + (err?.message || err));
    process.exit(1);
});
