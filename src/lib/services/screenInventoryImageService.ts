// Pure helpers for the user-driven Screen Inventory image flow. The user
// copies the prompt below into an external image tool (Nano Banana, GPT
// image, etc.), generates outside the app, then uploads the result back
// onto the screen card. No API calls happen in here — this module is
// strictly prompt assembly so the renderer / store stay thin.

import type { ScreenItem } from '../../types';

interface ScreenImagePromptContext {
    /** Product title for grounding the mockup. */
    productTitle: string;
    /** 1–2 sentence product framing. Pass `structuredPRD.vision` or similar. */
    productSummary: string;
    /** Optional platform hint — defaults to "responsive web app screen". */
    platformHint?: 'mobile' | 'desktop' | 'responsive';
}

const PLATFORM_HINTS: Record<NonNullable<ScreenImagePromptContext['platformHint']>, string> = {
    mobile: 'mobile app screen, portrait orientation',
    desktop: 'desktop web app screen, landscape orientation',
    responsive: 'responsive web app screen',
};

/**
 * Build a copy-pasteable image-generation prompt for one screen-inventory
 * row. Tool-agnostic — the same string works in any modern image model
 * (Nano Banana / Gemini Imagen, GPT image, Midjourney, etc.).
 *
 * The structure mirrors `buildScreenImagePrompt` in `mockupImageService.ts`
 * but works from the screen-inventory data shape (which has no
 * `MockupSettings`), so we use sensible defaults for fidelity and platform.
 */
export const buildScreenInventoryImagePrompt = (
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

    return [
        `UI mockup of "${screen.name}" for the product "${context.productTitle}".`,
        `Screen purpose: ${screen.purpose}`,
        intentLine,
        `Product context: ${context.productSummary}`,
        componentsLine,
        navLine,
        stateLine,
        `Render as a ${platform}.`,
        `Style: mid-fidelity flat UI mockup, structured layout with clear hierarchy, neutral palette with one accent color, no decorative imagery.`,
        `Avoid lorem ipsum — use realistic placeholder copy that fits the screen purpose.`,
        `No watermarks, no logos of real companies, no photographic people.`,
    ].filter(Boolean).join(' ');
};
