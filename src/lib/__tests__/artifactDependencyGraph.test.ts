import { describe, it, expect } from 'vitest';
import {
    buildArtifactDependencyGraph,
    computeDisplayEdges,
    computeDownstreamImpacts,
    computeGraphLayout,
    computeRecommendedUpdates,
    computeUpdateOrder,
    evaluateDependencyGraph,
    expandSelectionWithTroubledUpstreams,
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
import { ARTIFACT_INPUT_SLICES, inputHashSchemeFor } from '../artifactInputSlices';
import type { ArtifactInputHashes, ArtifactSlotKey, CoreArtifactSubtype, SourceRef, StructuredPRD } from '../../types';

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
    // component_inventory became a real graph node when W4 unhid it — it is a
    // screen_inventory dependent and a mockup input, so the healthy fixture has
    // to generate it or every downstream node reads "missing".
    snapshots.component_inventory = snapshot('component_inventory', {
        sourceRefs: [spineRef(SPINE_V1), artifactRef('art-screen_inventory', 'ver-screen_inventory-1')],
    });
    snapshots.implementation_plan = snapshot('implementation_plan', {
        sourceRefs: [
            spineRef(SPINE_V1),
            artifactRef('art-screen_inventory', 'ver-screen_inventory-1'),
            artifactRef('art-data_model', 'ver-data_model-1'),
            // Recorded since the plan gained the user_flows dep (W2).
            artifactRef('art-user_flows', 'ver-user_flows-1'),
        ],
    });
    snapshots.mockup = snapshot('mockup', {
        sourceRefs: [
            spineRef(SPINE_V1),
            artifactRef('art-screen_inventory', 'ver-screen_inventory-1'),
            artifactRef('art-component_inventory', 'ver-component_inventory-1'),
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
        // W2: the plan sources user_flows (alternate/error journeys).
        expect(hard).toContain('user_flows->implementation_plan');
        expect(hard).toContain('screen_inventory->mockup');
        expect(hard).toContain('design_system->mockup');
    });

    it('collapses hidden subtypes transitively instead of surfacing them', () => {
        // No edge may reference a hidden/retired node — a hidden subtype's
        // dependents inherit its dependencies instead. HIDDEN_ARTIFACT_SUBTYPES
        // is empty since W4 unhid component_inventory (so this currently proves
        // only the retired half), but the invariant must hold for whatever is
        // hidden next.
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
        // component_inventory is a real mockup input since W4 unhid it (it used
        // to collapse into screen_inventory).
        expect(getDirectDependencies(graph, 'mockup').sort()).toEqual([
            'component_inventory', 'design_system', 'prd', 'screen_inventory',
        ]);
    });

    it('resolves direct dependents', () => {
        expect(getDirectDependents(graph, 'design_system')).toEqual(['mockup']);
        expect(getDirectDependents(graph, 'screen_inventory').sort()).toEqual([
            'component_inventory', 'implementation_plan', 'mockup', 'user_flows',
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

    it('screen_inventory impacts are all classified direct (the transitive path lands on a direct dependent)', () => {
        // There IS a deeper chain since W2 (screen_inventory → user_flows →
        // implementation_plan), but implementation_plan is also a direct
        // dependent, so nothing is left for the indirect bucket.
        const { direct, indirect } = computeDownstreamImpacts(graph, 'screen_inventory');
        expect(direct.sort()).toEqual([
            'component_inventory', 'implementation_plan', 'mockup', 'user_flows',
        ]);
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

    it('W2: a regenerated user_flows marks implementation_plan needs_update via the existing engine', () => {
        // The plan sources flows (alternate/error journeys); a changed flows
        // artifact must stale the plan through the ordinary dependency_changed
        // path — no special-casing.
        const input = healthyInput();
        input.snapshots.user_flows = snapshot('user_flows', {
            versionId: 'ver-user_flows-2', versionNumber: 2, createdAt: 2000,
            sourceRefs: [spineRef(SPINE_V1), artifactRef('art-screen_inventory', 'ver-screen_inventory-1')],
        });
        const evals = evaluateDependencyGraph(graph, input);
        const ev = evals.get('implementation_plan')!;
        expect(ev.status).toBe('needs_update');
        const reason = ev.reasons.find(r => r.kind === 'dependency_changed');
        expect(reason?.dependencyId).toBe('user_flows');
        expect(reason?.detail).toContain('Version 2');
        // Other flows consumers don't exist; siblings stay clean.
        expect(statusOf(evals, 'mockup')).toBe('up_to_date');
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

    it('treats validation-blocked outputs as troubled and propagates that state downstream', () => {
        const input = healthyInput();
        input.snapshots.screen_inventory = snapshot('screen_inventory', {
            metadata: {
                validationBlockers: [{
                    code: 'output_structure_incomplete',
                    message: 'No screens were produced.',
                }],
            },
        });
        const durable = evaluateDependencyGraph(graph, input);
        expect(statusOf(durable, 'screen_inventory')).toBe('needs_review');
        expect(durable.get('user_flows')?.impactedBy).toContain('screen_inventory');
        expect(computeRecommendedUpdates(graph, durable)).toEqual(expect.arrayContaining([
            'screen_inventory',
            'user_flows',
        ]));

        const transient = healthyInput();
        transient.slotStatus = { data_model: 'needs_review' };
        expect(statusOf(evaluateDependencyGraph(graph, transient), 'data_model'))
            .toBe('needs_review');
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

    it('W2: a missing or errored user_flows leaves the plan up_to_date and surfaces only via impactedBy', () => {
        // Deliberate engine semantics (rule 9 — do NOT "fix" this): a missing
        // dep has nothing concrete to compare, so the plan's own status stays
        // up_to_date; the trouble is reported through impactedBy, which W6's
        // build-packet gate must read alongside status.
        const missing = healthyInput();
        delete missing.snapshots.user_flows;
        const missingEvals = evaluateDependencyGraph(graph, missing);
        expect(statusOf(missingEvals, 'user_flows')).toBe('missing');
        expect(statusOf(missingEvals, 'implementation_plan')).toBe('up_to_date');
        expect(missingEvals.get('implementation_plan')!.impactedBy).toContain('user_flows');

        const errored = healthyInput();
        errored.slotStatus = { user_flows: 'error' };
        const erroredEvals = evaluateDependencyGraph(graph, errored);
        expect(statusOf(erroredEvals, 'user_flows')).toBe('error');
        expect(statusOf(erroredEvals, 'implementation_plan')).toBe('up_to_date');
        expect(erroredEvals.get('implementation_plan')!.impactedBy).toContain('user_flows');
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

// --- expandSelectionWithTroubledUpstreams -------------------------------------

describe('expandSelectionWithTroubledUpstreams', () => {
    it('force-includes a stale visible upstream of a selected dependent, in safe order', () => {
        // PRD drifted: everything needs_update. Selecting only user_flows must
        // pull in its stale screen_inventory input ahead of it.
        const input = healthyInput();
        input.spineVersionIds = [SPINE_V1, SPINE_V2];
        input.latestSpineId = SPINE_V2;
        const evals = evaluateDependencyGraph(graph, input);
        const batch = expandSelectionWithTroubledUpstreams(graph, evals, ['user_flows']);
        expect(batch).toContain('screen_inventory');
        expect(batch.indexOf('screen_inventory')).toBeLessThan(batch.indexOf('user_flows'));
    });

    it('treats healed (marked-current) upstreams as healthy and leaves them out', () => {
        const input = healthyInput();
        input.spineVersionIds = [SPINE_V1, SPINE_V2];
        input.latestSpineId = SPINE_V2;
        const evals = evaluateDependencyGraph(graph, input);
        const batch = expandSelectionWithTroubledUpstreams(
            graph, evals, ['user_flows'], new Set<DependencyNodeId>(['screen_inventory']),
        );
        expect(batch).toEqual(['user_flows']);
    });

    it('leaves healthy upstreams alone and never includes the PRD', () => {
        const evals = evaluateDependencyGraph(graph, healthyInput());
        const batch = expandSelectionWithTroubledUpstreams(graph, evals, ['mockup', 'prd']);
        expect(batch).toEqual(['mockup']);
    });
});

// --- fingerprinted versions (provenance.inputHashes) ---------------------------
//
// Generation records what each output was built from (artifactInputSlices.ts);
// the engine compares those fingerprints with the CURRENT inputs instead of
// comparing version ids. The fixture: every output generated against spine v1,
// recording PRD-side fingerprint 'prd-1' and the content fingerprint of each
// dependency it consumed; each upstream's current content fingerprint is
// `content-<slot>-1`.

describe('evaluateDependencyGraph — fingerprinted versions', () => {
    const slots = (input: DependencyEvaluationInput) =>
        (Object.keys(input.snapshots) as ArtifactSlotKey[]);

    const recordedFor = (slot: ArtifactSlotKey, prd = 'prd-1', brief = 'brief-1'): ArtifactInputHashes => {
        const deps = ARTIFACT_INPUT_SLICES[slot].dependencies;
        return {
            scheme: inputHashSchemeFor(slot),
            spine: prd,
            ...(slot !== 'mockup' ? { designBrief: brief } : {}),
            ...(deps.length > 0
                ? { dependencies: Object.fromEntries(deps.map(dep => [dep, `content-${dep}-1`])) }
                : {}),
        };
    };

    /** healthyInput(), but every output carries a fingerprint and the latest spine is a NEW id (v2). */
    function fingerprintedInput(current: { prd?: Partial<Record<ArtifactSlotKey, string>>; brief?: string } = {}): DependencyEvaluationInput {
        const input = healthyInput();
        input.spineVersionIds = [SPINE_V1, SPINE_V2];
        input.latestSpineId = SPINE_V2;
        input.currentInputHashes = {};
        for (const slot of slots(input)) {
            const snap = input.snapshots[slot]!;
            snap.version.provenance = { changeSource: 'ai_generation', inputHashes: recordedFor(slot) };
            snap.version.contentHash = `content-${slot}-1`;
            input.currentInputHashes[slot] = {
                scheme: inputHashSchemeFor(slot),
                spine: current.prd?.[slot] ?? 'prd-1',
                ...(slot !== 'mockup' ? { designBrief: current.brief ?? 'brief-1' } : {}),
            };
        }
        return input;
    }

    it('a new spine version with unchanged inputs keeps every output up to date (restore / no-op / unrelated edit)', () => {
        const evals = evaluateDependencyGraph(graph, fingerprintedInput());
        for (const node of graph.nodes.filter(n => n.id !== 'prd')) {
            expect(statusOf(evals, node.id), node.id).toBe('up_to_date');
            expect(evals.get(node.id)?.reasons, node.id).toEqual([]);
            expect(evals.get(node.id)?.impactedBy, node.id).toEqual([]);
        }
        // Provenance labels still say where each output came from.
        expect(evals.get('data_model')?.prdVersionLabel).toBe('Version 1');
    });

    it('flags exactly the outputs whose PRD-side fingerprint moved, with the change summary attached', () => {
        const summary = summarizeSpineChange(
            { vision: 'v', targetUsers: [], coreProblem: '', features: [], architecture: '', risks: ['r'] },
            { vision: 'v', targetUsers: [], coreProblem: '', features: [], architecture: '', risks: ['r2'] },
        );
        // A risks-only edit: every core prompt reads the PRD appendix, the
        // mockup spec does not read risks.
        const prd: Partial<Record<ArtifactSlotKey, string>> = {};
        for (const meta of CORE_ARTIFACT_PIPELINE) prd[meta.subtype] = 'prd-2';
        const input = fingerprintedInput({ prd });
        input.spineChangeFor = (from) => (from === SPINE_V1 ? summary : null);
        const evals = evaluateDependencyGraph(graph, input);

        const plan = evals.get('implementation_plan')!;
        expect(plan.status).toBe('needs_update');
        expect(plan.reasons).toHaveLength(1);
        expect(plan.reasons[0]).toMatchObject({ kind: 'prd_changed', dependencyId: 'prd', changeSummary: summary });
        expect(plan.reasons[0].detail).toContain('generated from Version 1, now on Version 2');

        // The mockup's own inputs did not move: it is up to date, and only
        // IMPACTED through its upstreams (they will regenerate under it).
        const mockup = evals.get('mockup')!;
        expect(mockup.status).toBe('up_to_date');
        expect(mockup.reasons).toEqual([]);
        expect(mockup.impactedBy).toEqual(['screen_inventory', 'component_inventory', 'design_system']);
    });

    it('a fingerprint change under the SAME spine id still flags (content rewritten in place)', () => {
        const input = fingerprintedInput({ prd: { data_model: 'prd-2' } });
        input.spineVersionIds = [SPINE_V1];
        input.latestSpineId = SPINE_V1;
        const dataModel = evaluateDependencyGraph(graph, input).get('data_model')!;
        expect(dataModel.status).toBe('needs_update');
        expect(dataModel.reasons[0].kind).toBe('prd_changed');
        expect(dataModel.reasons[0].detail).not.toContain('generated from');
    });

    it('dependency content changed → dependency_changed; a content-identical upstream clone is not drift', () => {
        // data_model regenerated with new content.
        const changed = fingerprintedInput();
        changed.snapshots.data_model!.version.id = 'ver-data_model-2';
        changed.snapshots.data_model!.version.versionNumber = 2;
        changed.snapshots.data_model!.version.contentHash = 'content-data_model-2';
        const plan = evaluateDependencyGraph(graph, changed).get('implementation_plan')!;
        expect(plan.status).toBe('needs_update');
        expect(plan.reasons).toEqual([expect.objectContaining({ kind: 'dependency_changed', dependencyId: 'data_model' })]);

        // screen_inventory re-appended as a clone (overlay edit / mark-current /
        // restore): new version id, identical content fingerprint.
        const cloned = fingerprintedInput();
        cloned.snapshots.screen_inventory!.version.id = 'ver-screen_inventory-2';
        cloned.snapshots.screen_inventory!.version.versionNumber = 2;
        const evals = evaluateDependencyGraph(graph, cloned);
        for (const dependent of ['user_flows', 'component_inventory', 'implementation_plan', 'mockup'] as const) {
            expect(statusOf(evals, dependent), dependent).toBe('up_to_date');
        }
    });

    it('legacy versions without a fingerprint keep the version-id comparison', () => {
        const input = fingerprintedInput();
        // A legacy data_model (pre-fingerprint): only its spine ref speaks.
        input.snapshots.data_model!.version.provenance = undefined;
        // A legacy plan recorded the data_model by version id only.
        input.snapshots.implementation_plan!.version.provenance = undefined;
        input.snapshots.data_model!.version.id = 'ver-data_model-2';
        const evals = evaluateDependencyGraph(graph, input);

        expect(statusOf(evals, 'data_model')).toBe('needs_update');
        expect(evals.get('data_model')?.reasons[0].kind).toBe('prd_changed');
        const plan = evals.get('implementation_plan')!;
        expect(plan.reasons.map(r => r.kind).sort()).toEqual(['dependency_changed', 'prd_changed']);
        // Fingerprinted outputs alongside are judged by their fingerprints.
        expect(statusOf(evals, 'screen_inventory')).toBe('up_to_date');
    });

    it('falls back to ids when the fingerprint is from another scheme or the current inputs are unknown', () => {
        const otherScheme = fingerprintedInput();
        otherScheme.snapshots.data_model!.version.provenance = {
            inputHashes: { ...recordedFor('data_model'), scheme: 'ih0.core_prompt.1' },
        };
        expect(evaluateDependencyGraph(graph, otherScheme).get('data_model')?.reasons[0]?.kind).toBe('prd_changed');

        const unknownCurrent = fingerprintedInput();
        unknownCurrent.currentInputHashes = undefined;
        const evals = evaluateDependencyGraph(graph, unknownCurrent);
        expect(statusOf(evals, 'data_model')).toBe('needs_update');
        expect(statusOf(evals, 'mockup')).toBe('needs_update');
    });

    it('a changed design preset flags the design system with its own reason, and nothing else', () => {
        const evals = evaluateDependencyGraph(graph, fingerprintedInput({ brief: 'brief-2' }));
        const design = evals.get('design_system')!;
        expect(design.status).toBe('needs_update');
        expect(design.reasons).toEqual([expect.objectContaining({ kind: 'design_direction_changed' })]);
        for (const subtype of ['screen_inventory', 'user_flows', 'component_inventory', 'data_model', 'implementation_plan'] as CoreArtifactSubtype[]) {
            expect(statusOf(evals, subtype), subtype).toBe('up_to_date');
        }
        // The mockup is impacted through the design system (its tokens will move).
        expect(evals.get('mockup')?.impactedBy).toEqual(['design_system']);
    });

    it('the mockup keeps comparing design tokens by tokensHash', () => {
        const input = fingerprintedInput();
        input.currentDesignTokensHash = 'hash-b';
        const mockup = evaluateDependencyGraph(graph, input).get('mockup')!;
        expect(mockup.status).toBe('needs_update');
        expect(mockup.reasons).toEqual([expect.objectContaining({ kind: 'design_tokens_changed' })]);
    });

    it('keeps the advisory likelyUnaffected hint on the fingerprint path', () => {
        const before: StructuredPRD = { vision: 'v', targetUsers: ['u'], coreProblem: 'p', features: [], architecture: 'a', risks: ['r'] };
        const summary = summarizeSpineChange(before, { ...before, risks: ['r', 'r2'] });
        const prd: Partial<Record<ArtifactSlotKey, string>> = {};
        for (const meta of CORE_ARTIFACT_PIPELINE) prd[meta.subtype] = 'prd-2';
        const input = fingerprintedInput({ prd });
        input.spineChangeFor = (from) => (from === SPINE_V1 ? summary : null);
        const evals = evaluateDependencyGraph(graph, input);
        // Every core prompt reads the risks (hard needs_update), but the screen
        // inventory does not chiefly derive from them — the hint still says so.
        expect(evals.get('screen_inventory')).toMatchObject({ status: 'needs_update', likelyUnaffected: true });
        expect(evals.get('implementation_plan')?.likelyUnaffected).toBeUndefined();
    });

    it('recommends nothing for a restore to identical inputs', () => {
        const input = fingerprintedInput();
        expect(computeRecommendedUpdates(graph, evaluateDependencyGraph(graph, input))).toEqual([]);
    });
});
