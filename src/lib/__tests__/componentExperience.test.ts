import { describe, it, expect } from 'vitest';
import {
    buildComponentInventoryModel,
    componentJoinScreensFromIndex,
    EMPTY_COMPONENT_INVENTORY_MODEL,
    normalizeComponentKey,
    type ComponentJoinScreen,
} from '../componentExperience';
import { buildScreenIndex } from '../screenExperience';
import type { ComponentInventoryContent, ScreenInventoryContent } from '../../types';

// W4 (docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md): the derived component ↔ screen
// join that makes the Component Inventory reviewable. Everything here is
// read-side and advisory — no persisted state, and no contradiction gates
// anything.

const inventory: ComponentInventoryContent = {
    categories: [
        {
            name: 'Data Display',
            components: [
                {
                    name: 'CaseListTable',
                    purpose: 'Sortable table of open cases.',
                    complexity: 'complex',
                    usedIn: ['Case Triage', 'Case Archive'],
                    props: [{ name: 'rows', type: 'Case[]', required: true }],
                },
                {
                    name: 'OwnerBadge',
                    purpose: 'Shows the assigned owner.',
                    complexity: 'simple',
                    usedIn: ['Nowhere Screen'],
                },
            ],
        },
        {
            name: 'Actions',
            components: [
                {
                    name: 'AssignOwnerButton',
                    purpose: 'Assigns a case owner.',
                    complexity: 'moderate',
                },
            ],
        },
    ],
};

const screens: ComponentJoinScreen[] = [
    { id: 'case-triage', slug: 'case-triage', name: 'Case Triage', citedComponents: ['CaseListTable', 'AssignOwnerButton'] },
    { id: 'case-archive', slug: 'case-archive', name: 'Case Archive', citedComponents: [] },
];

describe('normalizeComponentKey', () => {
    it('treats casing, spacing and dashes as the same component', () => {
        expect(normalizeComponentKey('CaseListTable')).toBe('caselisttable');
        expect(normalizeComponentKey('Case List Table')).toBe('caselisttable');
        expect(normalizeComponentKey('case-list-table')).toBe('caselisttable');
    });
});

describe('buildComponentInventoryModel — screen back-references', () => {
    it('resolves usedIn names to canonical screen ids', () => {
        const model = buildComponentInventoryModel(inventory, screens);
        const table = model.byNameKey.get('caselisttable')!;
        expect(table.screenRefs.map(r => r.screenId)).toEqual(['case-triage', 'case-archive']);
        expect(table.screenRefs[0].confidence).toBe('exact');
        expect(table.unresolvedUsedIn).toEqual([]);
    });

    it('records the screen-contract direction as its own evidence source', () => {
        const model = buildComponentInventoryModel(inventory, screens);
        // Case Triage cites CaseListTable AND the component lists Case Triage.
        const table = model.byNameKey.get('caselisttable')!;
        expect(table.screenRefs[0].sources).toEqual(['component_used_in', 'screen_contract']);
        // AssignOwnerButton has no usedIn at all — only the screen contract
        // points at it, and that alone is enough for a back-reference.
        const button = model.byNameKey.get('assignownerbutton')!;
        expect(button.screenRefs.map(r => r.screenId)).toEqual(['case-triage']);
        expect(button.screenRefs[0].sources).toEqual(['screen_contract']);
    });

    it('reports no back-references and no advisories when no screens are supplied', () => {
        const model = buildComponentInventoryModel(inventory);
        expect(model.summary.joinAvailable).toBe(false);
        expect(model.entries).toHaveLength(3);
        expect(model.entries.every(e => e.screenRefs.length === 0)).toBe(true);
        // No screens means no evidence either way — never report the whole
        // inventory as unreferenced.
        expect(model.issues).toEqual([]);
        expect(model.summary.unreferencedCount).toBe(0);
    });

    it('returns the stable empty model for a missing or empty inventory', () => {
        expect(buildComponentInventoryModel(null, screens)).toBe(EMPTY_COMPONENT_INVENTORY_MODEL);
        expect(buildComponentInventoryModel({ categories: [] }, screens)).toBe(EMPTY_COMPONENT_INVENTORY_MODEL);
    });

    it('summarizes counts over the join', () => {
        const { summary } = buildComponentInventoryModel(inventory, screens);
        expect(summary).toMatchObject({
            categoryCount: 2,
            componentCount: 3,
            // CaseListTable + AssignOwnerButton resolve; OwnerBadge does not.
            referencedCount: 2,
            unreferencedCount: 1,
            screensWithComponents: 2,
            screenTotal: 2,
            joinAvailable: true,
        });
    });
});

describe('buildComponentInventoryModel — contradiction detector', () => {
    it('flags a screen citing a component that is not in the inventory (review)', () => {
        const model = buildComponentInventoryModel(inventory, [
            { id: 'case-triage', slug: 'case-triage', name: 'Case Triage', citedComponents: ['GhostWidget'] },
        ]);
        const issue = model.issues.find(i => i.kind === 'screen_cites_unknown_component');
        expect(issue).toBeDefined();
        expect(issue!.severity).toBe('review');
        expect(issue!.screenId).toBe('case-triage');
        expect(issue!.screenSlug).toBe('case-triage');
        expect(issue!.message).toContain('GhostWidget');
    });

    it('does not flag a citation that differs only in formatting', () => {
        const model = buildComponentInventoryModel(inventory, [
            { id: 'case-triage', slug: 'case-triage', name: 'Case Triage', citedComponents: ['case list table'] },
        ]);
        expect(model.issues.some(i => i.kind === 'screen_cites_unknown_component')).toBe(false);
        expect(model.byNameKey.get('caselisttable')!.screenRefs).toHaveLength(1);
    });

    it('accepts a containment match as a weaker "partial" reference rather than a contradiction', () => {
        // AssignOwnerButton has no `usedIn`, so the screen contract is the only
        // evidence — and a near-miss name must read as approximate, never as a
        // confirmed match and never as a contradiction.
        const model = buildComponentInventoryModel(inventory, [
            { id: 'case-triage', slug: 'case-triage', name: 'Case Triage', citedComponents: ['AssignOwnerButtonPrimary'] },
        ]);
        expect(model.issues.some(i => i.kind === 'screen_cites_unknown_component')).toBe(false);
        expect(model.byNameKey.get('assignownerbutton')!.screenRefs[0].confidence).toBe('partial');
    });

    it('an exact match from either direction is never downgraded by a later partial one', () => {
        const model = buildComponentInventoryModel(inventory, [
            { id: 'case-triage', slug: 'case-triage', name: 'Case Triage', citedComponents: ['CaseListTableRow'] },
        ]);
        // usedIn already matched Case Triage exactly.
        expect(model.byNameKey.get('caselisttable')!.screenRefs[0].confidence).toBe('exact');
    });

    it('flags a usedIn entry that names no screen (info, not review)', () => {
        const model = buildComponentInventoryModel(inventory, screens);
        const issue = model.issues.find(i => i.kind === 'component_used_in_unknown_screen');
        expect(issue).toBeDefined();
        expect(issue!.severity).toBe('info');
        expect(issue!.componentName).toBe('OwnerBadge');
        expect(model.byNameKey.get('ownerbadge')!.unresolvedUsedIn).toEqual(['Nowhere Screen']);
    });

    it('flags an unreferenced component as info and orders review issues first', () => {
        const model = buildComponentInventoryModel(inventory, [
            { id: 'case-triage', slug: 'case-triage', name: 'Case Triage', citedComponents: ['GhostWidget'] },
        ]);
        expect(model.issues[0].severity).toBe('review');
        expect(model.issues.some(i => i.kind === 'component_unreferenced')).toBe(true);
        // Every issue is advisory — only 'review' and 'info' severities exist.
        expect(model.issues.every(i => i.severity === 'review' || i.severity === 'info')).toBe(true);
    });

    it('produces stable de-dupe keys', () => {
        const model = buildComponentInventoryModel(inventory, screens);
        const keys = model.issues.map(i => i.key);
        expect(new Set(keys).size).toBe(keys.length);
    });
});

describe('componentJoinScreensFromIndex', () => {
    const screenInventory: ScreenInventoryContent = {
        sections: [{
            title: 'Core',
            screens: [
                {
                    id: 'case-triage',
                    name: 'Case Triage',
                    priority: 'P0',
                    purpose: 'Triage incoming cases.',
                    handoff: { primaryComponents: ['CaseListTable', 'GhostWidget'] },
                },
                {
                    // Legacy screen: no handoff contract at all.
                    name: 'Case Archive',
                    priority: 'P2',
                    purpose: 'Browse closed cases.',
                    coreUIElements: ['Header with date filters'],
                },
            ],
        }],
    };

    it('projects the canonical screens index (reusing the existing join layer)', () => {
        const index = buildScreenIndex(screenInventory, [], null);
        const joined = componentJoinScreensFromIndex(index);
        expect(joined.map(s => s.id)).toEqual(['case-triage', 'case-archive']);
        expect(joined[0].citedComponents).toEqual(['CaseListTable', 'GhostWidget']);
    });

    it('only reads handoff.primaryComponents — prose UI regions are never treated as component citations', () => {
        // `coreUIElements` / the legacy `components` alias hold prose ("Header
        // with date filters"), so comparing them against component names would
        // manufacture contradictions that are not real.
        const index = buildScreenIndex(screenInventory, [], null);
        const joined = componentJoinScreensFromIndex(index);
        expect(joined[1].citedComponents).toEqual([]);

        const model = buildComponentInventoryModel(inventory, joined);
        const flagged = model.issues.filter(i => i.kind === 'screen_cites_unknown_component');
        expect(flagged).toHaveLength(1);
        expect(flagged[0].componentName).toBe('GhostWidget');
    });

    it('is unaffected by a display rename (join keys come from stored content)', () => {
        const index = buildScreenIndex(screenInventory, [], null, {
            'case-triage': { name: 'Renamed Triage' },
        });
        const joined = componentJoinScreensFromIndex(index);
        expect(joined[0].slug).toBe('case-triage');
        expect(joined[0].name).toBe('Renamed Triage');
        // The component's usedIn still names the stored screen name, so the
        // reference survives the rename.
        const model = buildComponentInventoryModel(inventory, joined);
        expect(model.byNameKey.get('caselisttable')!.screenRefs[0].screenId).toBe('case-triage');
    });
});
