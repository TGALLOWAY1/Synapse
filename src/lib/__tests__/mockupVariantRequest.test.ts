import { describe, expect, it } from 'vitest';
import type { ScreenItem } from '../../types';
import { buildScreenIndex } from '../screenExperience';
import { buildScreenMockupVariants } from '../mockupVariants';
import {
    buildVariantCoverageManifest,
    buildVariantGenerationRequest,
    buildVariantImagePrompt,
    type VariantRequestContext,
} from '../mockupVariantRequest';

const CTX: VariantRequestContext = {
    projectName: 'Acme',
    productSummary: 'A product for teams.',
    fidelity: 'high',
};

const richScreen: ScreenItem = {
    id: 'scr-home',
    name: 'Home Dashboard',
    priority: 'P0',
    purpose: 'Landing surface.',
    userIntent: 'See recent activity.',
    coreUIElements: ['Activity feed', 'Header bar'],
    exitPaths: [{ label: 'Open settings', target: 'Settings' }],
    handoff: { events: [{ name: 'Refresh feed' }] },
    acceptanceCriteria: ['Feed loads within 2s'],
    risks: ['Empty first-run experience'],
    states: [
        { name: 'Default', description: 'Shows the feed', type: 'default' },
        {
            name: 'Empty History', description: 'No activity yet', type: 'empty',
            needsMockup: true, trigger: 'User has no events', systemBehavior: 'Show onboarding CTA',
            acceptanceCriteria: ['Shows a "Get started" button'],
        },
    ],
};

function variantsFor(screen: ScreenItem) {
    const index = buildScreenIndex(
        { sections: [{ title: 'Main', screens: [screen] }] }, [], null,
    );
    // mobileRelevant so the Mobile · Default variant is recommended (these
    // tests exercise mobile-variant request/prompt/manifest building).
    return { item: index.items[0], variants: buildScreenMockupVariants(index.items[0], { mobileRelevant: true }) };
}

describe('buildVariantGenerationRequest', () => {
    it('includes viewport and state and derives spec fields', () => {
        const { item, variants } = variantsFor(richScreen);
        const mobile = variants.find(v => v.id === 'mobile:default')!;
        const req = buildVariantGenerationRequest(item.screen, item.id, mobile, CTX);
        expect(req.viewport).toBe('mobile');
        expect(req.stateName).toBe('Default');
        expect(req.priority).toBe('P0');
        expect(req.coreUIRegions).toEqual(['Activity feed', 'Header bar']);
        expect(req.userActions).toEqual(['Refresh feed', 'Open settings']);
        expect(req.acceptanceCriteria).toEqual(['Feed loads within 2s']);
        expect(req.risks).toEqual(['Empty first-run experience']);
    });

    it('pulls state-specific trigger/behavior/criteria for a state variant', () => {
        const { item, variants } = variantsFor(richScreen);
        const empty = variants.find(v => v.stateName === 'Empty History')!;
        const req = buildVariantGenerationRequest(item.screen, item.id, empty, CTX);
        expect(req.stateType).toBe('empty');
        expect(req.stateTrigger).toBe('User has no events');
        expect(req.stateBehavior).toBe('Show onboarding CTA');
        // State-level acceptance criteria win over screen-level.
        expect(req.acceptanceCriteria).toEqual(['Shows a "Get started" button']);
    });

    it('produces a valid request for a sparse screen (no states/spec)', () => {
        const { item, variants } = variantsFor({ name: 'Sparse' } as ScreenItem);
        const dflt = variants.find(v => v.id === 'default')!;
        const req = buildVariantGenerationRequest(item.screen, item.id, dflt, CTX);
        expect(req.coreUIRegions).toEqual([]);
        expect(req.userActions).toEqual([]);
        expect(req.acceptanceCriteria).toEqual([]);
        expect(req.viewport).toBe('desktop');
        expect(req.stateName).toBe('Default');
    });
});

describe('buildVariantImagePrompt', () => {
    it('scopes the prompt to the exact viewport + state and forbids other states', () => {
        const { item, variants } = variantsFor(richScreen);
        const empty = variants.find(v => v.stateName === 'Empty History')!;
        const req = buildVariantGenerationRequest(item.screen, item.id, empty, CTX);
        const prompt = buildVariantImagePrompt(req);
        expect(prompt).toContain('Viewport: desktop. State: Empty History.');
        expect(prompt).toContain('EMPTY state');
        expect(prompt).toContain('Do not create a generic default screen');
    });

    it('emphasizes a realistic mobile viewport for mobile variants', () => {
        const { item, variants } = variantsFor(richScreen);
        const mobile = variants.find(v => v.id === 'mobile:default')!;
        const req = buildVariantGenerationRequest(item.screen, item.id, mobile, CTX);
        const prompt = buildVariantImagePrompt(req);
        expect(prompt).toContain('mobile app screen');
        expect(prompt).toContain('do not simply shrink a desktop layout');
    });
});

describe('buildVariantCoverageManifest', () => {
    it('marks requested spec items covered and reports aligned when content exists', () => {
        const { item, variants } = variantsFor(richScreen);
        const mobile = variants.find(v => v.id === 'mobile:default')!;
        const req = buildVariantGenerationRequest(item.screen, item.id, mobile, CTX);
        const manifest = buildVariantCoverageManifest(req);
        expect(manifest.estimated).toBe(true);
        expect(manifest.overallStatus).toBe('aligned');
        expect(manifest.uiRegions.every(r => r.status === 'covered')).toBe(true);
        expect(manifest.states[0]).toMatchObject({ label: 'Default', status: 'covered' });
        expect(manifest.variant).toEqual({ viewport: 'mobile', stateName: 'Default' });
    });

    it('reports unknown with a warning for a sparse screen', () => {
        const { item, variants } = variantsFor({ name: 'Sparse' } as ScreenItem);
        const dflt = variants.find(v => v.id === 'default')!;
        const req = buildVariantGenerationRequest(item.screen, item.id, dflt, CTX);
        const manifest = buildVariantCoverageManifest(req);
        expect(manifest.overallStatus).toBe('unknown');
        expect(manifest.warnings.length).toBeGreaterThan(0);
    });
});
