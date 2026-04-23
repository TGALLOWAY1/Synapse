import { v4 as uuidv4 } from 'uuid';
import type {
    MockupSettings,
    MockupPayload,
    MockupScreen,
    StructuredPRD,
} from '../../types';
import { callGemini } from '../geminiClient';
import type { ProviderOptions } from '../geminiClient';
import { mockupSchema } from '../schemas/mockupSchema';
import { mockupLayoutSpecSchema } from '../schemas/mockupLayoutSpec';
import { assessMockupHtmlQuality, normalizeMockupHtml } from '../mockupQuality';
import { critiqueMockupAlignment, type MockupAlignmentCritique } from '../mockupAlignmentCritique';
import { PLACEHOLDER_PROMPT_CATALOG } from '../mockupPlaceholders';
import { validateMockupHtmlStructure } from '../mockupValidation';
import { MockupSpecParseError, parseLayoutSpec } from '../mockupLayoutRenderer';

// ---- Instruction tables (rewritten for polished HTML/Tailwind output) ----

const FIDELITY_INSTRUCTIONS: Record<string, string> = {
    low: 'Fidelity: wireframe-leaning but still styled — neutral palette, clear boundaries, placeholder skeleton bars for charts/images. Avoid decorative color; prefer structure.',
    mid: 'Fidelity: polished mid-fi — real copy, realistic table rows, stat tiles with numbers and deltas, sidebar nav with icons (SVG), consistent spacing. No decorative illustrations.',
    high: 'Fidelity: high-fi SaaS polish — gradient hero accents, crisp cards with shadow-sm, stat deltas with colored chips, realistic activity feeds, inline SVG iconography, and tasteful use of a single accent color. Looks shippable.',
};

const PLATFORM_INSTRUCTIONS: Record<string, string> = {
    desktop: 'Platform: desktop. Use a 1440px shell with a left sidebar (w-60) + top bar (h-14) + max-w-7xl main content. Multi-column grids where useful. Assume mouse/keyboard.',
    mobile: 'Platform: mobile. Use a single-column layout constrained to ~390px (mx-auto max-w-[420px]) with a sticky top header and a bottom tab bar (5 items max). Large tap targets. Assume touch.',
    responsive: 'Platform: responsive. Build a desktop-first shell (sidebar + topbar + content) but use responsive Tailwind classes (hidden md:block, grid-cols-1 md:grid-cols-3, etc.) so it collapses gracefully below md.',
};

const SCOPE_INSTRUCTIONS: Record<string, string> = {
    single_screen: 'Scope: exactly ONE screen. Make it the highest-value screen of the product (usually the primary dashboard or editor).',
    multi_screen: 'Scope: 3 to 4 screens covering the core experience (e.g. dashboard, detail view, settings, or empty/onboarding). All screens must share the same shell, typography, and accent color.',
    key_workflow: 'Scope: 3 to 5 screens forming a single linear workflow the primary persona would take end-to-end. Each screen should show the next logical step. Same shell, same style, same accent.',
};

const MOCKUP_PROMPT_TEMPLATE_VERSION = '2026-04-17.v2';
const MOCKUP_GENERATION_STRATEGY_VERSION = 'mockup_strategy_v2';
const MOCKUP_SPEC_STRATEGY_VERSION = 'mockup_strategy_spec_v1';
const MAX_GENERATION_ATTEMPTS = 3;
const QUALITY_THRESHOLD = 70;

// Phase A engine switch. Default remains the HTML engine until the spec
// engine has validated against the harness; users can opt-in via
// localStorage.MOCKUP_ENGINE = 'spec'.
type MockupEngine = 'html' | 'spec';
const getMockupEngine = (): MockupEngine => {
    try {
        const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('MOCKUP_ENGINE') : null;
        return raw === 'spec' ? 'spec' : 'html';
    } catch {
        return 'html';
    }
};

// ---- Prompt construction ----

const buildSystemPrompt = (settings: MockupSettings): string => {
    const styleLine = settings.style ? `\nStyle direction from the user: ${settings.style}` : '';

    return `You are a senior product designer at a top-tier SaaS company (think Linear, Notion, Vercel, Stripe). You generate high-fidelity UI *concepts* — not production code — for new products, grounded in a provided PRD. Your output MUST be valid JSON matching the provided response schema.
Prompt template version: ${MOCKUP_PROMPT_TEMPLATE_VERSION}.

## Visual language
- Modern SaaS aesthetic. Generous whitespace. Clear hierarchy. 8px spacing scale.
- Neutral base palette: white / neutral-50 / neutral-100 backgrounds, neutral-900 headings, neutral-500 secondary text, neutral-200 borders. Single accent color: indigo-600 for primary actions, indigo-50 / indigo-100 for tints — unless the user's style direction says otherwise.
- Cards: rounded-xl or rounded-2xl, border border-neutral-200, shadow-sm, p-5 / p-6.
- Type scale: text-xs / text-sm / text-base / text-lg / text-xl / text-2xl / text-3xl. Headings font-semibold or font-bold, tracking-tight for large headings.
- Prefer real product patterns: topbar + sidebar shells, stat cards (label + large number + delta chip), data tables with zebra rows and hover states, kanban columns, timelines, split panes, chat sidebars, filter chips, breadcrumb trails, rich empty states, toast notifications, modal previews, activity feeds with avatars.
- Use inline <svg> or CSS gradients for icons. NEVER reference external images or fonts.
- For avatars, hero banners, product images, logos, charts, and image thumbnails, emit a placeholder token (see catalog below) instead of an <img> tag or hand-rolled SVG. The render pipeline expands each token into a consistent inline SVG.
- Copy MUST be realistic and grounded in the actual product — use real persona names, feature names, and entity names from the PRD. NO "Lorem ipsum", NO "Button 1 / Button 2", NO generic "Item A / Item B".

## Technical constraints (non-negotiable)
- For each screen's \`html\` field, output ONLY a body fragment. Do NOT include \`<!doctype>\`, \`<html>\`, \`<head>\`, \`<body>\`, \`<meta>\`, \`<link>\`, or \`<script>\` tags. Tailwind is already loaded in the render sandbox.
- No JavaScript. No inline event handlers (onclick, onload, onmouseover, etc.). No \`javascript:\` URLs.
- No external stylesheets, no \`<style>\` tags, no \`<link>\` tags, no Google Fonts, no images from the internet.
- Use Tailwind utility classes exclusively for styling.
- Use semantic HTML: \`<header>\`, \`<nav>\`, \`<main>\`, \`<aside>\`, \`<section>\`, \`<article>\`, \`<table>\`, \`<ul>\`, \`<button type="button">\`.
- Wrap EACH screen in a single top-level \`<div class="min-h-screen bg-neutral-50 text-neutral-900 font-sans antialiased">\` so the sandbox renders a full-bleed surface.
- Output must be valid HTML — every opening tag closed, attributes quoted.

## Layout & scrolling rules (critical — preview will be blank if violated)
- The render sandbox is a scrollable iframe. DO NOT build your own scroll containers inside it.
- Do NOT put \`overflow-hidden\` on the root \`min-h-screen\` shell, on \`<main>\`, or on any flex column container. These trap content above the iframe fold and the user sees a blank preview.
- Do NOT use \`flex-1 overflow-y-auto\` to create an internal scrolling content area. Let the page flow naturally; the iframe scrolls.
- For sidebar shells: put \`flex\` on the root, \`<aside class="w-64 ...">\`, and \`<main class="flex-1 ...">\` (no \`overflow-hidden\`, no \`flex flex-col\` with internal scroll). Content inside main flows top-to-bottom.
- Avoid \`h-screen\` (use \`min-h-screen\` only on the root). Do not pin inner sections to viewport height.
- Keep total content density realistic for a single screen — if a section has 6+ KPI tiles plus 4+ panels plus a hero plus a leaderboard, split across screens instead of stuffing one shell.

## Required layout contract per screen
- Every screen must include: (1) top-level app shell, (2) page header with title + primary action, (3) at least one primary content section, (4) at least one secondary/supporting section (filters, activity, details, etc.), and (5) at least one interactive control (button/input/select/tab).
- Spacing rhythm must follow Tailwind scale 2/3/4/6/8. Avoid arbitrary values unless necessary for framing.
- Keep line lengths realistic; avoid giant text blocks.
- Avoid placeholder labels; every label should reflect the product domain.
- If scope is workflow, each screen must represent a distinct step in that workflow with continuity in naming and entities.

## Canonical output template (mandatory for each screen)
Follow this section order in HTML:
1) app shell root div with class min-h-screen
2) header with title and one primary CTA button
3) main containing:
   - first section primary content panel
   - second section supporting context (activity/filter/details)
4) Optional aside for utilities; keep consistent placement across screens
Do not emit additional root siblings. Keep exactly one app shell root.

## Determinism contract (mandatory)
- Use a single accent family throughout all screens.
- Reuse the same shell and spacing scale unless the workflow step requires a clear state change.
- Keep section names and entity labels consistent between screens.
- Do not generate extra screens beyond the requested scope.

## Quality bar (fail these and regenerate internally before responding)
- No malformed or partial tag structures.
- No clipped/collapsed shells; content should fit inside intentional cards/sections.
- No generic dashboard sludge detached from PRD intent.
- No visual chaos: keep one consistent accent, spacing system, and typography scale.

## Multi-screen coherence
If you generate multiple screens, they MUST feel like the same product:
- same accent color, same type scale, same sidebar/topbar shell, same component vocabulary, same persona names, same entity names.
- prefer reusing one consistent shell (sidebar + topbar) across screens, only swapping the main content area.

## Per-screen fields
- \`name\`: short screen title (e.g. "Editor Dashboard", "Branch Review", "Onboarding Step 2").
- \`purpose\`: ONE sentence explaining what this screen solves, for which persona, grounded in the PRD.
- \`html\`: the body fragment following every constraint above.
- \`notes\` (optional): 1–3 short assumptions or callouts the designer made.

Also provide a top-level \`title\` (the overall concept name) and a \`summary\` (1–2 sentences framing the concept).
Include \`version\` exactly as \`mockup_html_v1\`.

${FIDELITY_INSTRUCTIONS[settings.fidelity]}
${PLATFORM_INSTRUCTIONS[settings.platform]}
${SCOPE_INSTRUCTIONS[settings.scope]}${styleLine}

## Image & media placeholders
${PLACEHOLDER_PROMPT_CATALOG}`;
};

const buildUserPrompt = (prdContent: string, structuredPRD?: StructuredPRD): string => {
    const parts: string[] = [`Product PRD:\n---\n${prdContent}\n---`];

    if (structuredPRD) {
        const personas = structuredPRD.targetUsers?.slice(0, 6).join(', ');
        const features = structuredPRD.features
            ?.slice(0, 8)
            .map(f => `- ${f.name}${f.description ? `: ${f.description}` : ''}`)
            .join('\n');
        const vision = structuredPRD.vision?.trim();
        const problem = structuredPRD.coreProblem?.trim();

        const structuredLines: string[] = ['Structured PRD summary (use these names in your copy):'];
        if (vision) structuredLines.push(`Vision: ${vision}`);
        if (problem) structuredLines.push(`Core problem: ${problem}`);
        if (personas) structuredLines.push(`Personas: ${personas}`);
        if (features) structuredLines.push(`Key features:\n${features}`);
        parts.push(structuredLines.join('\n'));
    }

    parts.push('Generate the mockup JSON now. Remember: every screen must be grounded in this product, use real names from the PRD, and follow every technical constraint.');
    return parts.join('\n\n');
};

// ---- Parsing / validation ----

/** Minimum meaningful HTML length — anything shorter is almost certainly an
 *  empty or broken fragment (e.g. "<div></div>"). */
const MIN_HTML_LENGTH = 80;

export interface ParseResult {
    payload: MockupPayload;
    critique: MockupAlignmentCritique;
    /** Warnings for screens that were skipped (partial success). Empty when all
     *  screens parsed cleanly. */
    warnings: string[];
    usedFallback?: boolean;
    strategyVersion?: string;
}

/**
 * Parse raw JSON into a validated MockupPayload. Tolerant of individual bad
 * screens — skips them and reports warnings rather than throwing.  Only throws
 * when zero usable screens survive.
 */
const parseMockupPayload = (
    raw: string,
    prdContent: string,
    settings: MockupSettings,
    structuredPRD?: StructuredPRD,
): ParseResult => {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        throw new Error(`Mockup generation returned invalid JSON: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Mockup generation returned a non-object response.');
    }

    const obj = parsed as Record<string, unknown>;
    const screensRaw = obj.screens;

    if (!Array.isArray(screensRaw) || screensRaw.length === 0) {
        throw new Error('Mockup generation returned no screens.');
    }

    const screens: MockupScreen[] = [];
    const warnings: string[] = [];

    for (let i = 0; i < screensRaw.length; i++) {
        const s = screensRaw[i];
        if (!s || typeof s !== 'object') {
            warnings.push(`Screen ${i + 1}: skipped — not a valid object.`);
            continue;
        }
        const sObj = s as Record<string, unknown>;
        const name = typeof sObj.name === 'string' ? sObj.name.trim() : '';
        const purpose = typeof sObj.purpose === 'string' ? sObj.purpose.trim() : '';
        const rawHtml = typeof sObj.html === 'string' ? sObj.html : '';
        const notes = typeof sObj.notes === 'string' ? sObj.notes.trim() : undefined;

        if (!name) {
            warnings.push(`Screen ${i + 1}: skipped — missing name.`);
            continue;
        }
        if (!rawHtml.trim() || rawHtml.trim().length < MIN_HTML_LENGTH) {
            warnings.push(`Screen ${i + 1} ("${name}"): skipped — HTML too short or empty.`);
            continue;
        }

        const normalizedHtml = normalizeMockupHtml(rawHtml);
        const structure = validateMockupHtmlStructure(normalizedHtml);
        if (!structure.isValid) {
            warnings.push(`Screen ${i + 1} ("${name}"): skipped — failed structure validation (${structure.score}/100). ${structure.issues.slice(0, 2).join(' ')}`);
            continue;
        }
        const quality = assessMockupHtmlQuality(normalizedHtml);
        if (quality.reject) {
            const reason = quality.issues.map(issue => issue.message).join(' ');
            warnings.push(
                `Screen ${i + 1} ("${name}"): skipped — failed quality gate (${quality.score}/100). ${reason}`
            );
            continue;
        }

        const qualityIssues = quality.issues.map(issue => issue.message).join(' ');
        const composedNotes = [notes, qualityIssues ? `Quality notes: ${qualityIssues}` : undefined]
            .filter(Boolean)
            .join(' ')
            .trim();

        screens.push({
            id: uuidv4(),
            name,
            purpose,
            html: normalizedHtml,
            notes: composedNotes || undefined,
        });
    }

    if (screens.length === 0) {
        throw new Error(
            `Mockup generation produced ${screensRaw.length} screen(s) but none were usable. ${warnings.join(' ')}`
        );
    }

    const critique = critiqueMockupAlignment(screens, settings, prdContent, structuredPRD);

    if (critique.severity === 'high' && critique.alignmentScore < 45) {
        const critiqueReason = critique.mismatchReasons.slice(0, 3).join(' ');
        throw new Error(
            `Mockup generation failed PRD alignment critique (${critique.alignmentScore}/100). ${critiqueReason}`
        );
    }

    critique.screens
        .filter(screen => screen.severity !== 'low')
        .forEach(screen => {
            warnings.push(
                `Screen "${screen.screenName}": alignment ${screen.score}/100 (${screen.severity}). ${screen.mismatchReasons.slice(0, 2).join(' ')}`
            );
        });

    if (critique.severity !== 'low') {
        warnings.push(
            `Set alignment ${critique.alignmentScore}/100 (${critique.severity}). Missing: ${critique.missingConcepts.join(', ') || 'none identified'}.`
        );
    }

    const title = typeof obj.title === 'string' && obj.title.trim()
        ? obj.title.trim()
        : 'Mockup concept';
    const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';

    return {
        payload: {
            version: 'mockup_html_v1',
            title,
            summary,
            screens,
        },
        critique,
        warnings,
        usedFallback: false,
        strategyVersion: MOCKUP_GENERATION_STRATEGY_VERSION,
    };
};

const inferConceptName = (prdContent: string): string => {
    const firstLine = prdContent.split('\n').map(line => line.trim()).find(Boolean) ?? 'Product';
    return firstLine.replace(/[#*`]/g, '').slice(0, 56) || 'Product';
};

const buildSafeFallbackPayload = (
    prdContent: string,
    settings: MockupSettings,
    warnings: string[],
): ParseResult => {
    const concept = inferConceptName(prdContent);
    const action = settings.scope === 'key_workflow' ? 'Continue workflow' : 'Create item';
    const html = normalizeMockupHtml(`
<div class="min-h-screen bg-neutral-50 text-neutral-900 font-sans antialiased">
  <header class="border-b border-neutral-200 bg-white px-6 py-4 flex items-center justify-between">
    <div>
      <p class="text-xs uppercase tracking-wide text-neutral-500">Safe fallback</p>
      <h1 class="text-xl font-semibold tracking-tight">${concept} Workspace</h1>
    </div>
    <button type="button" class="rounded-lg bg-indigo-600 text-white px-4 py-2 text-sm font-medium">${action}</button>
  </header>
  <main class="p-6 grid gap-4 md:grid-cols-3">
    <section class="md:col-span-2 rounded-xl border border-neutral-200 bg-white p-5 space-y-3">
      <h2 class="text-base font-semibold">Primary content</h2>
      <p class="text-sm text-neutral-600">Generated fallback layout to keep the preview usable while regeneration is unavailable.</p>
      <div class="rounded-lg border border-neutral-200 bg-neutral-50 p-4 text-sm text-neutral-600">Use regenerate to request a richer PRD-grounded screen.</div>
    </section>
    <section class="rounded-xl border border-neutral-200 bg-white p-5 space-y-2">
      <h3 class="text-sm font-semibold">Supporting context</h3>
      <ul class="text-sm text-neutral-600 space-y-1">
        <li>Stable shell and spacing system</li>
        <li>Consistent typography and accent</li>
        <li>Always-renderable safe template</li>
      </ul>
    </section>
  </main>
</div>`);

    warnings.push('Generation failed quality gates repeatedly; rendered a deterministic safe fallback template.');
    return {
        payload: {
            version: 'mockup_html_v1',
            title: `${concept} — Safe Fallback Mockup`,
            summary: 'Fallback mockup rendered to avoid blank or broken output. Regenerate for a richer PRD-grounded concept.',
            screens: [{
                id: uuidv4(),
                name: 'Fallback Workspace',
                purpose: 'Provides a safe, usable baseline when model output fails validation.',
                html,
                notes: 'Fallback template was used after repeated validation failures.',
            }],
        },
        critique: {
            alignmentScore: 55,
            severity: 'medium',
            missingConcepts: ['full PRD grounding'],
            mismatchReasons: ['Fallback template used due to validation failures.'],
            recommendations: ['Regenerate to recover full PRD-specific content.'],
            issues: [],
            screens: [],
        },
        warnings,
        usedFallback: true,
        strategyVersion: MOCKUP_GENERATION_STRATEGY_VERSION,
    };
};

// ---- Spec engine (Phase A) ----
//
// The spec engine replaces free-form HTML generation with a typed layout
// spec. The model only picks shells/sections/actions from a closed vocabulary
// and fills slot content; deterministic templates in
// src/components/mockups/templates/ render the HTML. Slot text is still
// critiqued for PRD alignment via critiqueMockupAlignment on the rendered
// output so the existing gating path continues to apply.

const buildSpecSystemPrompt = (settings: MockupSettings): string => {
    const styleLine = settings.style ? `\nStyle direction from the user: ${settings.style}` : '';
    return `You are a senior product designer producing a deterministic mockup layout spec (mockup_layout_spec_v1) for a new product, grounded in a PRD.

DETERMINISTIC MODE IS ON.
You MUST output ONLY a layout_spec JSON object matching the provided responseSchema. Do NOT return HTML. A separate deterministic renderer turns the spec into HTML.
Prompt template version: ${MOCKUP_PROMPT_TEMPLATE_VERSION}.

## Output contract
- version: "mockup_layout_spec_v1"
- tokenSet: "token_set_v1"
- title: a short concept name grounded in the PRD
- summary: one or two sentences framing the concept
- screens: 1 to 5 screens. Use exactly the number implied by the scope setting below.

## Per-screen rules
- name: short screen title (e.g. "Triage Queue", "Case Detail Review")
- purpose: one sentence explaining what this screen solves, for which persona, grounded in the PRD
- shell: REUSE the same shell.type/platform/accent/productName/navLabels across ALL screens unless the workflow step explicitly requires a state change. This is how we enforce cross-screen coherence.
- sections: 2 to 4 entries. At least one with role="primary"; the rest "support" or "utility".
- actions: 1 to 4 entries. At least one action.kind="primary_cta" with a PRD-derived verb label.

## Allowed values (strict — do not invent)
- shell.type: sidebar_topbar | topbar_only | mobile_tab_shell
- shell.platform: desktop | mobile | responsive
- shell.accent: indigo
- section.role: primary | support | utility
- section.component: stat_grid | data_table | activity_feed | filters_bar | detail_panel | empty_state
- action.kind: primary_cta | secondary_cta | input | select | tab

## Section slot-data contract (fill only the fields for the chosen component)
- stat_grid: data.rows = 2–6 items, each { label, value, delta? }. Use PRD metric names for labels; realistic numbers for values.
- data_table: data.columns = 2–6 strings; data.tableRows = 1–8 items, each { cells: string[] }. Cell count should match columns. Column headers and cells must be grounded in PRD entities.
- activity_feed: data.entries = 2–6 items, each { actor, verb, target, when }. Use real persona names, realistic verbs, PRD entities, and relative times like "2m ago".
- filters_bar: data.filters = 1–4 items, each { label, options: 2–5 strings }. Use PRD-grounded filter dimensions.
- detail_panel: data.fields = 2–8 items, each { label, value }. Use PRD entity field names and realistic values.
- empty_state: data = { heading, body, primaryActionLabel? }.

## Content quality bar
- Copy MUST use the actual product's persona names, feature names, and entity names from the PRD. No "Lorem ipsum", no "Button 1", no "Item A".
- Keep labels tight (under ~40 chars). No full paragraphs in slot text.
- Reuse navLabels across screens; reuse productName exactly.
- The first action on every screen should be the most important primary verb for that screen (e.g. "Assign case owner", not "Create").

## Settings context
${FIDELITY_INSTRUCTIONS[settings.fidelity]}
${PLATFORM_INSTRUCTIONS[settings.platform]}
${SCOPE_INSTRUCTIONS[settings.scope]}${styleLine}

## Reminders
Return ONLY the layout_spec JSON. No markdown, no commentary, no HTML.

## Image & media placeholders (informational)
Placeholder tokens below are available to the deterministic renderer. Do NOT include them yourself.
${PLACEHOLDER_PROMPT_CATALOG}`;
};

const buildSpecUserPrompt = (prdContent: string, structuredPRD?: StructuredPRD): string => {
    const parts: string[] = [`Product PRD:\n---\n${prdContent}\n---`];
    if (structuredPRD) {
        const personas = structuredPRD.targetUsers?.slice(0, 6).join(', ');
        const features = structuredPRD.features
            ?.slice(0, 8)
            .map(f => `- ${f.name}${f.description ? `: ${f.description}` : ''}`)
            .join('\n');
        const vision = structuredPRD.vision?.trim();
        const problem = structuredPRD.coreProblem?.trim();
        const structuredLines: string[] = ['Structured PRD summary (use these names in your slot content):'];
        if (vision) structuredLines.push(`Vision: ${vision}`);
        if (problem) structuredLines.push(`Core problem: ${problem}`);
        if (personas) structuredLines.push(`Personas: ${personas}`);
        if (features) structuredLines.push(`Key features:\n${features}`);
        parts.push(structuredLines.join('\n'));
    }
    parts.push('Return the layout_spec JSON now. No HTML. No markdown fences. Use only the allowed enum values.');
    return parts.join('\n\n');
};

const runSpecEngineAttempt = async (
    prdContent: string,
    settings: MockupSettings,
    structuredPRD: StructuredPRD | undefined,
    warnings: string[],
): Promise<ParseResult> => {
    const system = buildSpecSystemPrompt(settings);
    const user = buildSpecUserPrompt(prdContent, structuredPRD);
    const raw = await callGemini(system, user, {
        responseMimeType: 'application/json',
        responseSchema: mockupLayoutSpecSchema,
        temperature: 0.2,
        topP: 0.8,
        topK: 32,
    });
    const fallbackProduct = inferConceptName(prdContent);
    const specResult = parseLayoutSpec(raw, fallbackProduct);
    specResult.warnings.forEach(w => warnings.push(w));

    // Run the existing alignment critique on the rendered screens so the
    // PRD-grounding gate still applies. The spec engine produces consistent
    // structure, but copy can still drift generic if the PRD is thin.
    const critique = critiqueMockupAlignment(
        specResult.payload.screens,
        settings,
        prdContent,
        structuredPRD,
    );
    if (critique.severity === 'high' && critique.alignmentScore < 45) {
        const reason = critique.mismatchReasons.slice(0, 3).join(' ');
        throw new Error(
            `Mockup spec failed PRD alignment critique (${critique.alignmentScore}/100). ${reason}`,
        );
    }
    critique.screens
        .filter(screen => screen.severity !== 'low')
        .forEach(screen => {
            warnings.push(
                `Screen "${screen.screenName}": alignment ${screen.score}/100 (${screen.severity}). ${screen.mismatchReasons.slice(0, 2).join(' ')}`,
            );
        });
    if (critique.severity !== 'low') {
        warnings.push(
            `Set alignment ${critique.alignmentScore}/100 (${critique.severity}). Missing: ${critique.missingConcepts.join(', ') || 'none identified'}.`,
        );
    }

    return {
        payload: specResult.payload,
        critique,
        warnings: specResult.warnings,
        usedFallback: false,
        strategyVersion: MOCKUP_SPEC_STRATEGY_VERSION,
    };
};

// ---- Public API ----

const runHtmlEngine = async (
    prdContent: string,
    settings: MockupSettings,
    structuredPRD: StructuredPRD | undefined,
    options: ProviderOptions | undefined,
): Promise<ParseResult> => {
    const system = buildSystemPrompt(settings);
    const user = buildUserPrompt(prdContent, structuredPRD);
    const warnings: string[] = [];
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
        options?.onStatus?.(`Generating mockup (attempt ${attempt}/${MAX_GENERATION_ATTEMPTS})...`);
        try {
            const raw = await callGemini(system, user, {
                responseMimeType: 'application/json',
                responseSchema: mockupSchema,
                temperature: 0.2,
                topP: 0.8,
                topK: 32,
            });
            const parsed = parseMockupPayload(raw, prdContent, settings, structuredPRD);
            const qualityAvg = parsed.payload.screens.length
                ? Math.round(parsed.payload.screens
                    .map(screen => assessMockupHtmlQuality(screen.html).score)
                    .reduce((sum, score) => sum + score, 0) / parsed.payload.screens.length)
                : 0;
            if (qualityAvg < QUALITY_THRESHOLD) {
                warnings.push(`Attempt ${attempt}: average quality ${qualityAvg}/100 below threshold ${QUALITY_THRESHOLD}.`);
                lastError = new Error(`Quality threshold not met (${qualityAvg}/100).`);
                continue;
            }
            return {
                ...parsed,
                warnings: [...warnings, ...parsed.warnings],
                usedFallback: false,
                strategyVersion: MOCKUP_GENERATION_STRATEGY_VERSION,
            };
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            lastError = err;
            warnings.push(`Attempt ${attempt} failed: ${err.message}`);
        }
    }

    console.warn('[mockupService] returning safe fallback after repeated generation failures', lastError);
    return buildSafeFallbackPayload(prdContent, settings, warnings);
};

const runSpecEngine = async (
    prdContent: string,
    settings: MockupSettings,
    structuredPRD: StructuredPRD | undefined,
    options: ProviderOptions | undefined,
): Promise<ParseResult> => {
    const warnings: string[] = [];
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
        options?.onStatus?.(`Generating mockup spec (attempt ${attempt}/${MAX_GENERATION_ATTEMPTS})...`);
        try {
            return await runSpecEngineAttempt(prdContent, settings, structuredPRD, warnings);
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            lastError = err;
            if (err instanceof MockupSpecParseError) {
                err.warnings.forEach(w => warnings.push(w));
            }
            warnings.push(`Spec attempt ${attempt} failed: ${err.message}`);
        }
    }

    console.warn('[mockupService] spec engine falling back to HTML engine after repeated failures', lastError);
    warnings.push('Spec engine failed repeatedly; falling back to HTML engine for this generation.');
    const htmlResult = await runHtmlEngine(prdContent, settings, structuredPRD, options);
    return {
        ...htmlResult,
        warnings: [...warnings, ...htmlResult.warnings],
    };
};

export const generateMockup = async (
    prdContent: string,
    settings: MockupSettings,
    structuredPRD?: StructuredPRD,
    options?: ProviderOptions,
): Promise<ParseResult> => {
    options?.onStatus?.('Generating mockup...');
    const engine = getMockupEngine();
    if (engine === 'spec') {
        return runSpecEngine(prdContent, settings, structuredPRD, options);
    }
    return runHtmlEngine(prdContent, settings, structuredPRD, options);
};
