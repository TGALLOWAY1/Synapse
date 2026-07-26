import { describe, it, expect } from 'vitest';
import {
    buildDependencyContext,
    normalizeArtifactMarkdown,
    summarizeUserFlowsDependency,
    validateCrossArtifactConsistency,
} from '../artifactOrchestration';
import type { StructuredPRD } from '../../types';

const prd: StructuredPRD = {
    vision: 'Build a clinic scheduling platform.',
    targetUsers: ['Clinic admin', 'Patient'],
    coreProblem: 'Manual appointment scheduling causes delays.',
    features: [
        {
            id: 'f1',
            name: 'Appointment Booking',
            description: 'Patients can book appointments online.',
            userValue: 'Reduces phone calls.',
            complexity: 'medium',
            priority: 'must',
            acceptanceCriteria: ['Users can select slots', 'Confirmation email is sent'],
            dependencies: [],
        },
        {
            id: 'f2',
            name: 'Reminder Notifications',
            description: 'Automated reminders reduce no-shows.',
            userValue: 'Improves attendance.',
            complexity: 'low',
            priority: 'should',
            acceptanceCriteria: ['Reminder 24h before', 'Patients can opt out'],
            dependencies: ['f1'],
        },
    ],
    architecture: 'React frontend and Node API.',
    risks: ['Incorrect timezone handling'],
    nonFunctionalRequirements: ['P95 < 250ms'],
    constraints: ['8-week timeline'],
};

describe('artifact orchestration helpers', () => {
    it('includes dependency artifact snippets when required', () => {
        const context = buildDependencyContext('user_flows', {
            screen_inventory: '# Screen Inventory\n### Booking Screen',
        });

        expect(context).toContain('screen_inventory');
        expect(context).toContain('Booking Screen');
    });

    it('threads user_flows content into the implementation_plan dependency context (W2)', () => {
        const context = buildDependencyContext('implementation_plan', {
            screen_inventory: '# Screen Inventory\n### Booking Screen',
            data_model: '# Data Model\n## Entity Appointment',
            user_flows: '# User Flows\n\n### Flow: Book an Appointment\n**Steps:**\n1. [Booking Screen] — Pick a slot → Slot held',
        });

        expect(context).toContain('### user_flows');
        expect(context).toContain('Book an Appointment');
        // user_flows is optional context, never labeled REQUIRED (generation
        // waits for flows but is not blocked on them).
        expect(context).not.toContain('### user_flows (REQUIRED)');
        expect(context).toContain('### screen_inventory (REQUIRED)');
    });

    it('summarizeUserFlowsDependency keeps every flow\'s steps and error paths past the budget', () => {
        const flow = (name: string) => [
            `### Flow: ${name}`,
            `**Goal:** Complete ${name}.`,
            '**Related Features:** [f1] Appointment Booking',
            '**Preconditions:** User is signed in and the clinic has open slots available this week.',
            '**Steps:**',
            '1. [Booking Screen] — Pick a slot → Slot held for 5 minutes',
            '2. [Confirm Screen] — Confirm booking → Booking saved',
            '   - **Decision:** If the slot expired, go to step 1; otherwise step 3',
            '3. [Confirmation] — View summary → Email sent',
            '**Success Outcome:** The appointment is booked and confirmed by email.',
            '**Error Paths:**',
            `- [Slot taken during ${name}] → [Show next available slots]`,
            '**Edge Cases:** Clinic closes a day after booking opens.',
        ].join('\n');
        const content = `# User Flows\n\n${flow('Onboarding')}\n\n${flow('Core Booking')}\n\n${flow('Admin Settings')}`;

        const summary = summarizeUserFlowsDependency(content, 200);
        // Later flows' journeys survive a budget the head-slice would cut.
        for (const name of ['Onboarding', 'Core Booking', 'Admin Settings']) {
            expect(summary).toContain(`### Flow: ${name}`);
            expect(summary).toContain(`- [Slot taken during ${name}] → [Show next available slots]`);
        }
        expect(summary).toContain('- **Decision:** If the slot expired, go to step 1; otherwise step 3');
        expect(summary).toContain('**Edge Cases:** Clinic closes a day after booking opens.');
        // Detail sections are what the budget cuts.
        expect(summary).not.toContain('Preconditions');
        expect(summary).not.toContain('Success Outcome');
        expect(summary).toContain('flow detail truncated');
    });

    it('summarizeUserFlowsDependency passes short or unstructured content through', () => {
        expect(summarizeUserFlowsDependency('### Flow: Tiny\n**Steps:**\n1. [A] — x → y', 1400))
            .toBe('### Flow: Tiny\n**Steps:**\n1. [A] — x → y');
        const unstructured = 'no flow headings here '.repeat(20);
        expect(summarizeUserFlowsDependency(unstructured, 50)).toBe(unstructured.slice(0, 50));
    });

    it('normalizes markdown spacing and trailing newline', () => {
        const normalized = normalizeArtifactMarkdown('## Title\r\n\r\n\r\nText   ');
        expect(normalized).toBe('## Title\n\nText\n');
    });

    it('flags weak cross-artifact traceability', () => {
        const warnings = validateCrossArtifactConsistency('implementation_plan', '# Plan\nGeneric roadmap only.', prd);
        expect(warnings.some(w => w.includes('traceability'))).toBe(true);
    });

    it('flags missing API section for data model outputs', () => {
        const warnings = validateCrossArtifactConsistency('data_model', '# Data Model\n## Entity Patient', prd);
        expect(warnings.some(w => w.includes('API surface'))).toBe(true);
    });
});
