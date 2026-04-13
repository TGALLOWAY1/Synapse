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
import { assessMockupHtmlQuality, normalizeMockupHtml } from '../mockupQuality';
import { critiqueMockupAlignment, type MockupAlignmentCritique } from '../mockupAlignmentCritique';
import { PLACEHOLDER_PROMPT_CATALOG } from '../mockupPlaceholders';

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

// ---- Prompt construction ----

const buildSystemPrompt = (settings: MockupSettings): string => {
    const styleLine = settings.style ? `\nStyle direction from the user: ${settings.style}` : '';
    const notesLine = settings.notes ? `\nEmphasis from the user: ${settings.notes}` : '';

    return `You are a senior product designer at a top-tier SaaS company (think Linear, Notion, Vercel, Stripe). You generate high-fidelity UI *concepts* — not production code — for new products, grounded in a provided PRD. Your output MUST be valid JSON matching the provided response schema.

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

## Required layout contract per screen
- Every screen must include: (1) top-level app shell, (2) page header with title + primary action, (3) at least one primary content section, (4) at least one secondary/supporting section (filters, activity, details, etc.), and (5) at least one interactive control (button/input/select/tab).
- Spacing rhythm must follow Tailwind scale 2/3/4/6/8. Avoid arbitrary values unless necessary for framing.
- Keep line lengths realistic; avoid giant text blocks.
- Avoid placeholder labels; every label should reflect the product domain.
- If scope is workflow, each screen must represent a distinct step in that workflow with continuity in naming and entities.

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

${FIDELITY_INSTRUCTIONS[settings.fidelity]}
${PLATFORM_INSTRUCTIONS[settings.platform]}
${SCOPE_INSTRUCTIONS[settings.scope]}${styleLine}${notesLine}

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
    };
};

// ---- Public API ----

export const generateMockup = async (
    prdContent: string,
    settings: MockupSettings,
    structuredPRD?: StructuredPRD,
    options?: ProviderOptions,
): Promise<ParseResult> => {
    options?.onStatus?.('Generating mockup...');

    const system = buildSystemPrompt(settings);
    const user = buildUserPrompt(prdContent, structuredPRD);

    const raw = await callGemini(system, user, {
        responseMimeType: 'application/json',
        responseSchema: mockupSchema,
    });

    return parseMockupPayload(raw, prdContent, settings, structuredPRD);
};
