import { describe, it, expect } from 'vitest';
import {
    buildArtifactDependencyGraph,
    computeDisplayEdges,
    computeDownstreamImpacts,
    computeGraphLayout,
    computeRecommendedUpdates,
    computeUpdateOrder,
    evaluateDependencyGraph,
    getDirectDependencies,
    getDirectDependents,
    type DependencyEvaluationInput,
    type DependencyNodeId,
} from '../artifactDependencyGraph';
import {
    CORE_ARTIFACT_PIPELINE,
    HIDDEN_ARTIFACT_SUBTYPES,
    RETIRED_ARTIFACT_SUBTYPES,
} from '../coreArtifactPipeline';
import { summarizeSpineChange, type SpineChangeSummary } from '../spineChangeAnalysis';
import type { SourceRef, StructuredPRD } from '../../types';

const graph = buildArtifactDependencyGraph();

// --- fixtures ---------------------------------------------------------------

const SPINE_V1 = 'spine-1';
const SPINE_V2 = 'spine-2';

let refCounter = 0;
const spineRef = (spineId: string): SourceRef => ({
    id: `ref-${++refCounter}`,
    sourceArtifactId: 'project-1',
    sourceArtifactVersionId: spineId,
    sourceType: 'spine',
});
const artifactRef = (artifactId: string, versionId: string, anchorInfo?: string): SourceRef => ({
    id: `ref-${++refCounter}`,
    sourceArtifactId: artifactId,
    sourceArtifactVersionId: versionId,
    sourceType: 'core_artifact',
    ...(anchorInfo !== undefined ? { anchorInfo } : {}),
});

interface SnapshotOpts {
    versionId?: string;
    versionNumber?: number;
    createdAt?: number;
    sourceRefs?: SourceRef[];
    manuallyEdited?: boolean;
    metadata?: Record<string, unknown>;
}

const snapshot = (nodeId: string, opts: SnapshotOpts = {}) => ({
    artifactId: `art-${nodeId}`,
    version: {
        id: opts.versionId ?? `ver-${nodeId}-1`,
        versionNumber: opts.versionNumber ?? 1,
        createdAt: opts.createdAt ?? 1000,
        sourceRefs: opts.sourceRefs ?? [spineRef(SPINE_V1)],
        ...(opts.manuallyEdited ? { provenance: { changeSource: 'user_edit' as const } } : {}),
        ...(opts.metadata ? { metadata: opts.metadata } : {}),
    },
});

/** A fully-generated, fully-consistent project on spine v1. */
function healthyInput(): DependencyEvaluationInput {
    const snapshots: DependencyEvaluationInput['snapshots'] = {
        screen_inventory: snapshot('screen_inventory'),
        design_system: snapshot('design_system'),
        data_model: snapshot('data_model'),
    };
    snapshots.user_flows = snapshot('user_flows', {
        sourceRefs: [spineRef(SPINE_V1), artifactRef('art-screen_inventory', 'ver-screen_inventory-1')],
    });
    snapshots.implementation_plan = snapshot('implementation_plan', {
        sourceRefs: [
            spineRef(SPINE_V1),
            artifactRef('art-screen_inventory', 'ver-screen_inventory-1'),
            artifactRef('art-data_model', 'ver-data_model-1'),
        ],
    });
    snapshots.mockup = snapshot('mockup', {
        sourceRefs: [
            spineRef(SPINE_V1),
            artifactRef('art-screen_inventory', 'ver-screen_inventory-1'),
            artifactRef('art-design_system', 'ver-design_system-1', 'hash-a'),
        ],
    });
    return {
        spineVersionIds: [SPINE_V1],
        latestSpineId: SPINE_V1,
        currentDesignTokensHash: 'hash-a',
        snapshots,
    };
}

type EvalMap = ReturnType<typeof evaluateDependencyGraph>;
const statusOf = (evals: EvalMap, id: DependencyNodeId) => evals.get(id)?.status;

// --- graph shape -------------------------------------------------------------

describe('buildArtifactDependencyGraph', () => {
    it('contains the PRD, every visible core subtype, and the mockup — nothing hidden or retired', () => {
        const ids = graph.nodes.map(n => n.id);
        expect(ids).toContain('prd');
        expect(ids).toContain('mockup');
        for (const meta of CORE_ARTIFACT_PIPELINE) {
            const hiddenOrRetired = HIDDEN_ARTIFACT_SUBTYPES.has(meta.subtype)
                || RETIRED_ARTIFACT_SUBTYPES.has(meta.subtype);
            if (hiddenOrRetired) expect(ids).not.toContain(meta.subtype);
            else expect(ids).toContain(meta.subtype);
        }
    });

    it('derives hard edges from the real pipeline dependencies', () => {
        const hard = graph.edges.filter(e => e.kind === 'hard').map(e => `${e.from}->${e.to}`);
        expect(hard).toContain('screen_inventory->user_flows');
        expect(hard).toContain('screen_inventory->implementation_plan');
        expect(hard).toContain('data_model->implementation_plan');
        expect(hard).toContain('screen_inventory->mockup');
        expect(hard).toContain('design_system->mockup');
    });

    it('collapses hidden subtypes transitively instead of surfacing them', () => {
        // mockup ← component_inventory (hidden) ← screen_inventory collapses
        // to mockup ← screen_inventory, which already exists — and no edge may
        // reference a hidden/retired node.
        for (const e of graph.edges) {
            for (const end of [e.from, e.to]) {
                if (end === 'prd' || end === 'mockup') continue;
                expect(HIDDEN_ARTIFACT_SUBTYPES.has(end)).toBe(false);
                expect(RETIRED_ARTIFACT_SUBTYPES.has(end)).toBe(false);
            }
        }
    });

    it('gives every artifact node a foundation edge from the PRD', () => {
        for (const node of graph.nodes) {
            if (node.id === 'prd') continue;
            expect(graph.edges).toContainEqual({ from: 'prd', to: node.id, kind: 'foundation' });
        }
    });

    it('is acyclic (computeUpdateOrder over all nodes does not throw)', () => {
        expect(() => computeUpdateOrder(graph, graph.nodes.map(n => n.id))).not.toThrow();
    });
});

describe('dependency / impact resolution', () => {
    it('resolves direct dependencies including the PRD foundation', () => {
        expect(getDirectDependencies(graph, 'user_flows').sort()).toEqual(['prd', 'screen_inventory']);
        expect(getDirectDependencies(graph, 'mockup').sort()).toEqual(['design_system', 'prd', 'screen_inventory']);
    });

    it('resolves direct dependents', () => {
        expect(getDirectDependents(graph, 'design_system')).toEqual(['mockup']);
        expect(getDirectDependents(graph, 'screen_inventory').sort()).toEqual([
            'implementation_plan', 'mockup', 'user_flows',
        ]);
    });

    it('PRD impacts every other node downstream', () => {
        const { direct, indirect } = computeDownstreamImpacts(graph, 'prd');
        expect([...direct, ...indirect].sort()).toEqual(
            graph.nodes.map(n => n.id).filter(id => id !== 'prd').sort(),
        );
        // Every node has a direct foundation edge from the PRD.
        expect(indirect).toEqual([]);
    });

    it('screen_inventory has only direct impacts today (no deeper chain)', () => {
        const { direct, indirect } = computeDownstreamImpacts(graph, 'screen_inventory');
        expect(direct.sort()).toEqual(['implementation_plan', 'mockup', 'user_flows']);
        expect(indirect).toEqual([]);
    });
});

describe('computeUpdateOrder', () => {
    it('orders upstream artifacts before their dependents', () => {
        const order = computeUpdateOrder(graph, ['mockup', 'design_system', 'user_flows', 'screen_inventory']);
        expect(order.indexOf('screen_inventory')).toBeLessThan(order.indexOf('user_flows'));
        expect(order.indexOf('screen_inventory')).toBeLessThan(order.indexOf('mockup'));
        expect(order.indexOf('design_system')).toBeLessThan(order.indexOf('mockup'));
    });

    it('ignores dependencies outside the requested set', () => {
        // user_flows depends on screen_inventory, but screen_inventory is not
        // being updated — user_flows must still be schedulable.
        expect(computeUpdateOrder(graph, ['user_flows'])).toEqual(['user_flows']);
    });

    it('is deterministic', () => {
        const ids = graph.nodes.map(n => n.id).filter(id => id !== 'prd');
        expect(computeUpdateOrder(graph, ids)).toEqual(computeUpdateOrder(graph, [...ids].reverse()));
    });
});

describe('computeGraphLayout', () => {
    it('places the PRD alone in row 0 and dependents below their inputs', () => {
        const { rows } = computeGraphLayout(graph);
        expect(rows[0]).toEqual(['prd']);
        const rowOf = (id: DependencyNodeId) => rows.findIndex(r => r.includes(id));
        expect(rowOf('screen_inventory')).toBeLessThan(rowOf('user_flows'));
        expect(rowOf('design_system')).toBeLessThan(rowOf('mockup'));
        expect(rowOf('data_model')).toBeLessThan(rowOf('implementation_plan'));
        // Every node appears exactly once.
        expect(rows.flat().sort()).toEqual(graph.nodes.map(n => n.id).sort());
    });

    it('display edges hide PRD edges to nodes that already have a hard chain', () => {
        const display = computeDisplayEdges(graph);
        expect(display).toContainEqual({ from: 'prd', to: 'screen_inventory', kind: 'foundation' });
        expect(display.some(e => e.from === 'prd' && e.to === 'user_flows')).toBe(false);
        expect(display.some(e => e.from === 'prd' && e.to === 'mockup')).toBe(false);
        // All hard edges survive.
        for (const e of graph.edges.filter(e => e.kind === 'hard')) {
            expect(display).toContainEqual(e);
        }
    });
});

// --- staleness evaluation ------------------------------------------------------

describe('evaluateDependencyGraph', () => {
    it('fresh project with only a PRD: every artifact node is missing', () => {
        const evals = evaluateDependencyGraph(graph, {
            spineVersionIds: [SPINE_V1],
            latestSpineId: SPINE_V1,
            snapshots: {},
        });
        expect(statusOf(evals, 'prd')).toBe('source');
        for (const node of graph.nodes) {
            if (node.id === 'prd') continue;
            expect(statusOf(evals, node.id)).toBe('missing');
        }
    });

    it('fully generated, fully consistent project: everything up to date', () => {
        const evals = evaluateDependencyGraph(graph, healthyInput());
        for (const node of graph.nodes) {
            if (node.id === 'prd') continue;
            const ev = evals.get(node.id)!;
            expect(ev.status).toBe('up_to_date');
            expect(ev.reasons).toEqual([]);
            expect(ev.impactedBy).toEqual([]);
        }
        expect(evals.get('user_flows')?.prdVersionLabel).toBe('Version 1');
    });

    it('PRD changed: every artifact generated from the old spine needs update', () => {
        const input = healthyInput();
        input.spineVersionIds = [SPINE_V1, SPINE_V2];
        input.latestSpineId = SPINE_V2;
        const evals = evaluateDependencyGraph(graph, input);
        for (const node of graph.nodes) {
            if (node.id === 'prd') continue;
            const ev = evals.get(node.id)!;
            expect(ev.status).toBe('needs_update');
            expect(ev.reasons.some(r => r.kind === 'prd_changed' && r.dependencyId === 'prd')).toBe(true);
        }
        expect(evals.get('mockup')?.reasons.find(r => r.kind === 'prd_changed')?.detail)
            .toContain('Version 2');
    });

    it('regenerated upstream: recorded ref mismatch marks dependents needs_update', () => {
        const input = healthyInput();
        // screen_inventory regenerated → new preferred version id.
        input.snapshots.screen_inventory = snapshot('screen_inventory', {
            versionId: 'ver-screen_inventory-2', versionNumber: 2, createdAt: 2000,
        });
        const evals = evaluateDependencyGraph(graph, input);
        for (const dependent of ['user_flows', 'implementation_plan', 'mockup'] as const) {
            const ev = evals.get(dependent)!;
            expect(ev.status).toBe('needs_update');
            const reason = ev.reasons.find(r => r.kind === 'dependency_changed');
            expect(reason?.dependencyId).toBe('screen_inventory');
            expect(reason?.detail).toContain('Version 2');
        }
        // Nodes not consuming screen_inventory stay clean.
        expect(statusOf(evals, 'design_system')).toBe('up_to_date');
        expect(statusOf(evals, 'data_model')).toBe('up_to_date');
    });

    it('legacy artifact without dependency refs falls back to the timestamp heuristic (advisory)', () => {
        const input = healthyInput();
        // Legacy user_flows: spine ref only, generated at t=1000.
        input.snapshots.user_flows = snapshot('user_flows');
        // screen_inventory regenerated later.
        input.snapshots.screen_inventory = snapshot('screen_inventory', {
            versionId: 'ver-screen_inventory-2', versionNumber: 2, createdAt: 5000,
        });
        const evals = evaluateDependencyGraph(graph, input);
        const ev = evals.get('user_flows')!;
        expect(ev.status).toBe('update_recommended');
        expect(ev.reasons.some(r => r.kind === 'dependency_newer' && r.dependencyId === 'screen_inventory')).toBe(true);
    });

    it('legacy artifact with older upstream stays up to date', () => {
        const input = healthyInput();
        input.snapshots.user_flows = snapshot('user_flows', { createdAt: 9000 });
        const evals = evaluateDependencyGraph(graph, input);
        expect(statusOf(evals, 'user_flows')).toBe('up_to_date');
    });

    it('design token drift marks mockups needs_update; token-identical regen does not', () => {
        const drift = healthyInput();
        drift.currentDesignTokensHash = 'hash-b';
        const driftEvals = evaluateDependencyGraph(graph, drift);
        expect(statusOf(driftEvals, 'mockup')).toBe('needs_update');
        expect(driftEvals.get('mockup')!.reasons.some(r => r.kind === 'design_tokens_changed')).toBe(true);

        // Regenerated design system, same tokens: hash matches → mockup stays
        // current even though the version id changed (stalenessSlice parity).
        const same = healthyInput();
        same.snapshots.design_system = snapshot('design_system', {
            versionId: 'ver-design_system-2', versionNumber: 2, createdAt: 3000,
        });
        const sameEvals = evaluateDependencyGraph(graph, same);
        expect(statusOf(sameEvals, 'mockup')).toBe('up_to_date');
    });

    it('live slot status wins: generating/queued and error/interrupted map onto the node', () => {
        const input = healthyInput();
        input.slotStatus = { user_flows: 'generating', data_model: 'error', mockup: 'queued' };
        const evals = evaluateDependencyGraph(graph, input);
        expect(statusOf(evals, 'user_flows')).toBe('generating');
        expect(statusOf(evals, 'data_model')).toBe('error');
        expect(statusOf(evals, 'mockup')).toBe('generating');
    });

    it('propagates upstream trouble downstream as impactedBy', () => {
        const input = healthyInput();
        // design_system missing → the mockup (its only consumer) is impacted
        // even though the mockup's own recorded refs are internally clean.
        delete input.snapshots.design_system;
        input.currentDesignTokensHash = undefined;
        const evals = evaluateDependencyGraph(graph, input);
        expect(evals.get('mockup')!.impactedBy).toEqual(['design_system']);
        // Nodes that don't consume the design system are untouched.
        expect(evals.get('user_flows')!.impactedBy).toEqual([]);
        expect(evals.get('implementation_plan')!.impactedBy).toEqual([]);
    });

    it('flags manual edits on artifacts and the PRD', () => {
        const input = healthyInput();
        input.snapshots.data_model = snapshot('data_model', { manuallyEdited: true });
        input.latestSpineProvenance = { changeSource: 'user_edit' };
        const evals = evaluateDependencyGraph(graph, input);
        expect(evals.get('data_model')?.manuallyEdited).toBe(true);
        expect(evals.get('prd')?.manuallyEdited).toBe(true);
        expect(evals.get('design_system')?.manuallyEdited).toBe(false);
    });

    it('artifact with no spine ref at all is advisory (no_provenance), not hard-stale', () => {
        const input = healthyInput();
        input.snapshots.data_model = snapshot('data_model', { sourceRefs: [] });
        const evals = evaluateDependencyGraph(graph, input);
        const ev = evals.get('data_model')!;
        expect(ev.status).toBe('update_recommended');
        expect(ev.reasons[0]?.kind).toBe('no_provenance');
    });
});

describe('computeRecommendedUpdates', () => {
    it('empty for a fully healthy project', () => {
        const evals = evaluateDependencyGraph(graph, healthyInput());
        expect(computeRecommendedUpdates(graph, evals)).toEqual([]);
    });

    it('PRD change recommends regenerating everything, upstream first', () => {
        const input = healthyInput();
        input.spineVersionIds = [SPINE_V1, SPINE_V2];
        input.latestSpineId = SPINE_V2;
        const order = computeRecommendedUpdates(graph, evaluateDependencyGraph(graph, input));
        expect(order.sort()).toEqual(
            graph.nodes.map(n => n.id).filter(id => id !== 'prd').sort(),
        );
        const seq = computeRecommendedUpdates(graph, evaluateDependencyGraph(graph, input));
        expect(seq.indexOf('screen_inventory')).toBeLessThan(seq.indexOf('user_flows'));
        expect(seq.indexOf('screen_inventory')).toBeLessThan(seq.indexOf('mockup'));
        expect(seq.indexOf('design_system')).toBeLessThan(seq.indexOf('mockup'));
        expect(seq.indexOf('data_model')).toBeLessThan(seq.indexOf('implementation_plan'));
    });

    it('a single stale upstream pulls its impacted dependents into the plan', () => {
        const input = healthyInput();
        input.snapshots.design_system = snapshot('design_system', {
            versionId: 'ver-design_system-2', versionNumber: 2, createdAt: 3000,
        });
        input.currentDesignTokensHash = 'hash-b'; // tokens actually changed
        const order = computeRecommendedUpdates(graph, evaluateDependencyGraph(graph, input));
        // Only the mockup consumes the design system.
        expect(order).toEqual(['mockup']);
    });

    it('excludes nodes that are currently generating', () => {
        const input = healthyInput();
        input.spineVersionIds = [SPINE_V1, SPINE_V2];
        input.latestSpineId = SPINE_V2;
        input.slotStatus = { mockup: 'generating' };
        const order = computeRecommendedUpdates(graph, evaluateDependencyGraph(graph, input));
        expect(order).not.toContain('mockup');
    });

    it('includes missing and errored artifacts', () => {
        const input = healthyInput();
        delete input.snapshots.data_model;
        input.slotStatus = { user_flows: 'error' };
        const order = computeRecommendedUpdates(graph, evaluateDependencyGraph(graph, input));
        expect(order).toContain('data_model');
        expect(order).toContain('user_flows');
        // data_model missing → implementation_plan is impacted and included.
        expect(order).toContain('implementation_plan');
        expect(order.indexOf('data_model')).toBeLessThan(order.indexOf('implementation_plan'));
    });
});

// --- change-aware evaluation (spineChangeFor) --------------------------------

describe('change-aware evaluation', () => {
    const basePrd = (overrides: Partial<StructuredPRD> = {}): StructuredPRD => ({
        vision: 'v',
        targetUsers: ['u'],
        coreProblem: 'p',
        features: [{ id: 'f1', name: 'Feature One', description: 'd', userValue: 'v', complexity: 'low' }],
        architecture: 'a',
        risks: ['r'],
        ...overrides,
    });

    const prdChangedInput = (summary: SpineChangeSummary): DependencyEvaluationInput => {
        const input = healthyInput();
        input.spineVersionIds = [SPINE_V1, SPINE_V2];
        input.latestSpineId = SPINE_V2;
        input.spineChangeFor = (from) => (from === SPINE_V1 ? summary : null);
        return input;
    };

    it('attaches the change summary to prd_changed reasons; advisory never downgrades the status', () => {
        // Risks-only change: outside screen_inventory's affinity, inside
        // implementation_plan's.
        const summary = summarizeSpineChange(basePrd(), basePrd({ risks: ['r', 'r2'] }));
        const evals = evaluateDependencyGraph(graph, prdChangedInput(summary));

        const screens = evals.get('screen_inventory')!;
        expect(screens.status).toBe('needs_update');
        expect(screens.reasons.find(r => r.kind === 'prd_changed')?.changeSummary).toBe(summary);
        expect(screens.likelyUnaffected).toBe(true);

        expect(evals.get('implementation_plan')?.likelyUnaffected).toBeUndefined();
    });

    it('never flags likelyUnaffected when other evidence exists alongside the PRD change', () => {
        const summary = summarizeSpineChange(basePrd(), basePrd({ risks: ['r', 'r2'] }));
        const input = prdChangedInput(summary);
        // Mockup also has design token drift → two reasons → no advisory flag.
        input.currentDesignTokensHash = 'hash-b';
        const evals = evaluateDependencyGraph(graph, input);
        const mockup = evals.get('mockup')!;
        expect(mockup.reasons.length).toBeGreaterThan(1);
        expect(mockup.likelyUnaffected).toBeUndefined();
    });

    it('treats overlay-edited metadata (screenEdits/promptEdits) as manually edited', () => {
        const input = healthyInput();
        input.snapshots.screen_inventory = snapshot('screen_inventory', {
            metadata: { screenEdits: { 'scr-home': { name: 'Home!' } } },
        });
        const evals = evaluateDependencyGraph(graph, input);
        expect(evals.get('screen_inventory')?.manuallyEdited).toBe(true);
        expect(evals.get('data_model')?.manuallyEdited).toBe(false);
    });
});
