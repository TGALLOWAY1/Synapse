// Shared fragments for the image-prompt builders — the internal gpt-image-2
// path (mockupImageService.buildScreenImagePrompt), the internal Nano Banana
// path (buildGeminiScreenImagePrompt / mockupVariantRequest's Gemini variant
// builder), and the user-copied external prompt (screenInventoryImageService.
// buildExternalMockupPrompt). They live here once so the prompts cannot drift
// apart.

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

// ---------------------------------------------------------------------------
// Nano Banana (Gemini image) fragments
// ---------------------------------------------------------------------------
//
// Google's prompting guidance for its Gemini image models differs from the
// keyword-style gpt-image-2 prompt above in ways these fragments encode:
//   - "Describe the scene, don't just list keywords": the builders write
//     narrative sentences, opening with the medium and the image's purpose.
//   - Control composition explicitly (framing / "camera" language): a flat,
//     straight-on screen capture that fills the frame.
//   - Put exact on-screen words in quotes and describe the typography.
//   - "Semantic negative prompts": state what the image IS rather than a list
//     of bans — the closing rules below are the positively framed
//     counterparts of IMAGE_CLOSING_RULES.
// The aspect ratio and resolution go through the API's imageConfig, not prose.

/** Opening framing for a Nano Banana mockup prompt — medium, composition and
 * purpose in one descriptive sentence pair. A low-fidelity request is framed
 * as a wireframe so the opening never contradicts the wireframe style hint. */
export const nanoBananaMockupFraming = (subject: string, platformHint: string, fidelity: string): string =>
    fidelity === 'low'
        ? `Create a low-fidelity UI wireframe: a flat, straight-on view of ${subject}, drawn as a ${platformHint}, with the layout filling the entire frame edge to edge. ` +
          'It is for a product-requirements review, so its structure should read clearly at a glance.'
        : `Create a UI design mockup: a flat, straight-on screen capture of ${subject}, shown as a ${platformHint}, with the interface filling the entire frame edge to edge. ` +
          'It is for a product-requirements review, so it should read as a real, working product screen.';

/** Text-rendering guidance: exact title in quotes + typography (Google: quote
 * the words, describe the font, keep text short and legible). The quoted title
 * is declared the ONLY literal text — without that, Nano Banana prints spec
 * names verbatim (live renders showed "MapCanvas" chips and a "Weather Summary
 * Card" heading). With a Design System Brief in the same prompt the brief
 * names the fonts, so the rule defers to it instead of a generic sans-serif. */
export const nanoBananaTextRule = (title: string, hasDesignSystem: boolean): string =>
    `Wherever the layout shows a page title, it reads "${title}". That quoted title is the only exact on-screen text in this brief: the element, component and goal descriptions describe the design, so write short, natural labels for them instead of printing them. Render every heading, label and button as crisp, correctly spelled, legible text in ${hasDesignSystem ? "the design system's typefaces" : 'a clean sans-serif'}, with realistic copy that fits the screen's purpose.`;

/** Positively framed closing rules for Nano Banana prompts. */
export const NANO_BANANA_CLOSING_RULES = [
    'The interface itself is the whole image: a clean, front-on capture with no device bezel, hands, desk or design-tool canvas around it.',
    'The product uses an original, fictional brand; people appear as initial avatars or simple illustrations, and the image carries no watermark.',
] as const;
