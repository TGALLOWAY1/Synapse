// Pure helpers for the OpenAI gpt-image-2 mockup-image path. No React, no
// IDB, no Zustand — just prompt assembly and size selection so the wiring
// store can stay thin.

import type { DesignTokens, MockupPayload, MockupScreen, MockupSettings, MockupPlatform } from '../../types';
import { buildDesignSystemBrief } from '../designTokens';
import { IMAGE_PLATFORM_HINTS, IMAGE_CLOSING_RULES, fidelityStyleHint } from '../prompts/imagePromptFragments';

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
