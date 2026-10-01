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

    it('tones a successful run with only advisory notes as success, not caution', () => {
        const summary = deriveWorkflowCheckpointSummary(input({
            artifacts: [artifact({ validationWarnings: ['One entity has no owner'] })],
        }));

        expect(summary.tone).toBe('advisory');
        expect(summary.counts.attentionSignals).toBe(0);
        expect(summary.counts.readyArtifacts).toBe(1);
        // The headline states the OUTCOME; the note count belongs on the
        // disclosure, not in an alarm.
        expect(summary.headline).toBe('Generation complete — 1 of 1 output ready');
        expect(summary.headline).not.toMatch(/to review/);
        expect(summary.detailsLabel).toBe('1 note');
        expect(summary.supportingText).toContain('Nothing failed');
    });

    it('pluralises the advisory disclosure label', () => {
        const summary = deriveWorkflowCheckpointSummary(input({
            artifacts: [artifact({
                validationWarnings: ['One entity has no owner'],
                alignment: {
                    state: 'possibly_affected',
                    summary: 'The target users changed.',
                    blocksBuildReadiness: false,
                },
            })],
        }));

        expect(summary.tone).toBe('advisory');
        expect(summary.detailsLabel).toBe('2 notes');
    });

    it('keeps a failed generation slot at attention tone', () => {
        const summary = deriveWorkflowCheckpointSummary(input({
            artifacts: [
                artifact({ validationWarnings: ['One entity has no owner'] }),
                artifact({
                    artifactId: 'artifact-flows',
                    label: 'User Flows',
                    destination: { kind: 'artifact', artifactId: 'artifact-flows', nodeId: 'user_flows' },
                    generationStatus: 'error',
                    generationError: 'The model returned no content.',
                }),
            ],
        }));

        expect(summary.tone).toBe('attention');
        expect(summary.headline).toBe('Generation complete — 1 item to review');
        expect(summary.detailsLabel).toBe('1 item to review');
        expect(summary.counts.readyArtifacts).toBe(1);
        expect(summary.counts.totalArtifacts).toBe(2);
    });

    it('tones a run with nothing to report as clean', () => {
        expect(deriveWorkflowCheckpointSummary(input({
            artifacts: [artifact({})],
        })).tone).toBe('clean');
    });

    it('uses neutral clean copy and carries no plan verdict at all', () => {
        const generation = deriveWorkflowCheckpointSummary(input());
        expect(generation.headline).toBe('Generation complete');

        const exported = deriveWorkflowCheckpointSummary(input({ context: 'export' }));
        expect(exported.headline).toBe('Ready to export');
        // The Finalize/commitment layer is gone: no "Plan finalized" /
        // "Working plan" / accepted-risk verdict travels with the checkpoint.
        expect('planningVerdict' in exported).toBe(false);
        const markdown = renderWorkflowCheckpointSummaryMarkdown(exported);
        expect(markdown).not.toMatch(/Plan status|Plan finalized|Working plan|accepted risk/i);
    });

    it('renders the combined signals for handoff text', () => {
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
        expect(markdown).toContain('## Workflow Checkpoint');
        expect(markdown).toContain('Validation note — Review ownership');
        expect(markdown).toContain('Output may be affected — The target users changed.');
    });
});
