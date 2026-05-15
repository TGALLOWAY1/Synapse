import { describe, expect, it } from 'vitest';
import type {
    ComponentInventoryContent,
    MockupSettings,
    ScreenInventoryContent,
    StructuredPRD,
} from '../../types';
import { generateMockup } from '../services/mockupService';

const structuredPRD: StructuredPRD = {
    productName: 'ClinicFlow',
    vision: 'Coordinate clinic intake and triage decisions in one place.',
    coreProblem: 'Care coordinators lose time jumping between intake notes and triage actions.',
    targetUsers: ['Care coordinator'],
    features: [
        {
            id: 'f1',
            name: 'Triage queue',
            description: 'Prioritize incoming patient cases by urgency and ownership.',
            userValue: 'Respond to urgent patients faster.',
            complexity: 'medium',
        },
    ],
    architecture: 'Web app',
    risks: ['Incomplete intake data'],
};

const screenInventory: ScreenInventoryContent = {
    sections: [
        {
            title: 'Triage',
            screens: [
                {
                    name: 'Triage Queue',
                    priority: 'P0',
                    purpose: 'Review urgent patient cases and assign triage owner.',
                    userIntent: 'Find the most urgent case quickly.',
                    coreUIElements: ['Case list table', 'Urgency filter', 'Assign owner CTA'],
                },
                {
                    name: 'Case Detail Review',
                    priority: 'P0',
                    purpose: 'Validate intake details and log triage recommendation.',
                    coreUIElements: ['Intake summary', 'Recommendation form'],
                },
                {
                    name: 'Settings',
                    priority: 'P2',
                    purpose: 'Configure clinic preferences.',
                },
            ],
        },
        {
            title: 'Handoff',
            screens: [
                {
                    name: 'Handoff Confirmation',
                    priority: 'P1',
                    purpose: 'Confirm triage handoff and track pending follow-ups.',
                    coreUIElements: ['Assigned clinician list', 'Follow-up tasks'],
                },
            ],
        },
    ],
};

const componentInventory: ComponentInventoryContent = {
    categories: [
        {
            name: 'Data Display',
            components: [
                {
                    name: 'CaseListTable',
                    purpose: 'Render prioritized cases.',
                    complexity: 'moderate',
                    usedIn: ['Triage Queue'],
                },
            ],
        },
        {
            name: 'Forms & Inputs',
            components: [
                {
                    name: 'AssignOwnerButton',
                    purpose: 'Assign a triage owner.',
                    complexity: 'simple',
                    usedIn: ['Triage Queue', 'Case Detail Review'],
                },
            ],
        },
    ],
};

const baseSettings: MockupSettings = {
    platform: 'desktop',
    fidelity: 'mid',
    scope: 'multi_screen',
};

describe('mockupService.generateMockup', () => {
    it('derives screens from screen inventory and attaches component refs', () => {
        const result = generateMockup(baseSettings, structuredPRD, screenInventory, componentInventory);
        expect(result.payload.version).toBe('mockup_spec_v1');
        expect(result.payload.screens.length).toBeGreaterThan(0);
        const triage = result.payload.screens.find(s => s.name === 'Triage Queue');
        expect(triage).toBeDefined();
        expect(triage?.priority).toBe('P0');
        expect(triage?.userIntent).toBe('Find the most urgent case quickly.');
        expect(triage?.coreUIElements).toContain('Case list table');
        expect(triage?.componentRefs).toContain('CaseListTable');
        expect(triage?.componentRefs).toContain('AssignOwnerButton');
    });

    it('respects single_screen scope by selecting one top-priority screen', () => {
        const result = generateMockup(
            { ...baseSettings, scope: 'single_screen' },
            structuredPRD,
            screenInventory,
            componentInventory,
        );
        expect(result.payload.screens).toHaveLength(1);
        expect(result.payload.screens[0].priority).toBe('P0');
    });

    it('respects key_workflow scope and prefers P0/P1 screens', () => {
        const result = generateMockup(
            { ...baseSettings, scope: 'key_workflow' },
            structuredPRD,
            screenInventory,
            componentInventory,
        );
        // Settings screen is P2 — should not be picked
        const names = result.payload.screens.map(s => s.name);
        expect(names).not.toContain('Settings');
        expect(names.length).toBeGreaterThan(0);
    });

    it('falls back to a placeholder when screen_inventory is missing', () => {
        const result = generateMockup(baseSettings, structuredPRD, null, componentInventory);
        expect(result.payload.screens).toHaveLength(1);
        expect(result.warnings.some(w => /Screen Inventory/i.test(w))).toBe(true);
    });

    it('emits a warning when component_inventory is missing but still produces screens', () => {
        const result = generateMockup(baseSettings, structuredPRD, screenInventory, null);
        expect(result.payload.screens.length).toBeGreaterThan(0);
        expect(result.warnings.some(w => /Component Inventory/i.test(w))).toBe(true);
        // No componentRefs when inventory missing
        for (const screen of result.payload.screens) {
            expect(screen.componentRefs).toBeUndefined();
        }
    });

    it('uses the product name when building the mockup title', () => {
        const result = generateMockup(baseSettings, structuredPRD, screenInventory, componentInventory);
        expect(result.payload.title).toContain('ClinicFlow');
    });
});
