import { describe, expect, it } from 'vitest';
import { structuredArtifactToMarkdown } from '../services/coreArtifactService';
import { extractStructuredPlan } from '../services/implementationPlanParser';
import { deriveCrossCuttingObligations } from '../planning/crossCuttingObligations';
import { implementationPlanSchema } from '../schemas/artifactSchemas';
import type { StructuredImplementationPlan } from '../../types';

const BASE: StructuredImplementationPlan = {
    milestones: [{
        id: 'm_setup',
        name: 'Project Setup',
        goal: 'Scaffold the app.',
        tasks: [{ id: 'task_scaffold', title: 'Initialize the app', status: 'todo' }],
    }],
};

describe('implementation plan — conditional cross-cutting sections', () => {
    it('declares both sections as non-required in the generation schema', () => {
        // Non-required at the top level is exactly what makes them conditional;
        // requiring them would force an empty section on every project.
        expect(implementationPlanSchema.required).toEqual(['milestones']);
        expect(implementationPlanSchema.properties).toHaveProperty('securityPrivacy');
        expect(implementationPlanSchema.properties).toHaveProperty('measurement');
        // Linking fields stay non-required so a partial emit still parses.
        const control = implementationPlanSchema.properties.securityPrivacy.properties.controls.items;
        expect(control.required).toEqual(['id', 'title']);
        const metric = implementationPlanSchema.properties.measurement.properties.metrics.items;
        expect(metric.required).toEqual(['id', 'metric']);
    });

    it('serializes and re-parses both sections through markdown + the plan fence', () => {
        const plan: StructuredImplementationPlan = {
            ...BASE,
            securityPrivacy: {
                summary: 'PII is encrypted at rest.',
                controls: [{
                    id: 'sec_encrypt_pii',
                    title: 'Encrypt PII at rest',
                    obligation: 'GDPR requirement in the PRD constraints.',
                    implementation: 'Column-level encryption.',
                    requirementIds: ['f1'],
                    taskIds: ['task_scaffold'],
                    tests: ['Stored email is unreadable without the app key'],
                }],
                openQuestions: ['Which region stores EU data?'],
            },
            measurement: {
                metrics: [{
                    id: 'mm_activation',
                    metric: 'Day-1 activation rate',
                    eventName: 'playlist_generated',
                    properties: ['user_id: string'],
                    trigger: 'A playlist finishes generating.',
                    validation: 'Seen in the analytics debug view.',
                    taskIds: ['task_scaffold'],
                }],
            },
        };

        const markdown = structuredArtifactToMarkdown('implementation_plan', plan);
        expect(markdown).toContain('## Security & Privacy Obligations');
        expect(markdown).toContain('  - Requirements: f1');
        expect(markdown).toContain('  - Verification: Stored email is unreadable without the app key');
        expect(markdown).toContain('## Measurement');
        expect(markdown).toContain('- **Day-1 activation rate** → `playlist_generated`');
        // Legacy headings the validator and the legacy parser depend on survive.
        expect(markdown).toContain('### Milestone 1: Project Setup');
        expect(markdown).toContain('**Goal:**');

        const reparsed = extractStructuredPlan(markdown);
        expect(reparsed?.securityPrivacy?.controls?.[0].taskIds).toEqual(['task_scaffold']);
        expect(reparsed?.measurement?.metrics?.[0].validation).toBe('Seen in the analytics debug view.');

        expect(reparsed?.securityPrivacy?.openQuestions).toEqual(['Which region stores EU data?']);
        expect(markdown).toContain('- Which region stores EU data?');

        // The re-parsed plan feeds the predicate directly: the fully linked
        // metric satisfies Measurement, while the still-open security question
        // keeps that obligation honestly unresolved.
        const report = deriveCrossCuttingObligations({
            prd: {
                vision: 'v', targetUsers: ['u'], coreProblem: 'p', features: [],
                architecture: 'a', risks: [],
                constraints: ['Must be GDPR compliant'],
                successMetrics: [{ name: 'Day-1 activation rate' }],
            },
            plan: reparsed ?? undefined,
        });
        expect(report.measurement.satisfied).toBe(true);
        expect(report.securityPrivacy.satisfied).toBe(false);
        expect(report.securityPrivacy.missing).toEqual([
            'Open security/privacy question, unresolved: "Which region stores EU data?"',
        ]);
    });

    it('writes no obligation heading for a plan that carries neither section', () => {
        const markdown = structuredArtifactToMarkdown('implementation_plan', BASE);
        expect(markdown).not.toContain('## Security & Privacy Obligations');
        expect(markdown).not.toContain('## Measurement');
        expect(extractStructuredPlan(markdown)?.securityPrivacy).toBeUndefined();
    });
});
