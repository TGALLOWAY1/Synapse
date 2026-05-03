// Pure helpers for the OpenAI gpt-image-2 mockup-image path. No React, no
// IDB, no Zustand — just prompt assembly and size selection so the wiring
// store can stay thin.

import type { MockupPayload, MockupScreen, MockupSettings, MockupPlatform } from '../../types';

const FIDELITY_STYLE_HINTS: Record<string, string> = {
    low: 'low-fidelity wireframe sketch, neutral grey palette, simple boxes and labels, hand-drawn feel',
    mid: 'mid-fidelity flat UI mockup, structured layout with clear hierarchy, neutral palette with one accent color, no decorative imagery',
    high: 'high-fidelity polished product UI screenshot, modern SaaS aesthetic, careful typography, soft shadows, accent color used sparingly',
};

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
 * Grounded in the mockup payload + per-screen purpose so the resulting image
 * tracks what the HTML pipeline already committed to.
 */
export const buildScreenImagePrompt = (
    payload: MockupPayload,
    screen: MockupScreen,
    settings: MockupSettings,
): string => {
    const styleHint = FIDELITY_STYLE_HINTS[settings.fidelity] ?? FIDELITY_STYLE_HINTS.mid;
    const platformHint =
        settings.platform === 'mobile' ? 'mobile app screen, portrait orientation' :
        settings.platform === 'desktop' ? 'desktop web app screen, landscape orientation' :
        'responsive web app screen';

    const userStyle = settings.style?.trim();
    const styleSuffix = userStyle ? ` Visual direction: ${userStyle}.` : '';

    return [
        `UI mockup of "${screen.name}" for the product "${payload.title}".`,
        `Screen purpose: ${screen.purpose}`,
        `Product context: ${payload.summary}`,
        `Render as a ${platformHint}.`,
        `Style: ${styleHint}.${styleSuffix}`,
        `Avoid lorem ipsum — use realistic placeholder copy that fits the screen purpose.`,
        `No watermarks, no logos of real companies, no photographic people.`,
    ].join(' ');
};
