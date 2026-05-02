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
    const componentsLine = screen.components && screen.components.length > 0
        ? `Key UI components on this screen: ${screen.components.join(', ')}.`
        : '';
    const navParts: string[] = [];
    if (screen.navigationFrom && screen.navigationFrom.length > 0) {
        navParts.push(`reachable from ${screen.navigationFrom.join(', ')}`);
    }
    if (screen.navigationTo && screen.navigationTo.length > 0) {
        navParts.push(`navigates to ${screen.navigationTo.join(', ')}`);
    }
    const navLine = navParts.length > 0 ? `Navigation context: ${navParts.join('; ')}.` : '';

    return [
        `UI mockup of "${screen.name}" for the product "${context.productTitle}".`,
        `Screen purpose: ${screen.purpose}`,
        `Product context: ${context.productSummary}`,
        componentsLine,
        navLine,
        `Render as a ${platform}.`,
        `Style: mid-fidelity flat UI mockup, structured layout with clear hierarchy, neutral palette with one accent color, no decorative imagery.`,
        `Avoid lorem ipsum — use realistic placeholder copy that fits the screen purpose.`,
        `No watermarks, no logos of real companies, no photographic people.`,
    ].filter(Boolean).join(' ');
};
