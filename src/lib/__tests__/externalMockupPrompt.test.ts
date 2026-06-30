import { describe, expect, it } from 'vitest';
import type { MockupPayload, MockupScreen, MockupSettings, ScreenItem } from '../../types';
import { buildExternalMockupPrompt } from '../services/screenInventoryImageService';
import { buildScreenImagePrompt } from '../services/mockupImageService';
import { buildDesignSystemBrief } from '../designTokens';
import { normalizeDesignTokens } from '../designTokens/normalize';

const screen: ScreenItem = {
    name: 'Triage Queue',
    priority: 'P0',
    purpose: 'Review urgent patient cases and assign a triage owner.',
    userIntent: 'Find the most urgent case quickly.',
    coreUIElements: ['Case list table', 'Urgency filter', 'Assign owner CTA'],
    entryPoints: ['Dashboard'],
    exitPaths: [{ label: 'Open case', target: 'Case Detail' }],
    states: [
        { name: 'Empty', description: 'No cases in queue' },
        { name: 'Loading', description: 'Fetching cases' },
    ],
};

const context = {
    productTitle: 'ClinicFlow',
    productSummary: 'Coordinate clinic intake and triage decisions in one place.',
    platformHint: 'desktop' as const,
};

// A design system distinctive enough that its values appear verbatim.
const tokens = normalizeDesignTokens({
    colors: { 'brand.primary': '#FF5722', 'surface.app': '#101418' },
    typography: { 'heading.lg': { font: 'Outfit', size: 30, weight: 800, lineHeight: 1.2 } },
});

describe('buildExternalMockupPrompt (Screen Inventory copy prompt)', () => {
    it('includes the Design System Brief when design tokens are available', () => {
        const prompt = buildExternalMockupPrompt(screen, { ...context, designTokens: tokens });
        // The shared brief content is embedded verbatim.
        expect(prompt).toContain(buildDesignSystemBrief(tokens));
        // And concrete design-system values flow through.
        expect(prompt).toContain('#FF5722');
        expect(prompt).toContain('Outfit');
        // It should NOT keep the generic "neutral palette" claim that would
        // contradict the design system.
        expect(prompt).not.toContain('neutral palette with one accent color');
    });

    it('still produces a usable prompt when no design system exists', () => {
        const prompt = buildExternalMockupPrompt(screen, context);
        // Falls back to the generic neutral style hint.
        expect(prompt).toContain('neutral palette with one accent color');
        // No design-system brief leakage.
        expect(prompt).not.toContain('Follow this design system exactly');
        // Still a complete, grounded prompt.
        expect(prompt).toContain('UI mockup of "Triage Queue"');
        expect(prompt).toContain('ClinicFlow');
    });

    it('preserves all the screen-specific context', () => {
        const prompt = buildExternalMockupPrompt(screen, { ...context, designTokens: tokens });
        expect(prompt).toContain('Triage Queue');                       // screen name
        expect(prompt).toContain('Review urgent patient cases');        // purpose
        expect(prompt).toContain('Find the most urgent case quickly');  // user intent
        expect(prompt).toContain('Coordinate clinic intake');           // product context
        expect(prompt).toContain('Case list table');                    // key UI elements
        expect(prompt).toContain('reachable from Dashboard');           // navigation (entry)
        expect(prompt).toContain('navigates to Case Detail');           // navigation (exit)
        expect(prompt).toContain('desktop web app screen');             // responsive target
        expect(prompt).toContain('Empty');                              // alternate states
        expect(prompt).toContain('Loading');
    });

    it('stays concise — not an enormous prompt', () => {
        const prompt = buildExternalMockupPrompt(screen, { ...context, designTokens: tokens });
        // A complete spec, but nowhere near the wall-of-text the full
        // `tokensToPromptSnippet` catalog would produce for an image tool.
        expect(prompt.length).toBeLessThan(2400);
    });
});

describe('shared design-system source across mockup paths', () => {
    it('internal mockup and external screen prompts embed the same brief', () => {
        const mockupScreen: MockupScreen = {
            id: 's1',
            name: 'Triage Queue',
            purpose: 'Review urgent patient cases and assign a triage owner.',
            priority: 'P0',
            coreUIElements: ['Case list table'],
        };
        const payload: MockupPayload = {
            version: 'mockup_spec_v1',
            title: 'ClinicFlow',
            summary: 'Coordinate clinic intake and triage decisions in one place.',
            screens: [mockupScreen],
        };
        const settings: MockupSettings = { platform: 'desktop', fidelity: 'mid', scope: 'multi_screen' };

        const internalPrompt = buildScreenImagePrompt(payload, mockupScreen, settings, tokens);
        const externalPrompt = buildExternalMockupPrompt(screen, { ...context, designTokens: tokens });

        const brief = buildDesignSystemBrief(tokens);
        expect(internalPrompt).toContain(brief);
        expect(externalPrompt).toContain(brief);
    });
});
