import { describe, expect, it } from 'vitest';
import {
    deriveWorkflowCheckpointSummary,
    renderWorkflowCheckpointSummaryMarkdown,
    type WorkflowCheckpointArtifactInput,
    type WorkflowCheckpointSummaryInput,
} from '../workflowCheckpointSummary';

const artifact = (
    overrides: Partial<WorkflowCheckpointArtifactInput> = {},
): WorkflowCheckpointArtifactInput => ({
    artifactId: 'artifact-data',
    label: 'Data Model',
    visible: true,
    destination: { kind: 'artifact', artifactId: 'artifact-data', nodeId: 'data_model' },
    ...overrides,
});

const input = (
    overrides: Partial<WorkflowCheckpointSummaryInput> = {},
): WorkflowCheckpointSummaryInput => ({
    context: 'generation',
    planningVerdict: { kind: 'working_plan', label: 'Working plan' },
    artifacts: [],
    critiqueIssues: [],
    ...overrides,
});

describe('deriveWorkflowCheckpointSummary', () => {
    it('keeps every validation and alignment signal on one artifact row', () => {
        const summary = deriveWorkflowCheckpointSummary(input({
            artifacts: [artifact({
                validationBlockers: ['No API surface'],
                validationWarnings: ['One entity has no owner'],
                alignment: {
                    state: 'stale',
                    summary: 'Generated from an older PRD.',
                    blocksBuildReadiness: true,
                },
            })],
        }));

        expect(summary.rows).toHaveLength(1);
        expect(summary.rows[0].signals.map(signal => signal.kind)).toEqual([
            'blocking_validation',
            'advisory_validation',
            'alignment',
        ]);
        expect(summary.counts).toEqual({
            totalArtifacts: 1,
            readyArtifacts: 0,
            rowCount: 1,
            attentionSignals: 2,
            advisorySignals: 1,
        });
    });

    it('omits hidden outputs and preserves visible generation failures', () => {
        const summary = deriveWorkflowCheckpointSummary(input({
            artifacts: [
                artifact({
                    artifactId: 'hidden-components',
                    label: 'UI Components',
                    visible: false,
                    generationStatus: 'error',
                }),
                artifact({
                    artifactId: 'artifact-flows',
                    label: 'User Flows',
                    destination: { kind: 'artifact', artifactId: 'artifact-flows', nodeId: 'user_flows' },
                    generationStatus: 'interrupted',
                    generationError: 'The browser closed during generation.',
                }),
            ],
        }));

        expect(summary.rows.map(row => row.label)).toEqual(['User Flows']);
        expect(summary.rows[0].signals[0]).toMatchObject({
            kind: 'generation_failure',
            label: 'Generation interrupted',
        });
    });

    it('keeps accepted validation issues visible without treating them as blockers', () => {
        const summary = deriveWorkflowCheckpointSummary(input({
            artifacts: [artifact({
                validationDisposition: {
                    blockers: [{
                        code: 'data_model_api_surface_missing',
                        message: 'No API surface.',
                    }],
                    effectiveStatus: 'accepted_issue',
                    overridePolicy: 'rationale_required',
                    accepted: {
                        schemaVersion: 1,
                        actor: 'user',
                        acceptedAt: 100,
                        rationale: 'Server actions own this boundary.',
                        blockerFingerprint: 'fp-1',
                    },
                },
            })],
        }));

        expect(summary.rows[0]).toMatchObject({
            severity: 'advisory',
            signals: [{
                kind: 'accepted_validation',
                label: 'Accepted validation issue',
            }],
        });
        expect(summary.rows[0].signals[0].detail).toContain('Server actions own this boundary.');
        expect(summary.counts.attentionSignals).toBe(0);
    });

    it('keeps critique destinations and ranks consequential issues first', () => {
        const summary = deriveWorkflowCheckpointSummary(input({
            artifacts: [artifact({
                validationWarnings: ['Review naming consistency'],
            })],
            critiqueIssues: [
                {
                    issueId: 'issue-medium',
                    label: 'Clarify secondary persona',
                    severity: 'medium',
                    implementationImpact: 'deferrable',
                    destination: { kind: 'challenge', issueId: 'issue-medium' },
                },
                {
                    issueId: 'issue-high',
                    label: 'Define permission boundary',
                    severity: 'high',
                    implementationImpact: 'resolve_before_build',
                    destination: { kind: 'challenge', issueId: 'issue-high' },
                },
            ],
        }));

        expect(summary.rows[0]).toMatchObject({
            id: 'critique:issue-high',
            severity: 'attention',
            destination: { kind: 'challenge', issueId: 'issue-high' },
        });
        expect(summary.rows.map(row => row.id)).toEqual([
            'critique:issue-high',
            'artifact:artifact-data',
            'critique:issue-medium',
        ]);
    });

    it('uses neutral clean copy without turning a working plan into a final verdict', () => {
        const generation = deriveWorkflowCheckpointSummary(input());
        expect(generation.headline).toBe('Generation complete');

        const exported = deriveWorkflowCheckpointSummary(input({
            context: 'export',
            planningVerdict: { kind: 'working_plan', label: 'Working plan' },
        }));
        expect(exported.headline).toBe('Ready to export');
        expect(exported.supportingText).not.toContain('Working plan');
        expect(exported.planningVerdict.kind).toBe('working_plan');
        expect(renderWorkflowCheckpointSummaryMarkdown(exported).match(/Working plan/g)).toHaveLength(1);
    });

    it('renders the same verdict and combined signals for handoff text', () => {
        const summary = deriveWorkflowCheckpointSummary(input({
            context: 'export',
            artifacts: [artifact({
                validationWarnings: ['Review ownership'],
                alignment: {
                    state: 'possibly_affected',
                    summary: 'The target users changed.',
                    blocksBuildReadiness: false,
                },
            })],
        }));
        const markdown = renderWorkflowCheckpointSummaryMarkdown(summary);
        expect(markdown).toContain('**Plan status:** Working plan');
        expect(markdown).toContain('Validation note — Review ownership');
        expect(markdown).toContain('Output may be affected — The target users changed.');
    });

    it('preserves the exact finalized verdict and accepted planning risks in handoff text', () => {
        const summary = deriveWorkflowCheckpointSummary(input({
            context: 'export',
            planningVerdict: {
                kind: 'finalized',
                label: 'Proceeding with accepted risk',
                acceptedRisks: ['Guest checkout remains deferred.'],
                rationale: 'The risk is contained for the first release.',
                containment: 'Keep account creation reversible.',
            },
        }));

        const markdown = renderWorkflowCheckpointSummaryMarkdown(summary);
        expect(markdown).toContain('Proceeding with accepted risk');
        expect(markdown).toContain('Guest checkout remains deferred.');
        expect(markdown).toContain('The risk is contained for the first release.');
        expect(markdown).toContain('Keep account creation reversible.');
    });
});
