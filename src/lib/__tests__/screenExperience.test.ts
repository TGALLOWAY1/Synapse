import { describe, expect, it } from 'vitest';
import {
    EMPTY_SCREEN_EXPERIENCE_INDEX,
    buildScreenIndex,
    groupFlowRefsByFlow,
    stepScreenSlug,
} from '../screenExperience';
import { parseScreenInventory } from '../screenInventoryNormalize';
import { parseFlows } from '../../components/renderers/userFlows/parseFlow';
import type { MockupPayload, ScreenInventoryContent } from '../../types';

const INVENTORY: ScreenInventoryContent = {
    sections: [
        {
            title: 'Onboarding',
            description: 'First-run journey',
            flowSummary: 'Landing Page → Sign In → Dashboard',
            screens: [
                {
                    name: 'Landing Page',
                    priority: 'P0',
                    purpose: 'Introduce the product.',
                    entryPoints: ['Direct URL'],
                    exitPaths: [{ label: 'Get started', target: 'Sign In' }],
                },
                {
                    name: 'Sign In',
                    priority: 'P0',
                    purpose: 'Authenticate the user.',
                },
                {
                    name: 'Sign In Confirmation',
                    priority: 'P2',
                    purpose: 'Confirm a magic-link sign-in.',
                },
            ],
        },
        {
            title: 'Core',
            screens: [
                { name: 'Dashboard', priority: 'P0', purpose: 'Main workspace.' },
                { name: 'Settings', priority: 'P2', purpose: 'Preferences.' },
            ],
        },
    ],
};

const FLOWS_MARKDOWN = `### Flow: Onboarding
**Goal:** Get from landing to the dashboard.
**Preconditions:** None.
**Steps:**
1. [Landing Page] — User taps Get started → System routes to sign-in
2. [Sign In] — User authenticates → System creates a session
3. [Dashboard] — User lands on the dashboard → System loads workspace
**Success Outcome:** User reaches the dashboard.

### Flow: Session recovery
**Goal:** Recover an expired session.
**Preconditions:** Session expired.
**Steps:**
1. [Sign In] — User re-authenticates → System restores the session
2. [Dashboard] — User resumes work → System rehydrates state
**Success Outcome:** Session restored.`;

const MOCKUP_PAYLOAD: MockupPayload = {
    version: 'mockup_spec_v1',
    title: 'Test — UI Mockups',
    summary: 'Test mockups.',
    screens: [
        { id: 'uuid-1', name: 'Landing Page', purpose: 'Introduce the product.' },
        { id: 'uuid-2', name: 'Dashboard', purpose: 'Main workspace.' },
        // Drifted mockup screen with no inventory counterpart — must be ignored.
        { id: 'uuid-3', name: 'Unknown Screen', purpose: 'Renamed since generation.' },
    ],
};

describe('stepScreenSlug', () => {
    it('slugs the bracketed step title', () => {
        expect(stepScreenSlug({ title: 'Landing Page' })).toBe('landing-page');
    });

    it('strips markdown backticks before slugging', () => {
        expect(stepScreenSlug({ title: '`Import Dashboard`' })).toBe('import-dashboard');
    });

    it('returns null for steps without a usable title', () => {
        expect(stepScreenSlug({ title: undefined })).toBeNull();
        expect(stepScreenSlug({ title: '' })).toBeNull();
        // Would otherwise hit slugifyScreenName's `'screen'` fallback and
        // false-match a screen literally slugged "screen".
        expect(stepScreenSlug({ title: '``' })).toBeNull();
    });
});

describe('buildScreenIndex', () => {
    it('joins screens, flows, and mockups by slug', () => {
        const flows = parseFlows(FLOWS_MARKDOWN);
        const index = buildScreenIndex(INVENTORY, flows, MOCKUP_PAYLOAD);

        expect(index.items).toHaveLength(5);
        expect(index.availableSlugs.has('landing-page')).toBe(true);

        const landing = index.bySlug.get('landing-page');
        expect(landing?.screen.purpose).toBe('Introduce the product.');
        expect(landing?.sectionTitle).toBe('Onboarding');
        expect(landing?.relatedFlows).toHaveLength(1);
        expect(landing?.relatedFlows[0].flow.title).toBe('Onboarding');
        expect(landing?.relatedFlows[0].stepIndex).toBe(0);
        expect(landing?.mockupScreen?.id).toBe('uuid-1');

        // Sign In appears in both flows.
        const signIn = index.bySlug.get('sign-in');
        expect(signIn?.relatedFlows).toHaveLength(2);
        expect(signIn?.relatedFlows.map(r => r.flowIndex)).toEqual([0, 1]);
        expect(signIn?.mockupScreen).toBeUndefined();

        expect(index.collisions).toEqual([]);
    });

    it('preserves inventory section grouping', () => {
        const index = buildScreenIndex(INVENTORY, [], null);
        expect(index.sections.map(s => s.title)).toEqual(['Onboarding', 'Core']);
        expect(index.sections[0].items.map(i => i.slug)).toEqual([
            'landing-page', 'sign-in', 'sign-in-confirmation',
        ]);
        expect(index.sections[0].flowSummary).toBe('Landing Page → Sign In → Dashboard');
    });

    it('does not cross-match screens with similar names', () => {
        const flows = parseFlows(FLOWS_MARKDOWN);
        const index = buildScreenIndex(INVENTORY, flows, MOCKUP_PAYLOAD);
        // "Sign In Confirmation" must not inherit "Sign In" flows or mockups.
        const confirmation = index.bySlug.get('sign-in-confirmation');
        expect(confirmation).toBeDefined();
        expect(confirmation?.relatedFlows).toEqual([]);
        expect(confirmation?.mockupScreen).toBeUndefined();
    });

    it('handles a missing inventory with the stable empty index', () => {
        const flows = parseFlows(FLOWS_MARKDOWN);
        expect(buildScreenIndex(null, flows, MOCKUP_PAYLOAD)).toBe(EMPTY_SCREEN_EXPERIENCE_INDEX);
        expect(buildScreenIndex({ sections: [] }, flows, null)).toBe(EMPTY_SCREEN_EXPERIENCE_INDEX);
        // Referential stability across calls — selector-safe.
        expect(buildScreenIndex(null, [], null)).toBe(buildScreenIndex(null, [], null));
    });

    it('handles missing flows and missing mockups gracefully', () => {
        const index = buildScreenIndex(INVENTORY, [], null);
        expect(index.items).toHaveLength(5);
        for (const item of index.items) {
            expect(item.relatedFlows).toEqual([]);
            expect(item.mockupScreen).toBeUndefined();
        }
    });

    it('ignores mockup screens that no longer match an inventory screen', () => {
        const index = buildScreenIndex(INVENTORY, [], MOCKUP_PAYLOAD);
        const matched = index.items.filter(i => i.mockupScreen);
        expect(matched.map(i => i.slug).sort()).toEqual(['dashboard', 'landing-page']);
    });

    it('accepts legacy inventory shapes via parseScreenInventory normalization', () => {
        const legacyJson = JSON.stringify({
            groups: [
                {
                    name: 'Main',
                    screens: [
                        {
                            name: 'Home',
                            priority: 'core',
                            purpose: 'Legacy home screen.',
                            navigationTo: ['Detail'],
                        },
                    ],
                },
            ],
        });
        const normalized = parseScreenInventory(legacyJson);
        expect(normalized).not.toBeNull();
        const index = buildScreenIndex(normalized, [], null);
        expect(index.items).toHaveLength(1);
        expect(index.items[0].slug).toBe('home');
        expect(index.items[0].screen.priority).toBe('P0');
        expect(index.sections[0].title).toBe('Main');
    });

    it('detects slug collisions and keeps the first screen', () => {
        const colliding: ScreenInventoryContent = {
            sections: [
                {
                    title: 'A',
                    screens: [
                        { name: 'Sign-In', priority: 'P0', purpose: 'First.' },
                        { name: 'Sign In', priority: 'P1', purpose: 'Second.' },
                    ],
                },
            ],
        };
        const index = buildScreenIndex(colliding, [], null);
        expect(index.items).toHaveLength(1);
        expect(index.bySlug.get('sign-in')?.screen.purpose).toBe('First.');
        expect(index.collisions).toEqual([
            { slug: 'sign-in', names: ['Sign-In', 'Sign In'] },
        ]);
    });

    it('routes colliding-slug flow steps to the first (kept) screen', () => {
        const colliding: ScreenInventoryContent = {
            sections: [
                {
                    title: 'A',
                    screens: [
                        { name: 'Sign-In', priority: 'P0', purpose: 'First.' },
                        { name: 'Sign In', priority: 'P1', purpose: 'Second.' },
                    ],
                },
            ],
        };
        const flows = parseFlows(FLOWS_MARKDOWN);
        const index = buildScreenIndex(colliding, flows, null);
        expect(index.bySlug.get('sign-in')?.relatedFlows).toHaveLength(2);
    });
});

describe('groupFlowRefsByFlow', () => {
    it('groups multiple step refs of the same flow together', () => {
        const flows = parseFlows(`### Flow: Loop
**Goal:** Repeat visits to the dashboard.
**Steps:**
1. [Dashboard] — User opens → System loads
2. [Settings] — User tweaks → System saves
3. [Dashboard] — User returns → System refreshes
**Success Outcome:** Done.`);
        const index = buildScreenIndex(INVENTORY, flows, null);
        const dashboard = index.bySlug.get('dashboard');
        expect(dashboard?.relatedFlows).toHaveLength(2);
        const groups = groupFlowRefsByFlow(dashboard!.relatedFlows);
        expect(groups).toHaveLength(1);
        expect(groups[0].flow.title).toBe('Loop');
        expect(groups[0].steps.map(s => s.stepIndex)).toEqual([0, 2]);
    });

    it('returns an empty list for no refs', () => {
        expect(groupFlowRefsByFlow([])).toEqual([]);
    });
});
