// Characterization suite (SYN-005) — asserts the CANONICAL freshness engine
// (`evaluateDependencyGraph`, "Engine B") subsumes every scenario the legacy
// `getArtifactStaleness` slice ("Engine A", 3-value StalenessState) covers,
// INCLUDING the contradiction case where the two engines disagree.
//
// This is a pin: before the cutover agent deletes stalenessSlice, these tests
// lock in that Engine B produces the right verdict for each Engine-A scenario,
// so the deletion can't silently regress behaviour. It exercises the pure
// evaluator over hand-built graph + input fixtures (no store), mirroring the
// fixture style of artifactDependencyGraph.test.ts.
//
// Engine-A reference behaviour (for contrast) — getArtifactStaleness returns:
//   * 'outdated'          when the artifact / preferred version is missing
//   * 'possibly_outdated' when the spine ref is absent, no latest spine, the
//                         spine ref ≠ latest spine, OR a mockup's design
//                         tokensHash drifted
//   * 'current'           otherwise
// Crucially Engine A ONLY checks the spine ref (+ the mockup tokensHash). It
// does NOT check hard upstream ARTIFACT drift, so an implementation_plan whose
// data_model dependency was regenerated reads 'current' in Engine A even though
// it is genuinely stale — the bug this whole finding is about.

import { describe, it, expect } from 'vitest';
import {
    buildArtifactDependencyGraph,
    evaluateDependencyGraph,
    type DependencyEvaluationInput,
    type DependencyNodeId,
} from '../artifactDependencyGraph';
import type { SourceRef } from '../../types';

const graph = buildArtifactDependencyGraph();

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
}

const snapshot = (nodeId: string, opts: SnapshotOpts = {}) => ({
    artifactId: `art-${nodeId}`,
    version: {
        id: opts.versionId ?? `ver-${nodeId}-1`,
        versionNumber: opts.versionNumber ?? 1,
        createdAt: opts.createdAt ?? 1000,
        sourceRefs: opts.sourceRefs ?? [spineRef(SPINE_V1)],
    },
});

/** A fully-generated, fully-consistent project on spine v1 (Engine-A: all current). */
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

const evaluate = (input: DependencyEvaluationInput) => evaluateDependencyGraph(graph, input);
const statusOf = (input: DependencyEvaluationInput, id: DependencyNodeId) =>
    evaluate(input).get(id)?.status;
const reasonsOf = (input: DependencyEvaluationInput, id: DependencyNodeId) =>
    evaluate(input).get(id)?.reasons ?? [];

describe('artifact freshness characterization — Engine B subsumes Engine A (SYN-005)', () => {
    it('headline CONTRADICTION: a regenerated data_model marks implementation_plan needs_update (Engine A says current)', () => {
        // implementation_plan was generated from data_model v1 + the latest
        // spine. The data_model is then regenerated: its preferred version id
        // advances to v2. Nothing about the spine changed.
        const input = healthyInput();
        input.snapshots.data_model = snapshot('data_model', {
            versionId: 'ver-data_model-2',
            versionNumber: 2,
            createdAt: 2000,
        });

        // ENGINE B (canonical): concrete upstream artifact drift → needs_update
        // with a dependency_changed reason pointing at data_model.
        expect(statusOf(input, 'implementation_plan')).toBe('needs_update');
        const reason = reasonsOf(input, 'implementation_plan').find(r => r.kind === 'dependency_changed');
        expect(reason?.dependencyId).toBe('data_model');
        expect(reason?.detail).toContain('Version 2');

        // ENGINE A (legacy getArtifactStaleness) would return 'current' HERE:
        // the implementation_plan's spine ref still equals the latest spine and
        // Engine A never inspects upstream artifact refs — THAT is the bug this
        // finding fixes (a "Current" header contradicting the graph's "Needs
        // update"). Engine B is the correct verdict.
    });

    it('spine drift: an artifact whose spine ref ≠ latest spine is needs_update / prd_changed', () => {
        const input = healthyInput();
        input.spineVersionIds = [SPINE_V1, SPINE_V2];
        input.latestSpineId = SPINE_V2;
        // Every artifact still references spine v1.
        expect(statusOf(input, 'screen_inventory')).toBe('needs_update');
        expect(reasonsOf(input, 'screen_inventory').some(r => r.kind === 'prd_changed' && r.dependencyId === 'prd')).toBe(true);
        // Engine-A parity: it would return 'possibly_outdated' (spine ref stale).
    });

    it('mockup design tokensHash drift: needs_update / design_tokens_changed', () => {
        const input = healthyInput();
        input.currentDesignTokensHash = 'hash-b'; // tokens moved after the mockup was rendered
        expect(statusOf(input, 'mockup')).toBe('needs_update');
        expect(reasonsOf(input, 'mockup').some(r => r.kind === 'design_tokens_changed')).toBe(true);
        // Engine-A parity: mockup would read 'possibly_outdated'.
    });

    it('identical-hash design regen: token-hash beats version-id, mockup stays up_to_date', () => {
        // design_system regenerated (NEW version id) but identical tokens (same
        // hash) — mirrors artifactDependencyGraph.test.ts:307-322 and the
        // stalenessSlice "no-op regeneration" contract.
        const input = healthyInput();
        input.snapshots.design_system = snapshot('design_system', {
            versionId: 'ver-design_system-2',
            versionNumber: 2,
            createdAt: 3000,
        });
        expect(statusOf(input, 'mockup')).toBe('up_to_date');
        // Engine-A parity: 'current' (hash unchanged).
    });

    it('no spine ref / no provenance: advisory update_recommended (no_provenance), never needs_update', () => {
        const input = healthyInput();
        input.snapshots.data_model = snapshot('data_model', { sourceRefs: [] });
        expect(statusOf(input, 'data_model')).toBe('update_recommended');
        expect(reasonsOf(input, 'data_model')[0]?.kind).toBe('no_provenance');
        // Engine-A parity: getArtifactStaleness returns 'possibly_outdated' for
        // a missing spine ref — Engine B's advisory tier is the equivalent, and
        // deliberately NOT the hard needs_update tier.
    });

    it('missing artifact / preferred version: missing', () => {
        const input = healthyInput();
        delete input.snapshots.data_model;
        expect(statusOf(input, 'data_model')).toBe('missing');
        // Engine-A parity: getArtifactStaleness returns 'outdated' for a missing
        // artifact / preferred version.
    });

    it('in-flight job slot: generating regardless of drift', () => {
        // Slot is generating AND the PRD drifted — live status wins.
        const input = healthyInput();
        input.spineVersionIds = [SPINE_V1, SPINE_V2];
        input.latestSpineId = SPINE_V2; // would otherwise be needs_update
        input.slotStatus = { data_model: 'generating', user_flows: 'queued' };
        expect(statusOf(input, 'data_model')).toBe('generating');
        expect(statusOf(input, 'user_flows')).toBe('generating'); // queued → generating bucket
    });

    it('post-mark-current shape: all refs rebased to latest spine + current dep versions → up_to_date', () => {
        // markArtifactCurrentForSpine rebases the spine ref onto the latest
        // spine AND every core_artifact ref onto its dependency's current
        // preferred version (refreshing the design tokensHash anchor). An
        // artifact in that shape must read up_to_date on the latest spine.
        const input = healthyInput();
        input.spineVersionIds = [SPINE_V1, SPINE_V2];
        input.latestSpineId = SPINE_V2;
        input.currentDesignTokensHash = 'hash-b';

        // Upstreams the mockup depends on, on their current preferred versions
        // and themselves rebased onto the latest spine (so the whole chain is
        // clean and no ancestor propagates as impactedBy).
        input.snapshots.screen_inventory = snapshot('screen_inventory', {
            versionId: 'ver-screen_inventory-2', versionNumber: 2, createdAt: 2000,
            sourceRefs: [spineRef(SPINE_V2)],
        });
        input.snapshots.design_system = snapshot('design_system', {
            versionId: 'ver-design_system-2', versionNumber: 2, createdAt: 2000,
            sourceRefs: [spineRef(SPINE_V2)],
        });
        // The rebased mockup: spine → v2, screen_inventory → v2, design_system
        // → v2 with the refreshed hash-b anchor.
        input.snapshots.mockup = snapshot('mockup', {
            versionId: 'ver-mockup-2',
            versionNumber: 2,
            createdAt: 4000,
            sourceRefs: [
                spineRef(SPINE_V2),
                artifactRef('art-screen_inventory', 'ver-screen_inventory-2'),
                artifactRef('art-design_system', 'ver-design_system-2', 'hash-b'),
            ],
        });

        const evals = evaluate(input);
        expect(evals.get('mockup')?.status).toBe('up_to_date');
        expect(evals.get('mockup')?.reasons).toEqual([]);
        expect(evals.get('mockup')?.impactedBy).toEqual([]);
    });
});
