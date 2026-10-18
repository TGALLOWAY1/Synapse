// Pure helpers for the mockup-image paths (OpenAI gpt-image-2 and Google Nano
// Banana 2.1). No React, no IDB, no Zustand — just prompt assembly and
// size / aspect-ratio selection so the wiring stores can stay thin.

import type { DesignTokens, MockupImageQuality, MockupPayload, MockupScreen, MockupSettings, MockupPlatform } from '../../types';
import { buildDesignSystemBrief } from '../designTokens';
import {
    IMAGE_PLATFORM_HINTS,
    IMAGE_CLOSING_RULES,
    NANO_BANANA_CLOSING_RULES,
    fidelityStyleHint,
    nanoBananaMockupFraming,
    nanoBananaTextRule,
} from '../prompts/imagePromptFragments';

/**
 * Pick an image size string (gpt-image-2 format `WIDTHxHEIGHT`) appropriate
 * to the mockup platform. Mobile gets a portrait crop; desktop gets a
 * landscape crop; responsive falls back to a square.
 */
export const pickImageSize = (platform: MockupPlatform): string => {
    switch (platform) {
        case 'mobile':
            return '1024x1536';
        case 'desktop':
            return '1536x1024';
        case 'responsive':
        default:
            return '1024x1024';
    }
};

/** The shape a render should take: the mockup set's platform, optionally
 * narrowed by a variant's own viewport. */
export interface MockupImageShape {
    platform: MockupPlatform;
    viewport?: 'desktop' | 'mobile' | 'tablet';
}

/** gpt-image-2 size for a shape: a variant's mobile / desktop viewport wins;
 * tablet keeps the mockup set's platform crop. */
export const pickOpenAIImageSize = (shape: MockupImageShape): string =>
    pickImageSize(
        shape.viewport === 'mobile' ? 'mobile'
            : shape.viewport === 'desktop' ? 'desktop'
                : shape.platform,
    );

/**
 * Nano Banana aspect ratio (`imageConfig.aspectRatio`) for a shape. Google
 * recommends setting the format through the config rather than the prompt:
 * phones are tall (9:16), desktop is widescreen (16:9), tablet is landscape
 * 4:3 (matching the "landscape orientation" tablet prompt), and a responsive
 * screen stays square like its gpt-image-2 crop.
 */
export const pickGeminiAspectRatio = (shape: MockupImageShape): string => {
    switch (shape.viewport ?? shape.platform) {
        case 'mobile':
            return '9:16';
        case 'desktop':
            return '16:9';
        case 'tablet':
            return '4:3';
        default:
            return '1:1';
    }
};

/**
 * Nano Banana resolution per Synapse quality tier: a 1K draft, 2K for medium,
 * and 2K with extended thinking for high (more deliberate layout and text).
 * Never 4K: a 4K render runs well past the ~4.5 MB per-image snapshot request
 * and toward the 15 MB Blob sync cap, and mockup previews display far smaller.
 */
export const pickGeminiImageConfig = (
    quality: MockupImageQuality,
): { imageSize: '1K' | '2K'; thinkingLevel?: 'HIGH' } =>
    quality === 'low' ? { imageSize: '1K' }
        : quality === 'medium' ? { imageSize: '2K' }
            : { imageSize: '2K', thinkingLevel: 'HIGH' };

/**
 * Build the natural-language prompt sent to gpt-image-2 for a single screen.
 * Tightly coupled to the upstream artifacts:
 *   - The MockupScreen's `coreUIElements` (from screen_inventory) describes
 *     what semantic elements the screen contains.
 *   - The MockupScreen's `componentRefs` (matched against component_inventory)
 *     names the reusable components the screen composes.
 *   - `designTokens` (from design_system) supplies the brand palette,
 *     typography, and radius targets.
 */
export const buildScreenImagePrompt = (
    payload: MockupPayload,
    screen: MockupScreen,
    settings: MockupSettings,
    designTokens?: DesignTokens,
): string => {
    // When a Design System Brief is appended (designTokens present), the
    // token-aware hint drops the generic palette claims so the prompt cannot
    // simultaneously ask for a "neutral palette" and a full brand palette.
    const styleHint = fidelityStyleHint(settings.fidelity, Boolean(designTokens));
    const platformHint =
        settings.platform === 'mobile' ? IMAGE_PLATFORM_HINTS.mobile :
        settings.platform === 'desktop' ? IMAGE_PLATFORM_HINTS.desktop :
        IMAGE_PLATFORM_HINTS.responsive;

    const userStyle = settings.style?.trim();
    const styleSuffix = userStyle ? ` Visual direction: ${userStyle}.` : '';
    const tokenBrief = designTokens
        ? ` ${buildDesignSystemBrief(designTokens)}`
        : '';

    const intentLine = screen.userIntent
        ? `User intent: ${screen.userIntent}.`
        : '';
    const uiElementsLine = screen.coreUIElements?.length
        ? `Layout must include these semantic UI elements: ${screen.coreUIElements.join('; ')}.`
        : '';
    const componentsLine = screen.componentRefs?.length
        ? `Compose the layout from these reusable components: ${screen.componentRefs.join('; ')}. Render each component consistently.`
        : '';
    const priorityLine = screen.priority === 'P0'
        ? 'This is a P0 screen (essential to the main product loop) — give it the most polished, central treatment.'
        : '';

    return [
        `UI mockup of "${screen.name}" for the product "${payload.title}".`,
        `Screen purpose: ${screen.purpose}`,
        intentLine,
        uiElementsLine,
        componentsLine,
        priorityLine,
        `Product context: ${payload.summary}`,
        `Render as a ${platformHint}.`,
        `Style: ${styleHint}.${styleSuffix}${tokenBrief}`,
        ...IMAGE_CLOSING_RULES,
    ].filter(Boolean).join(' ');
};

/**
 * Nano Banana (Gemini image) counterpart of `buildScreenImagePrompt`. Same
 * screen facts — purpose, intent, UI elements, components, priority, product
 * context, fidelity style and the Design System Brief — written the way
 * Google's image-prompting guidance recommends (see the Nano Banana fragments
 * in imagePromptFragments.ts): short descriptive paragraphs that open with the
 * medium, composition and purpose; the on-screen title quoted with its
 * typography; context marked as background so it isn't rendered as copy; and
 * positively framed closing rules.
 */
export const buildGeminiScreenImagePrompt = (
    payload: MockupPayload,
    screen: MockupScreen,
    settings: MockupSettings,
    designTokens?: DesignTokens,
): string => {
    const hasDesignSystem = Boolean(designTokens);
    const platformHint =
        settings.platform === 'mobile' ? IMAGE_PLATFORM_HINTS.mobile :
        settings.platform === 'desktop' ? IMAGE_PLATFORM_HINTS.desktop :
        IMAGE_PLATFORM_HINTS.responsive;
    const userStyle = settings.style?.trim();

    const paragraphs: string[][] = [
        [nanoBananaMockupFraming(`the "${screen.name}" screen of the product "${payload.title}"`, platformHint, settings.fidelity)],
        [
            `Screen purpose: ${screen.purpose}`,
            screen.userIntent ? `The user's goal here: ${screen.userIntent}.` : '',
            screen.priority === 'P0'
                ? 'This is a P0 screen, essential to the main product loop, so give it the most polished, central treatment.'
                : '',
        ],
        [
            screen.coreUIElements?.length
                ? `Lay the screen out with a clear visual hierarchy that includes these UI elements: ${screen.coreUIElements.join('; ')}.`
                : '',
            screen.componentRefs?.length
                ? `Build it from these reusable design-system components (internal names, so draw them without printing the names), consistent wherever they repeat: ${screen.componentRefs.join('; ')}.`
                : '',
        ],
        [nanoBananaTextRule(screen.name, hasDesignSystem)],
        [`Product context (background for you, not on-screen copy): ${payload.summary}`],
        [
            `Visual style: ${fidelityStyleHint(settings.fidelity, hasDesignSystem)}.`,
            userStyle ? `Visual direction: ${userStyle}.` : '',
            designTokens ? buildDesignSystemBrief(designTokens) : '',
        ],
        [...NANO_BANANA_CLOSING_RULES],
    ];
    return paragraphs
        .map((sentences) => sentences.filter(Boolean).join(' '))
        .filter(Boolean)
        .join('\n\n');
};
