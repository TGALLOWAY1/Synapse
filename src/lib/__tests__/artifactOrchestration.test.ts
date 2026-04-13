import { describe, it, expect } from 'vitest';
import { buildDependencyContext, normalizeArtifactMarkdown, validateCrossArtifactConsistency } from '../artifactOrchestration';
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
