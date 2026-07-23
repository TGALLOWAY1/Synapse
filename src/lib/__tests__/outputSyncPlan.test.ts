import { describe, expect, it, vi } from 'vitest';
import {
    buildArtifactDependencyGraph,
    type DependencyNodeEvaluation,
    type DependencyNodeId,
} from '../artifactDependencyGraph';
import {
    buildOutputSyncSessionFingerprint,
    buildOutputSyncRows,
    hasOutputSyncDrift,
    planOutputSyncExecution,
    runOutputSyncSession,
    type OutputSyncChoice,
} from '../outputSyncPlan';
import type { ArtifactSlotKey } from '../../types';

const graph = buildArtifactDependencyGraph();

function evaluation(
    nodeId: DependencyNodeId,
    patch: Partial<DependencyNodeEvaluation> = {},
): DependencyNodeEvaluation {
    return {
        nodeId,
        status: nodeId === 'prd' ? 'source' : 'up_to_date',
        reasons: [],
        impactedBy: [],
        manuallyEdited: false,
        ...patch,
    };
}

function evaluations(patches: Partial<Record<DependencyNodeId, Partial<DependencyNodeEvaluation>>> = {}) {
    return new Map(graph.nodes.map(node => [
        node.id,
        evaluation(node.id, patches[node.id]),
    ]));
}

const artifactIdBySlot = Object.fromEntries(
    graph.nodes
        .filter(node => node.id !== 'prd')
        .map(node => [node.id, `artifact-${node.id}`]),
) as Partial<Record<ArtifactSlotKey, string>>;

describe('output sync planning', () => {
    it('builds visible triage rows from canonical freshness and current Careful plans', () => {
        const evals = evaluations({
            screen_inventory: {
                status: 'needs_update',
                manuallyEdited: true,
                reasons: [{ kind: 'prd_changed', detail: 'PRD changed.' }],
            },
            mockup: { status: 'up_to_date', impactedBy: ['screen_inventory'] },
        });
        const rows = buildOutputSyncRows({
            graph,
            evaluations: evals,
            artifactIdBySlot,
            recommendedUpdates: ['screen_inventory', 'mockup'],
            carefulPlansByArtifactId: new Map([
                ['artifact-screen_inventory', { id: 'plan-screens', itemCount: 2 }],
            ]),
        });

        expect(rows).toHaveLength(graph.nodes.length - 1);
        expect(rows.find(row => row.id === 'screen_inventory')).toMatchObject({
            statusLabel: 'Needs update',
            defaultChoice: 'update',
            canMarkCurrent: true,
            manuallyEdited: true,
            carefulSupported: true,
            carefulPlanId: 'plan-screens',
            carefulItemCount: 2,
        });
        expect(rows.find(row => row.id === 'mockup')).toMatchObject({
            statusLabel: 'Impacted',
            defaultChoice: 'update',
            canMarkCurrent: true,
            carefulSupported: false,
        });
        expect(hasOutputSyncDrift(rows)).toBe(true);
    });

    it('defaults healthy outputs to Later and does not report initial missing outputs as drift', () => {
        const rows = buildOutputSyncRows({
            graph,
            evaluations: evaluations({
                data_model: { status: 'missing' },
            }),
            artifactIdBySlot,
            recommendedUpdates: ['data_model', 'implementation_plan'],
        });

        expect(rows.find(row => row.id === 'design_system')?.defaultChoice).toBe('skip');
        expect(rows.find(row => row.id === 'data_model')).toMatchObject({
            defaultChoice: 'update',
            canMarkCurrent: false,
            isDrifted: false,
        });
        expect(hasOutputSyncDrift(rows)).toBe(false);
    });

    it('keeps graph order and distinguishes missing and failed outputs without inventing hidden rows', () => {
        const rows = buildOutputSyncRows({
            graph,
            evaluations: evaluations({
                data_model: { status: 'error', manuallyEdited: true },
                mockup: { status: 'missing' },
            }),
            artifactIdBySlot: {
                ...artifactIdBySlot,
                data_model: undefined,
                mockup: undefined,
            },
            recommendedUpdates: ['mockup', 'data_model'],
        });

        expect(rows.map(row => row.id)).toEqual(
            graph.nodes.filter(node => node.id !== 'prd').map(node => node.id),
        );
        expect(rows.find(row => row.id === 'data_model')).toMatchObject({
            statusLabel: 'Failed',
            defaultChoice: 'update',
            canMarkCurrent: false,
            manuallyEdited: true,
        });
        expect(rows.find(row => row.id === 'mockup')).toMatchObject({
            statusLabel: 'Not generated',
            defaultChoice: 'update',
            canMarkCurrent: false,
        });
        expect(rows.map(row => row.id)).not.toContain('component_inventory');
        expect(rows.map(row => row.id)).not.toContain('prompt_pack');
    });

    it('regenerates validation-blocked outputs but never offers mark-current as a bypass', () => {
        const evals = evaluations({
            screen_inventory: { status: 'needs_review' },
            user_flows: { status: 'up_to_date', impactedBy: ['screen_inventory'] },
        });
        const rows = buildOutputSyncRows({
            graph,
            evaluations: evals,
            artifactIdBySlot,
            recommendedUpdates: ['screen_inventory', 'user_flows'],
        });

        expect(rows.find(row => row.id === 'screen_inventory')).toMatchObject({
            statusLabel: 'Needs validation review',
            isDrifted: true,
            defaultChoice: 'update',
            canMarkCurrent: false,
        });
        const choices = Object.fromEntries(rows.map(row => [
            row.id,
            row.id === 'user_flows' ? 'update' : 'skip',
        ])) as Record<string, OutputSyncChoice>;
        expect(planOutputSyncExecution({ graph, evaluations: evals, rows, choices }).regenerate)
            .toEqual(['screen_inventory', 'user_flows']);
    });

    it('marks current first and excludes that healed upstream from a partial regeneration closure', () => {
        const evals = evaluations({
            screen_inventory: { status: 'needs_update' },
            user_flows: { status: 'needs_update' },
        });
        const rows = buildOutputSyncRows({
            graph,
            evaluations: evals,
            artifactIdBySlot,
            recommendedUpdates: ['screen_inventory', 'user_flows'],
        });
        const choices: Record<string, OutputSyncChoice> = Object.fromEntries(
            rows.map(row => [row.id, 'skip']),
        );
        choices.screen_inventory = 'mark_current';
        choices.user_flows = 'update';

        expect(planOutputSyncExecution({ graph, evaluations: evals, rows, choices })).toEqual({
            markCurrent: ['screen_inventory'],
            regenerate: ['user_flows'],
            deferredMarkCurrent: [],
        });
    });

    it('force-includes a troubled visible upstream in dependency order', () => {
        const evals = evaluations({
            screen_inventory: { status: 'needs_update' },
            user_flows: { status: 'needs_update' },
        });
        const rows = buildOutputSyncRows({
            graph,
            evaluations: evals,
            artifactIdBySlot,
            recommendedUpdates: ['screen_inventory', 'user_flows'],
        });
        const choices: Record<string, OutputSyncChoice> = Object.fromEntries(
            rows.map(row => [row.id, row.id === 'user_flows' ? 'update' : 'skip']),
        );
        const plan = planOutputSyncExecution({ graph, evaluations: evals, rows, choices });

        expect(plan.regenerate).toEqual(['screen_inventory', 'user_flows']);
    });

    it('defers a dependent mark-current choice when a troubled upstream is skipped', () => {
        const evals = evaluations({
            screen_inventory: { status: 'needs_update' },
            user_flows: { status: 'needs_update' },
        });
        const rows = buildOutputSyncRows({
            graph,
            evaluations: evals,
            artifactIdBySlot,
            recommendedUpdates: ['screen_inventory', 'user_flows'],
        });
        const choices: Record<string, OutputSyncChoice> = Object.fromEntries(
            rows.map(row => [row.id, 'skip']),
        );
        choices.user_flows = 'mark_current';

        expect(planOutputSyncExecution({ graph, evaluations: evals, rows, choices })).toEqual({
            markCurrent: [],
            regenerate: [],
            deferredMarkCurrent: ['user_flows'],
        });
    });

    it('defers a dependent mark-current choice when its troubled upstream regenerates', () => {
        const evals = evaluations({
            screen_inventory: { status: 'needs_update' },
            user_flows: { status: 'needs_update' },
        });
        const rows = buildOutputSyncRows({
            graph,
            evaluations: evals,
            artifactIdBySlot,
            recommendedUpdates: ['screen_inventory', 'user_flows'],
        });
        const choices: Record<string, OutputSyncChoice> = Object.fromEntries(
            rows.map(row => [row.id, 'skip']),
        );
        choices.screen_inventory = 'update';
        choices.user_flows = 'mark_current';

        expect(planOutputSyncExecution({ graph, evaluations: evals, rows, choices })).toEqual({
            markCurrent: [],
            regenerate: ['screen_inventory'],
            deferredMarkCurrent: ['user_flows'],
        });
    });

    it('does not mark a dependent current over an explicitly regenerated upstream', () => {
        const evals = evaluations({
            user_flows: { status: 'needs_update' },
        });
        const rows = buildOutputSyncRows({
            graph,
            evaluations: evals,
            artifactIdBySlot,
            recommendedUpdates: ['user_flows'],
        });
        const choices: Record<string, OutputSyncChoice> = Object.fromEntries(
            rows.map(row => [row.id, 'skip']),
        );
        choices.screen_inventory = 'update';
        choices.user_flows = 'mark_current';

        expect(planOutputSyncExecution({ graph, evaluations: evals, rows, choices })).toEqual({
            markCurrent: [],
            regenerate: ['screen_inventory'],
            deferredMarkCurrent: ['user_flows'],
        });
    });

    it('keeps the session fingerprint stable across ordering but changes for exact source context', () => {
        const first = buildOutputSyncSessionFingerprint({
            spineVersionId: 'spine-2',
            spineContent: { productName: 'Synapse' },
            sources: [
                {
                    slot: 'user_flows',
                    artifactId: 'flows',
                    preferredVersionId: 'flows-v2',
                    preferredContent: '# Flows',
                    preferredMetadata: { screenEdits: { checkout: 'edited' } },
                    sourceRefs: [
                        {
                            sourceType: 'core_artifact',
                            sourceArtifactId: 'screens',
                            sourceArtifactVersionId: 'screens-v2',
                        },
                        {
                            sourceType: 'spine',
                            sourceArtifactId: 'project',
                            sourceArtifactVersionId: 'spine-2',
                        },
                    ],
                },
                {
                    slot: 'screen_inventory',
                    artifactId: 'screens',
                    preferredVersionId: 'screens-v2',
                    sourceRefs: [],
                },
            ],
        });
        const reordered = buildOutputSyncSessionFingerprint({
            spineVersionId: 'spine-2',
            spineContent: { productName: 'Synapse' },
            sources: [
                {
                    slot: 'screen_inventory',
                    artifactId: 'screens',
                    preferredVersionId: 'screens-v2',
                    sourceRefs: [],
                },
                {
                    slot: 'user_flows',
                    artifactId: 'flows',
                    preferredVersionId: 'flows-v2',
                    preferredContent: '# Flows',
                    preferredMetadata: { screenEdits: { checkout: 'edited' } },
                    sourceRefs: [
                        {
                            sourceType: 'spine',
                            sourceArtifactId: 'project',
                            sourceArtifactVersionId: 'spine-2',
                        },
                        {
                            sourceType: 'core_artifact',
                            sourceArtifactId: 'screens',
                            sourceArtifactVersionId: 'screens-v2',
                        },
                    ],
                },
            ],
        });

        expect(reordered).toBe(first);
        expect(buildOutputSyncSessionFingerprint({
            spineVersionId: 'spine-2',
            spineContent: { productName: 'Synapse amended in place' },
            sources: [],
        })).not.toBe(buildOutputSyncSessionFingerprint({
            spineVersionId: 'spine-2',
            spineContent: { productName: 'Synapse' },
            sources: [],
        }));
        const contentBound = (content: string) => buildOutputSyncSessionFingerprint({
            spineVersionId: 'spine-2',
            sources: [{
                slot: 'user_flows',
                artifactId: 'flows',
                preferredVersionId: 'flows-v2',
                preferredContent: content,
                preferredMetadata: { screenEdits: { checkout: 'edited' } },
                sourceRefs: [{
                    sourceType: 'spine',
                    sourceArtifactId: 'project',
                    sourceArtifactVersionId: 'spine-2',
                }],
            }],
        });
        expect(contentBound('# Flows edited while the modal was open')).not.toBe(
            contentBound('# Flows'),
        );
        expect(buildOutputSyncSessionFingerprint({
            spineVersionId: 'spine-2',
            sources: [{
                slot: 'user_flows',
                artifactId: 'flows',
                preferredVersionId: 'flows-v3',
                sourceRefs: [],
            }],
        })).not.toBe(first);
        expect(buildOutputSyncSessionFingerprint({
            spineVersionId: 'spine-3',
            sources: [],
        })).not.toBe(buildOutputSyncSessionFingerprint({
            spineVersionId: 'spine-2',
            sources: [],
        }));
    });

    it('rejects stale sessions before planning or writes', () => {
        const createExecution = vi.fn(() => ({
            markCurrent: ['screen_inventory'] as ArtifactSlotKey[],
            regenerate: ['user_flows'] as ArtifactSlotKey[],
            deferredMarkCurrent: [],
        }));
        const onMarkCurrent = vi.fn();
        const onRegenerate = vi.fn();

        expect(runOutputSyncSession({
            expectedFingerprint: 'opened-snapshot',
            currentFingerprint: 'changed-snapshot',
            canExecute: true,
            canRegenerate: true,
            createExecution,
            onMarkCurrent,
            onRegenerate,
        })).toEqual({ status: 'stale' });
        expect(createExecution).not.toHaveBeenCalled();
        expect(onMarkCurrent).not.toHaveBeenCalled();
        expect(onRegenerate).not.toHaveBeenCalled();
    });

    it('applies mark-current writes before exactly one regeneration batch', () => {
        const calls: string[] = [];
        const execution = {
            markCurrent: ['screen_inventory', 'design_system'] as ArtifactSlotKey[],
            regenerate: ['user_flows', 'mockup'] as ArtifactSlotKey[],
            deferredMarkCurrent: [],
        };
        const result = runOutputSyncSession({
            expectedFingerprint: 'same',
            currentFingerprint: 'same',
            canExecute: true,
            canRegenerate: true,
            createExecution: () => execution,
            onMarkCurrent: slot => calls.push(`mark:${slot}`),
            onRegenerate: slots => calls.push(`regenerate:${slots.join(',')}`),
        });

        expect(result).toEqual({ status: 'completed', execution });
        expect(calls).toEqual([
            'mark:screen_inventory',
            'mark:design_system',
            'regenerate:user_flows,mockup',
        ]);
    });
});
