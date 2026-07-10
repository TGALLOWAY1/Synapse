// Screens-artifact UX audit capture.
// Captures full-page screenshots of a deployment's demo project Screens
// experience (list, detail tabs, flows, mockups, review states) on desktop and
// mobile. Based on scripts/capture-demo-screenshots.mjs (fetch-relay egress
// workaround for proxied sandboxes).
//
// Run with:  node scripts/capture-screens-audit.mjs                 (prod URL)
//            node scripts/capture-screens-audit.mjs --base-url=https://<preview>.vercel.app
//            DEMO_BASE_URL=https://<preview>.vercel.app node scripts/capture-screens-audit.mjs
//
// Target a PREVIEW deployment when validating a phase branch — capturing prod
// would silently diff against the unchanged live app. The target must serve
// the `/api/snapshots?demo=1` route with a pinned demo snapshot (any Vercel
// deployment of this repo does).

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const baseUrlArg = process.argv.slice(2).find((a) => a.startsWith('--base-url='));
const BASE_URL = (
    (baseUrlArg && baseUrlArg.slice('--base-url='.length)) ||
    process.env.DEMO_BASE_URL ||
    'https://synapse-prd.vercel.app'
).replace(/\/$/, '');
const outDir = join(__dirname, '..', 'screenshots-screens-audit');
const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy;

const manifest = []; // { file, route, viewport, state, interaction }

// ---------------------------------------------------------------------------
// Fetch relay (verbatim approach from repo script)
const RELAY_STRIP_REQ = new Set(['host', 'accept-encoding']);
const RELAY_STRIP_RES = new Set(['content-encoding', 'content-length', 'transfer-encoding']);

async function buildRelayFetch() {
    if (!PROXY_URL) return globalThis.fetch;
    const undici = await import('undici');
    const dispatcher = new undici.ProxyAgent(PROXY_URL);
    return (url, opts) => undici.fetch(url, { ...opts, dispatcher });
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

function findChromiumExecutable() {
    const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
    if (!root || !existsSync(root)) return undefined;
    for (const d of readdirSync(root).filter((d) => d.startsWith('chromium-'))) {
        const candidate = join(root, d, 'chrome-linux', 'chrome');
        if (existsSync(candidate)) return candidate;
    }
    return undefined;
}

// ---------------------------------------------------------------------------
async function openDemo(page) {
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const demoBtn = page.getByRole('button', { name: /demo project/i }).first();
    await demoBtn.waitFor({ state: 'visible', timeout: 30000 });
    await demoBtn.click();
    await page.waitForURL('**/p/**', { timeout: 90000 });
}

async function gotoAssetsStage(page) {
    const assetsTab = page.getByRole('button', { name: /^Assets:/ });
    await assetsTab.waitFor({ state: 'visible', timeout: 30000 });
    await assetsTab.click();
    await page.locator('nav[aria-label="Artifacts"]').waitFor({ state: 'attached', timeout: 20000 });
}

async function selectArtifact(page, mobile, label) {
    if (mobile) {
        const hamburger = page.getByRole('button', { name: 'Open artifact list' });
        if (await hamburger.isVisible().catch(() => false)) {
            await hamburger.click();
            await page.waitForTimeout(400);
        }
    }
    const nav = page.locator('nav[aria-label="Artifacts"]');
    await nav.getByRole('button', { name: new RegExp(label) }).first().click();
    await page.waitForTimeout(400);
}

// The app scrolls inside an inner overflow container (document height ==
// viewport height), so plain fullPage screenshots stop at the fold. Expand the
// viewport until nothing scrolls, capture, then also write viewport-height
// segment clips (for legible close reading), then restore.
async function shoot(page, file, meta) {
    const { width, height: baseH } = page.viewportSize();
    for (let i = 0; i < 6; i++) {
        const need = await page.evaluate(() => {
            let max = document.documentElement.scrollHeight;
            document.querySelectorAll('*').forEach((e) => {
                if (e.scrollHeight - e.clientHeight > 40) {
                    const r = e.getBoundingClientRect();
                    max = Math.max(max, Math.ceil(e.scrollHeight + r.top + window.scrollY));
                }
            });
            return max;
        });
        // Chromium's render surface caps out around 16k device px — with the
        // mobile dsf=2 that means a lower CSS-px ceiling.
        const cap = width < 500 ? 7800 : 15000;
        const cur = page.viewportSize().height;
        if (need <= cur + 10 || cur >= cap) break;
        await page.setViewportSize({ width, height: Math.min(need + 24, cap) });
        await page.waitForTimeout(500);
    }
    const fullH = page.viewportSize().height;
    await page.screenshot({ path: join(outDir, file), fullPage: true });
    // Segment clips at the original viewport granularity for legibility.
    const step = baseH - 60;
    let seg = 0;
    for (let y = 0; y < fullH && seg < 12; y += step, seg++) {
        const h = Math.min(baseH, fullH - y);
        if (h < 120 && seg > 0) break;
        await page.screenshot({
            path: join(outDir, file.replace('.png', `.seg${seg}.png`)),
            clip: { x: 0, y, width, height: h },
        });
    }
    await page.setViewportSize({ width, height: baseH });
    await page.waitForTimeout(400);
    manifest.push({ file, fullHeightPx: fullH, segments: seg, route: page.url().replace(BASE_URL, ''), ...meta });
    console.log(`captured ${file} (${fullH}px, ${seg} segs)`);
}

// Scrape the screen cards visible in the list: name + footer mockup state +
// readiness badge text, in DOM order.
async function scrapeCards(page) {
    return page.evaluate(() => {
        // Screen cards: h4 inside a button that is inside an li
        const cards = [];
        document.querySelectorAll('li h4').forEach((h4) => {
            const btn = h4.closest('button');
            const card = h4.closest('li');
            if (!btn || !card) return;
            const text = card.textContent || '';
            cards.push({
                name: h4.textContent?.trim() || '',
                hasMockup: text.includes('Mockup ready'),
                noMockup: text.includes('No mockup'),
                footer: text.slice(0, 400),
            });
        });
        return cards;
    });
}

async function openScreenByName(page, name) {
    // Click the card whose h4 exactly matches.
    const card = page.locator('li').filter({ has: page.locator('h4', { hasText: name }) }).first();
    await card.locator('button').first().click();
    await page.waitForTimeout(600);
    const url = new URL(page.url());
    return url.searchParams.get('screen');
}

async function clickTab(page, label) {
    const tabs = page.locator('[role="tablist"][aria-label="Screen detail sections"]');
    await tabs.getByRole('tab', { name: label }).click();
    await page.waitForTimeout(800);
}

async function backToList(page) {
    // The URL param is the source of truth; go back until ?screen is gone.
    for (let i = 0; i < 6; i++) {
        const url = new URL(page.url());
        if (!url.searchParams.get('screen')) return;
        await page.goBack();
        await page.waitForTimeout(500);
    }
}

async function captureViewport(browser, vp, relayFetch, screenPlan) {
    const context = await browser.newContext({
        viewport: { width: vp.width, height: vp.height },
        deviceScaleFactor: vp.dsf,
        reducedMotion: 'reduce',
        ignoreHTTPSErrors: true,
        userAgent: vp.mobile
            ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
            : undefined,
        hasTouch: vp.mobile,
        isMobile: vp.mobile,
    });
    await attachFetchRelay(context, relayFetch);
    const page = await context.newPage();
    const V = vp.name;
    try {
        await openDemo(page);
        await gotoAssetsStage(page);

        // ---- 1. Screens overview / list --------------------------------------
        await selectArtifact(page, vp.mobile, 'Screens');
        await page.waitForTimeout(7000); // mockup image hydration
        await shoot(page, `10-screens-list-${V}.png`, {
            viewport: V, group: 'screens-overview',
            state: 'Screens list, default (grouped by flow), collapsed details',
            interaction: 'Assets stage → Screens sidebar row',
        });

        // Scrape cards for planning (desktop pass fills the shared plan).
        const cards = await scrapeCards(page);
        console.log(`cards (${V}):`, JSON.stringify(cards.map(c => ({ n: c.name, m: c.hasMockup })), null, 0).slice(0, 1500));
        if (!vp.mobile) {
            screenPlan.cards = cards;
            screenPlan.compute();
        }

        // Expand the first two cards' details
        const detailBtns = page.getByRole('button', { name: 'Show details' });
        const n = await detailBtns.count();
        for (let i = 0; i < Math.min(2, n); i++) {
            await page.getByRole('button', { name: 'Show details' }).first().click();
            await page.waitForTimeout(300);
        }
        await shoot(page, `11-screens-list-card-details-${V}.png`, {
            viewport: V, group: 'screens-overview',
            state: 'Screens list with first two cards\' "Show details" expanded',
            interaction: 'Clicked "Show details" on first two cards',
        });
        // collapse again
        const hideBtns = page.getByRole('button', { name: 'Hide details' });
        while (await hideBtns.count()) {
            await hideBtns.first().click();
            await page.waitForTimeout(150);
        }

        // Expand "Project readiness & metadata"
        const meta = page.getByRole('button', { name: /Project readiness & metadata/ });
        if (await meta.isVisible().catch(() => false)) {
            await meta.click();
            await page.waitForTimeout(600);
            await shoot(page, `12-screens-list-readiness-metadata-${V}.png`, {
                viewport: V, group: 'review-risk',
                state: 'Screens list with "Project readiness & metadata" section expanded (coverage, preflight, handoff export)',
                interaction: 'Expanded the collapsed metadata section at the bottom of the list',
            });
            await meta.click();
            await page.waitForTimeout(300);
        }

        // ---- 2. User Flows artifact ------------------------------------------
        await selectArtifact(page, vp.mobile, 'User Flows');
        await page.waitForTimeout(2500);
        await shoot(page, `20-user-flows-${V}.png`, {
            viewport: V, group: 'flows',
            state: 'User Flows artifact (flow journey view), default state',
            interaction: 'Selected User Flows in artifact nav',
        });

        // ---- 3. Screen detail views ------------------------------------------
        await selectArtifact(page, vp.mobile, 'Screens');
        await page.waitForTimeout(4000);

        const picks = vp.mobile ? screenPlan.mobilePicks : screenPlan.desktopPicks;
        for (const pick of picks) {
            let id = null;
            try {
                id = await openScreenByName(page, pick.name);
            } catch (e) {
                console.log(`  skip screen ${pick.name}: ${String(e).split('\n')[0]}`);
                continue;
            }
            await page.waitForTimeout(4000); // primary mockup hydration
            await shoot(page, `${pick.prefix}-detail-overview-${V}.png`, {
                viewport: V, group: 'screen-detail',
                state: `Screen Detail › Overview — "${pick.name}" (${pick.why})`,
                interaction: `Clicked the "${pick.name}" card`,
            });
            // S-31 baseline: expanded Review notes (risk-resolution UI) on the
            // first pick, so re-runs reproduce the full documented shot set.
            if (pick.prefix === '30') {
                const reviewNotes = page.getByRole('button', { name: /Review notes/i }).first();
                if (await reviewNotes.isVisible().catch(() => false)) {
                    await reviewNotes.click();
                    await page.waitForTimeout(600);
                    await shoot(page, `31-detail-overview-expanded-${V}.png`, {
                        viewport: V, group: 'review-risk',
                        state: `Screen Detail › Overview with Review notes expanded — "${pick.name}"`,
                        interaction: 'Clicked the Review notes disclosure header',
                    });
                    await reviewNotes.click();
                    await page.waitForTimeout(300);
                } else {
                    console.log('  Review notes disclosure not found — skipping 31-* capture');
                }
            }
            for (const tab of ['Flow', 'Mockups']) {
                try {
                    await clickTab(page, tab);
                    await page.waitForTimeout(tab === 'Mockups' ? 3000 : 800);
                    await shoot(page, `${pick.prefix}-detail-${tab.toLowerCase()}-${V}.png`, {
                        viewport: V, group: tab === 'Flow' ? 'flows' : 'mockups',
                        state: `Screen Detail › ${tab} — "${pick.name}" (${pick.why})`,
                        interaction: `Clicked the ${tab} tab`,
                    });
                } catch (e) {
                    console.log(`  skip tab ${tab} on ${pick.name}: ${String(e).split('\n')[0]}`);
                }
            }
            await backToList(page);
            await page.waitForTimeout(1000);
        }
    } finally {
        await context.close();
    }
}

async function main() {
    mkdirSync(outDir, { recursive: true });
    const relayFetch = await buildRelayFetch();
    const executablePath = findChromiumExecutable();
    const browser = await chromium.launch(executablePath ? { executablePath } : undefined);

    // Shared plan: the desktop pass scrapes cards and picks representative
    // screens; picks are computed after the desktop list scrape via pickScreens.
    const screenPlan = { cards: [], desktopPicks: [], mobilePicks: [] };

    try {
        // --- Desktop: first a scout pass to enumerate cards ---
        const desktop = { name: 'desktop', width: 1440, height: 920, dsf: 1, mobile: false };
        const mobile = { name: 'mobile', width: 390, height: 844, dsf: 2, mobile: true };

        // pickScreens: with mockup, without mockup, plus first two distinct.
        screenPlan.compute = () => {
            const cards = screenPlan.cards;
            const picks = [];
            const seen = new Set();
            const add = (card, prefix, why) => {
                if (!card || seen.has(card.name)) return;
                seen.add(card.name);
                picks.push({ name: card.name, prefix, why });
            };
            add(cards.find(c => c.hasMockup), '30', 'has generated primary mockup');
            add(cards.find(c => c.noMockup), '32', 'no generated mockup');
            // a couple more for breadth
            add(cards.find(c => !seen.has(c.name)), '34', 'additional representative screen');
            screenPlan.desktopPicks = picks;
            screenPlan.mobilePicks = picks.slice(0, 2);
        };

        await captureViewport(browser, desktop, relayFetch, screenPlan);
        await captureViewport(browser, mobile, relayFetch, screenPlan);
    } finally {
        await browser.close().catch(() => {});
        writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
        console.log(`\nmanifest written (${manifest.length} shots)`);
    }
}

main().catch((err) => {
    console.error('\n' + (err?.stack || err));
    process.exit(1);
});
