// Pure helpers for the user-driven Screen Inventory image flow. The user
// copies the prompt below into an external image tool (Nano Banana, GPT
// image, etc.), generates outside the app, then uploads the result back
// onto the screen card. No API calls happen in here — this module is
// strictly prompt assembly so the renderer / store stay thin.

import type { DesignTokens, ScreenItem } from '../../types';
import { buildDesignSystemBrief } from '../designTokens';
import { IMAGE_PLATFORM_HINTS, IMAGE_CLOSING_RULES, fidelityStyleHint } from '../prompts/imagePromptFragments';

interface ScreenImagePromptContext {
    /** Product title for grounding the mockup. */
    productTitle: string;
    /** 1–2 sentence product framing. Pass `structuredPRD.vision` or similar. */
    productSummary: string;
    /** Optional platform hint — defaults to "responsive web app screen". */
    platformHint?: 'mobile' | 'desktop' | 'responsive';
    /**
     * The project's active Design System tokens, when available. When present
     * the prompt embeds a concise Design System Brief (the SAME brief the
     * internal gpt-image-2 mockup path uses) so externally generated mockups
     * follow the project's intended visual language instead of drifting to a
     * generic "neutral palette" look. Legacy projects without a design system
     * still get a complete, working prompt.
     */
    designTokens?: DesignTokens;
}

// Shared with the internal gpt-image-2 builder — see imagePromptFragments.
const PLATFORM_HINTS = IMAGE_PLATFORM_HINTS;

/**
 * Build a copy-pasteable image-generation prompt for one screen-inventory
 * row. Tool-agnostic — the same string works in any modern image model
 * (Nano Banana / Gemini Imagen, GPT image, Midjourney, etc.).
 *
 * Two halves, neither duplicated elsewhere:
 *   - Screen context (name, purpose, intent, product framing, key UI
 *     elements, navigation, state, responsive target, alternate states)
 *     drawn from the screen-inventory data shape.
 *   - A Design System Brief from `buildDesignSystemBrief` — the SAME shared
 *     source the internal mockup image path uses — so the two stay visually
 *     consistent. Omitted only when the project has no design system yet, in
 *     which case a neutral fallback style hint keeps the prompt usable.
 */
export const buildExternalMockupPrompt = (
    screen: ScreenItem,
    context: ScreenImagePromptContext,
): string => {
    const platform = PLATFORM_HINTS[context.platformHint ?? 'responsive'];
    const ui = (screen.coreUIElements && screen.coreUIElements.length > 0)
        ? screen.coreUIElements
        : (screen.components ?? []);
    const componentsLine = ui.length > 0
        ? `Key UI elements on this screen: ${ui.join(', ')}.`
        : '';

    const intentLine = screen.userIntent ? `User intent: ${screen.userIntent}` : '';

    const entry = (screen.entryPoints && screen.entryPoints.length > 0)
        ? screen.entryPoints
        : (screen.navigationFrom ?? []);
    const exits = (screen.exitPaths && screen.exitPaths.length > 0)
        ? screen.exitPaths.map(p => p.target)
        : (screen.navigationTo ?? []);
    const navParts: string[] = [];
    if (entry.length > 0) navParts.push(`reachable from ${entry.join(', ')}`);
    if (exits.length > 0) navParts.push(`navigates to ${exits.join(', ')}`);
    const navLine = navParts.length > 0 ? `Navigation context: ${navParts.join('; ')}.` : '';

    const stateLine = screen.states && screen.states.length > 0
        ? `Render the default / primary state. Other states modeled: ${screen.states.map(s => s.name).join(', ')}.`
        : '';

    // When the project has a design system, the brief dictates the palette,
    // typography, radius, etc. — so the shared token-aware hint drops the
    // generic "neutral palette with one accent color" claim that would
    // otherwise contradict it. Without a design system the neutral fallback
    // keeps the prompt self-sufficient.
    const tokens = context.designTokens;
    const styleLine = `Style: ${fidelityStyleHint('mid', Boolean(tokens))}.`;
    const designBriefLine = tokens ? buildDesignSystemBrief(tokens) : '';

    return [
        `UI mockup of "${screen.name}" for the product "${context.productTitle}".`,
        `Screen purpose: ${screen.purpose}`,
        intentLine,
        `Product context: ${context.productSummary}`,
        componentsLine,
        navLine,
        stateLine,
        `Render as a ${platform}.`,
        styleLine,
        designBriefLine,
        ...IMAGE_CLOSING_RULES,
    ].filter(Boolean).join(' ');
};
