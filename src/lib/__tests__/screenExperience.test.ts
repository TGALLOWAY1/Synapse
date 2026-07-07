import { describe, expect, it } from 'vitest';
import {
    EMPTY_SCREEN_EXPERIENCE_INDEX,
    buildScreenIndex,
    groupFlowRefsByFlow,
    readDismissedScreenIssues,
    readScreenEdits,
    readScreenLinks,
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

    it('detects slug collisions, keeps both screens, and resolves slug lookups to the first', () => {
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
        // Both screens survive as distinct items with unique canonical ids.
        expect(index.items).toHaveLength(2);
        expect(index.byId.get('sign-in')?.screen.purpose).toBe('First.');
        expect(index.byId.get('sign-in-2')?.screen.purpose).toBe('Second.');
        // Name-based lookups stay first-wins.
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

describe('stable screen ids', () => {
    it('derives canonical ids (content id first, else slug) and exposes byId', () => {
        const inv: ScreenInventoryContent = {
            sections: [
                {
                    title: 'A',
                    screens: [
                        { id: 'model-id-1', name: 'Landing Page', priority: 'P0', purpose: 'X.' },
                        { name: 'Dashboard', priority: 'P0', purpose: 'Y.' },
                    ],
                },
            ],
        };
        const index = buildScreenIndex(inv, [], null);
        expect(index.byId.get('model-id-1')?.slug).toBe('landing-page');
        expect(index.byId.get('dashboard')?.screen.purpose).toBe('Y.');
        expect(index.items.map(i => i.id)).toEqual(['model-id-1', 'dashboard']);
    });

    it('matches mockup screens by sourceScreenId ahead of name (rename-safe)', () => {
        const inv: ScreenInventoryContent = {
            sections: [
                {
                    title: 'A',
                    screens: [
                        { id: 'scr-dash', name: 'Dashboard', priority: 'P0', purpose: 'Main.' },
                    ],
                },
            ],
        };
        const payload: MockupPayload = {
            version: 'mockup_spec_v1',
            title: 'T',
            summary: 'S',
            screens: [
                // Name has drifted (would NOT slug-match "Dashboard"), but the
                // stable id still resolves it.
                { id: 'uuid-9', name: 'Dashboard (v2 layout)', purpose: 'Main.', sourceScreenId: 'scr-dash' },
            ],
        };
        const index = buildScreenIndex(inv, [], payload);
        expect(index.byId.get('scr-dash')?.mockupScreen?.id).toBe('uuid-9');
    });

    it('normalization stamps deterministic ids on legacy inventories (no regeneration needed)', () => {
        const legacyJson = JSON.stringify({
            sections: [
                {
                    title: 'A',
                    screens: [
                        { name: 'Home', priority: 'P0', purpose: 'X.' },
                        { name: 'Home', priority: 'P1', purpose: 'Dup.' },
                    ],
                },
            ],
        });
        const first = parseScreenInventory(legacyJson);
        const second = parseScreenInventory(legacyJson);
        // Deterministic across reads — same ids every time.
        expect(first?.sections[0].screens.map(s => s.id)).toEqual(['home', 'home-2']);
        expect(second?.sections[0].screens.map(s => s.id)).toEqual(['home', 'home-2']);
    });
});

describe('screen metadata edit overlay (rename safety)', () => {
    it('applies edits for display while keeping joins on the stored content', () => {
        const flows = parseFlows(FLOWS_MARKDOWN);
        const edits = {
            'sign-in': { name: 'Authentication', purpose: 'Edited purpose.', priority: 'P1' as const },
        };
        const index = buildScreenIndex(INVENTORY, flows, MOCKUP_PAYLOAD, edits);
        const item = index.byId.get('sign-in');
        // Display fields reflect the overlay…
        expect(item?.screen.name).toBe('Authentication');
        expect(item?.screen.purpose).toBe('Edited purpose.');
        expect(item?.screen.priority).toBe('P1');
        expect(item?.isEdited).toBe(true);
        // …but the stored screen, slug, and joins are untouched by the rename.
        expect(item?.baseScreen.name).toBe('Sign In');
        expect(item?.slug).toBe('sign-in');
        expect(item?.relatedFlows).toHaveLength(2);
        // A rename must also not steal another screen's identity: the edited
        // display name does NOT create a bySlug entry for "authentication".
        expect(index.bySlug.get('authentication')).toBeUndefined();
    });

    it('renaming a screen keeps its mockup attached (id/base-name join)', () => {
        const edits = { 'landing-page': { name: 'Welcome Splash' } };
        const index = buildScreenIndex(INVENTORY, [], MOCKUP_PAYLOAD, edits);
        const item = index.byId.get('landing-page');
        expect(item?.screen.name).toBe('Welcome Splash');
        expect(item?.mockupScreen?.id).toBe('uuid-1');
    });

    it('screens without an edit stay pristine (screen === baseScreen)', () => {
        const index = buildScreenIndex(INVENTORY, [], null, { 'sign-in': { purpose: 'X' } });
        const untouched = index.byId.get('dashboard');
        expect(untouched?.isEdited).toBe(false);
        expect(untouched?.screen).toBe(untouched?.baseScreen);
    });
});

describe('readScreenEdits', () => {
    it('extracts a valid overlay and drops malformed entries', () => {
        const edits = readScreenEdits({
            screenEdits: {
                'scr-1': { name: '  Renamed  ', purpose: 'P', priority: 'P2', notes: 'n' },
                'scr-2': { priority: 'not-a-priority', name: '   ' },
                'scr-3': 'garbage',
            },
        });
        expect(edits['scr-1']).toEqual({ name: 'Renamed', purpose: 'P', priority: 'P2', notes: 'n' });
        expect(edits['scr-2']).toBeUndefined();
        expect(edits['scr-3']).toBeUndefined();
    });

    it('returns the stable empty map for missing/invalid metadata', () => {
        expect(readScreenEdits(undefined)).toBe(readScreenEdits({}));
        expect(readScreenEdits({ screenEdits: 'nope' })).toBe(readScreenEdits(undefined));
    });
});

describe('reference validation issues', () => {
    it('flags screen-looking flow steps that match no screen (grouped per name)', () => {
        const flows = parseFlows(`### Flow: Broken
**Goal:** Test.
**Steps:**
1. [Onboarding Setup Page] — User starts → System shows setup
2. [Onboarding Setup Page] — User retries → System shows setup again
3. [Dashboard] — User lands → System loads
**Success Outcome:** Done.`);
        const index = buildScreenIndex(INVENTORY, flows, null);
        const flowIssues = index.issues.filter(i => i.kind === 'unmatched_flow_step');
        // Two steps, one missing screen → ONE grouped issue.
        expect(flowIssues).toHaveLength(1);
        expect(flowIssues[0].key).toBe('flowstep:onboarding-setup-page');
        expect(flowIssues[0].message).toContain('Onboarding Setup Page');
    });

    it('flags unmatched mockup screens as repairable issues', () => {
        const payload: MockupPayload = {
            version: 'mockup_spec_v1',
            title: 'T',
            summary: 'S',
            screens: [{ id: 'uuid-x', name: 'Totally Renamed Screen', purpose: 'Drifted.' }],
        };
        const index = buildScreenIndex(INVENTORY, [], payload);
        const issue = index.issues.find(i => i.kind === 'unmatched_mockup_screen');
        expect(issue?.mockupScreenId).toBe('uuid-x');
    });

    it('flags name-only mockup matches as legacy (informational) issues', () => {
        const index = buildScreenIndex(INVENTORY, [], MOCKUP_PAYLOAD);
        const legacy = index.issues.filter(i => i.kind === 'legacy_name_match');
        // uuid-1 (Landing Page) and uuid-2 (Dashboard) match by name only.
        expect(legacy.map(i => i.mockupScreenId).sort()).toEqual(['uuid-1', 'uuid-2']);
        // The current match is preserved and exposed for one-click pinning.
        expect(legacy[0].screenId).toBeDefined();
    });

    it('does not flag sourceScreenId matches as legacy', () => {
        const payload: MockupPayload = {
            version: 'mockup_spec_v1',
            title: 'T',
            summary: 'S',
            screens: [{ id: 'uuid-1', name: 'Landing Page', purpose: 'X.', sourceScreenId: 'landing-page' }],
        };
        const index = buildScreenIndex(INVENTORY, [], payload);
        expect(index.issues.filter(i => i.kind === 'legacy_name_match')).toEqual([]);
    });

    it('emits a slug_collision issue alongside the collisions list', () => {
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
        const issue = index.issues.find(i => i.kind === 'slug_collision');
        expect(issue?.key).toBe('collision:sign-in');
        expect(issue?.message).toContain('Sign-In');
    });
});


describe('mockup coverage classification', () => {
    it('treats partial mockup coverage as coverage, not a warning', () => {
        const inv: ScreenInventoryContent = { sections: [{ title: 'All', screens: Array.from({ length: 10 }, (_, i) => ({ id: `scr-${i + 1}`, name: `Screen ${i + 1}`, priority: i < 6 ? 'P0' : 'P2', purpose: 'Test.' })) }] };
        const payload: MockupPayload = { version: 'mockup_spec_v1', title: 'T', summary: 'S', screens: Array.from({ length: 6 }, (_, i) => ({ id: `mock-${i + 1}`, name: `Screen ${i + 1}`, purpose: 'Test.', sourceScreenId: `scr-${i + 1}` })) };
        const index = buildScreenIndex(inv, [], payload);
        expect(index.mockupCoverage.summary).toMatchObject({ totalScreens: 10, mockedScreens: 6, notMockedYetScreens: 4, trueIssues: 0 });
        expect(index.issues.filter(i => i.kind !== 'legacy_name_match')).toEqual([]);
    });

    it('classifies a flow step referencing a known screen without a mockup as not mocked yet', () => {
        const inv: ScreenInventoryContent = { sections: [{ title: 'All', screens: [{ id: 'scr-study-summary', name: 'Study Summary', priority: 'P2', purpose: 'Summarize.' }] }] };
        const flows = parseFlows(`### Flow: Study\n**Goal:** Test.\n**Steps:**\n1. [Study Summary] — User reviews → System displays summary\n**Success Outcome:** Done.`);
        const index = buildScreenIndex(inv, flows, { version: 'mockup_spec_v1', title: 'T', summary: 'S', screens: [] });
        expect(index.byId.get('scr-study-summary')?.relatedFlows).toHaveLength(1);
        expect(index.mockupCoverage.unmockedScreens).toEqual([{ screenId: 'scr-study-summary', screenName: 'Study Summary', reason: 'supporting_screen' }]);
        expect(index.issues.filter(i => i.kind !== 'legacy_name_match')).toEqual([]);
    });

    it('classifies a flow step referencing an unknown screen as a missing reference', () => {
        const flows = parseFlows(`### Flow: Broken\n**Goal:** Test.\n**Steps:**\n1. [Does Not Exist] — User taps → System opens it\n**Success Outcome:** Done.`);
        const index = buildScreenIndex(INVENTORY, flows, null);
        expect(index.issues.some(i => i.kind === 'unmatched_flow_step' && i.key === 'flowstep:does-not-exist')).toBe(true);
        expect(index.mockupCoverage.summary.trueIssues).toBe(1);
    });

    it('classifies a mockup referencing an unknown screen as a missing reference', () => {
        const payload: MockupPayload = { version: 'mockup_spec_v1', title: 'T', summary: 'S', screens: [{ id: 'mock-unknown', name: 'Unknown', purpose: 'No source.', sourceScreenId: 'scr-unknown' }] };
        const index = buildScreenIndex(INVENTORY, [], payload);
        expect(index.issues.some(i => i.kind === 'unmatched_mockup_screen' && i.mockupScreenId === 'mock-unknown')).toBe(true);
        expect(index.mockupCoverage.summary.trueIssues).toBe(1);
    });

    it('handles empty mockups as all screens available to generate without warnings', () => {
        const index = buildScreenIndex(INVENTORY, [], { version: 'mockup_spec_v1', title: 'T', summary: 'S', screens: [] });
        expect(index.mockupCoverage.summary).toMatchObject({ totalScreens: 5, mockedScreens: 0, notMockedYetScreens: 5, trueIssues: 0, coveragePercent: 0 });
        expect(index.mockupCoverage.unmockedScreens).toHaveLength(5);
        expect(index.issues.filter(i => i.kind !== 'legacy_name_match')).toEqual([]);
    });
});

describe('screen links (relink repairs)', () => {
    it('an explicit link outranks sourceScreenId and name matching', () => {
        const payload: MockupPayload = {
            version: 'mockup_spec_v1',
            title: 'T',
            summary: 'S',
            screens: [
                // Name matches "Dashboard", but the user linked it to Settings.
                { id: 'uuid-7', name: 'Dashboard', purpose: 'X.' },
            ],
        };
        const index = buildScreenIndex(INVENTORY, [], payload, {}, { 'uuid-7': 'settings' });
        expect(index.byId.get('settings')?.mockupScreen?.id).toBe('uuid-7');
        expect(index.byId.get('dashboard')?.mockupScreen).toBeUndefined();
        // A linked match is neither legacy nor unmatched.
        expect(index.issues.filter(i => i.mockupScreenId === 'uuid-7')).toEqual([]);
    });

    it('readScreenLinks / readDismissedScreenIssues tolerate junk and stay stable when empty', () => {
        expect(readScreenLinks({ screenLinks: { a: 'scr-1', b: 42, c: '' } })).toEqual({ a: 'scr-1' });
        expect(readScreenLinks(undefined)).toBe(readScreenLinks({ screenLinks: 'junk' }));
        expect(readDismissedScreenIssues({ dismissedScreenIssues: ['k1', 7, ''] }).has('k1')).toBe(true);
        expect(readDismissedScreenIssues(undefined)).toBe(readDismissedScreenIssues({}));
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
