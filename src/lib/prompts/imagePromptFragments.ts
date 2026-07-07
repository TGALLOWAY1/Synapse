// Shared fragments for the two image-prompt builders — the internal
// gpt-image-2 path (mockupImageService.buildScreenImagePrompt) and the
// user-copied external prompt (screenInventoryImageService.
// buildExternalMockupPrompt). They live here once so the two prompts cannot
// drift apart.

/** Platform rendering hints, shared by both image prompt builders. */
export const IMAGE_PLATFORM_HINTS = {
    mobile: 'mobile app screen, portrait orientation',
    desktop: 'desktop web app screen, landscape orientation',
    responsive: 'responsive web app screen',
} as const;

export type ImagePlatformHintKey = keyof typeof IMAGE_PLATFORM_HINTS;

/** Closing rules appended to every screen-image prompt. */
export const IMAGE_CLOSING_RULES = [
    'Avoid lorem ipsum — use realistic placeholder copy that fits the screen purpose.',
    'No watermarks, no logos of real companies, no photographic people.',
] as const;

type FidelityKey = 'low' | 'mid' | 'high';

// Base fidelity hints — used when the project has NO design system, where the
// generic "neutral palette with one accent color" fallback keeps the prompt
// self-sufficient.
const BASE_FIDELITY_STYLE_HINTS: Record<FidelityKey, string> = {
    low: 'low-fidelity wireframe, neutral grey palette, simple rectangular placeholders and labels, sketch-style linework, no imagery',
    mid: 'mid-fidelity flat UI mockup, structured layout with clear visual hierarchy, neutral palette with one accent color, no decorative imagery',
    high: 'high-fidelity polished product UI screenshot, clean contemporary product styling, precise typography, soft shadows, accent color used sparingly',
};

// Design-system-aware variants — used when a Design System Brief is appended
// to the same prompt. The brief dictates the palette, so the generic palette
// claims ("neutral palette with one accent color", "accent color used
// sparingly") are dropped: sending both told the image model to be neutral
// AND to follow a full brand palette at once. The low-fidelity wireframe hint
// keeps its grey palette on purpose — a wireframe is deliberately unbranded.
const TOKEN_AWARE_FIDELITY_STYLE_HINTS: Record<FidelityKey, string> = {
    low: BASE_FIDELITY_STYLE_HINTS.low,
    mid: 'mid-fidelity flat UI mockup, structured layout with clear visual hierarchy, no decorative imagery',
    high: 'high-fidelity polished product UI screenshot, clean contemporary product styling, precise typography, soft shadows',
};

/**
 * Resolve the fidelity style hint for a prompt. Pass `hasDesignSystem: true`
 * whenever the prompt also embeds the Design System Brief so the hint cannot
 * contradict the brief's palette. Unknown fidelity values fall back to `mid`.
 */
export const fidelityStyleHint = (
    fidelity: string,
    hasDesignSystem: boolean,
): string => {
    const table = hasDesignSystem ? TOKEN_AWARE_FIDELITY_STYLE_HINTS : BASE_FIDELITY_STYLE_HINTS;
    return table[fidelity as FidelityKey] ?? table.mid;
};
