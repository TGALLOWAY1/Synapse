import { describe, it, expect } from 'vitest';
import {
    CORE_ARTIFACT_PIPELINE,
    HIDDEN_ARTIFACT_SUBTYPES,
    RETIRED_ARTIFACT_SUBTYPES,
    buildDependencyLayers,
    expandWithHiddenDependencyClosure,
    getArtifactMeta,
    getRequiredDependencies,
    isHiddenArtifactSubtype,
    isRetiredArtifactSubtype,
    visibleCoreSubtypes,
} from '../coreArtifactPipeline';

// Retired subtypes never generate, so the parallelism/depth UX properties
// below are asserted over the pipeline that actually runs.
const ACTIVE_PIPELINE = CORE_ARTIFACT_PIPELINE.filter(m => !isRetiredArtifactSubtype(m.subtype));

describe('coreArtifactPipeline', () => {
    it('every dependency references a real subtype', () => {
        const subtypes = new Set(CORE_ARTIFACT_PIPELINE.map(m => m.subtype));
        for (const meta of CORE_ARTIFACT_PIPELINE) {
            for (const dep of meta.dependsOn) {
                expect(subtypes.has(dep)).toBe(true);
            }
        }
    });

    it('layers are topologically valid — every dep is in an earlier layer', () => {
        const layers = buildDependencyLayers();
        const placed = new Map<string, number>();
        layers.forEach((layer, i) => layer.forEach(meta => placed.set(meta.subtype, i)));
        for (const [subtype, layerIdx] of placed) {
            const meta = getArtifactMeta(subtype as never);
            for (const dep of meta.dependsOn) {
                const depLayer = placed.get(dep)!;
                expect(depLayer).toBeLessThan(layerIdx);
            }
        }
    });

    it('parallelism: layer 1 fans out to >= 3 artifacts so generation feels parallel', () => {
        const layers = buildDependencyLayers(ACTIVE_PIPELINE);
        // The first layer dictates the initial concurrency the user sees in
        // the right rail. Too few means the UI shows a single spinner at
        // start, which feels sequential. This is intentionally a stronger
        // floor than the topological-validity check. (The floor moved from 4
        // to 3 when implementation_plan gained true data deps on
        // screen_inventory + data_model for milestone prompt packs.)
        expect(layers[0].length).toBeGreaterThanOrEqual(3);
    });

    it('depth: exactly 3 sequential layers — the accepted W2 shape', () => {
        // The pipeline was deliberately deepened from 2 to 3 layers when
        // implementation_plan gained the user_flows dep (W2,
        // docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md §W2): flows carry the
        // alternate/error journeys the plan must plan for, and the extra
        // wall-clock (~one user_flows run before the plan) was accepted.
        // This asserts EXACTLY 3 so both regressions are loud: a 4th layer is
        // an unreviewed latency cost, and a return to 2 means someone
        // "optimized" the flows edge back out and re-opened the audited
        // defect (plan current while flows are stale/absent).
        const layers = buildDependencyLayers(ACTIVE_PIPELINE);
        expect(layers.length).toBe(3);
    });

    it('implementation_plan sources user_flows as an optional dep (W2 decision)', () => {
        // Option A from docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md §W2: the
        // edge exists (flows reach the plan prompt, provenance, and the
        // freshness engine)…
        expect(getArtifactMeta('implementation_plan').dependsOn).toContain('user_flows');
        // …but generation is NOT blocked on flows: missing/errored flows mean
        // degraded context (surfaced via the graph's impactedBy), never a
        // DependencyInsufficiencyError.
        expect(getRequiredDependencies('implementation_plan')).toEqual([
            'screen_inventory',
            'data_model',
        ]);
    });

    it('hidden artifacts are still in the pipeline so they keep generating', () => {
        // The whole point of "hidden" is display-only: a hidden subtype MUST
        // remain generated (e.g. mockups consume component_inventory). If a
        // hidden subtype ever leaves the pipeline, its consumers silently break
        // — catch that here. Vacuous while the set is empty, kept as the guard
        // for whatever is hidden next.
        const subtypes = new Set(CORE_ARTIFACT_PIPELINE.map(m => m.subtype));
        for (const hidden of HIDDEN_ARTIFACT_SUBTYPES) {
            expect(subtypes.has(hidden)).toBe(true);
        }
    });

    it('nothing is hidden today — component_inventory was unhidden by W4', () => {
        // W4 (docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md): component_inventory
        // feeds every mockup through MOCKUP_DEPENDENCIES, so an invisible
        // failure silently degraded the product. It is now reviewable in the
        // Screens view's Components section, which means it legitimately gates
        // `assetsReady` and is auto-resumed. Re-hiding it would re-open the
        // audited defect — and per the HIDDEN_ARTIFACT_SUBTYPES rule, anything
        // hidden must be excluded from readiness gating and auto-resume.
        expect(HIDDEN_ARTIFACT_SUBTYPES.size).toBe(0);
        expect(isHiddenArtifactSubtype('component_inventory')).toBe(false);
        expect(isHiddenArtifactSubtype('screen_inventory')).toBe(false);
        expect(isHiddenArtifactSubtype('design_system')).toBe(false);
    });

    it('visibleCoreSubtypes gates output readiness on component_inventory, never on prompt_pack', () => {
        // This is the set `ProjectWorkspace.assetsReady` iterates: every entry
        // must have a generated version before the user is told their outputs
        // are ready. component_inventory joining it is the intended W4 behavior
        // change (its status + Retry live in the Screens Components section);
        // the retired prompt_pack never generates, so it must stay out.
        const gating = visibleCoreSubtypes();
        expect(gating).toContain('component_inventory');
        expect(gating).toContain('screen_inventory');
        expect(gating).toContain('implementation_plan');
        expect(gating).not.toContain('prompt_pack');
        // No hidden subtype may ever gate readiness.
        for (const subtype of gating) {
            expect(isHiddenArtifactSubtype(subtype)).toBe(false);
        }
    });

    it('retired artifacts stay in the pipeline so legacy data keeps its meta', () => {
        // Retired subtypes (prompt_pack) never generate, but persisted legacy
        // artifacts still resolve titles/renderers through getArtifactMeta —
        // removing one from the pipeline would make that throw.
        const subtypes = new Set(CORE_ARTIFACT_PIPELINE.map(m => m.subtype));
        for (const retired of RETIRED_ARTIFACT_SUBTYPES) {
            expect(subtypes.has(retired)).toBe(true);
        }
    });

    it('isRetiredArtifactSubtype retires prompt_pack and nothing that generates', () => {
        expect(isRetiredArtifactSubtype('prompt_pack')).toBe(true);
        expect(isRetiredArtifactSubtype('implementation_plan')).toBe(false);
        expect(isRetiredArtifactSubtype('component_inventory')).toBe(false);
    });

    it('no retired artifact is a dependency of an active one', () => {
        // An active artifact whose dep never generates would wait forever in
        // buildDependencyLayers-driven runs (the layer filter would starve it).
        for (const meta of ACTIVE_PIPELINE) {
            for (const dep of meta.dependsOn) {
                expect(isRetiredArtifactSubtype(dep)).toBe(false);
            }
        }
    });

    it('no hidden artifact is a hard dependency of a visible one', () => {
        // A hidden artifact must not gate a visible one — otherwise hiding it
        // would strand a visible artifact whose upstream never appears.
        for (const meta of CORE_ARTIFACT_PIPELINE) {
            if (isHiddenArtifactSubtype(meta.subtype)) continue;
            for (const dep of meta.dependsOn) {
                expect(isHiddenArtifactSubtype(dep)).toBe(false);
            }
        }
    });

    it('buildDependencyLayers throws on an unsatisfiable graph', () => {
        expect(() =>
            buildDependencyLayers([
                {
                    subtype: 'screen_inventory',
                    title: 'A',
                    description: '',
                    dependsOn: ['user_flows'],
                    displayOrder: 1,
                },
                {
                    subtype: 'user_flows',
                    title: 'B',
                    description: '',
                    dependsOn: ['screen_inventory'],
                    displayOrder: 2,
                },
            ]),
        ).toThrow();
    });
});

describe('expandWithHiddenDependencyClosure', () => {
    const allDone = () => true;
    const noneDone = () => false;
    // HIDDEN_ARTIFACT_SUBTYPES is empty since W4, so the closure is currently an
    // identity function in production. The MECHANISM is retained (a hidden
    // subtype must not be dropped from a graph-driven batch — the graph never
    // names it, and resumeIfNeeded never wakes for it), so it is exercised here
    // with an injected hidden set: component_inventory stands in as the hidden
    // subtype it used to be, keeping the original scenarios verifiable.
    const hiddenComponentInventory = (subtype: string) => subtype === 'component_inventory';

    it('is an identity function while nothing is hidden (the current production shape)', () => {
        const slots = ['screen_inventory', 'user_flows', 'implementation_plan', 'mockup'] as const;
        expect(expandWithHiddenDependencyClosure([...slots], noneDone)).toEqual([...slots]);
    });

    it('pulls a hidden dependency into a batch that regenerates its input and its consumer', () => {
        // The dependency-graph batch after screen_inventory drift: the mockup
        // consumes the hidden subtype, which itself consumes the
        // screen_inventory being regenerated — it must ride along or the new
        // mockup is built from a hidden input derived from the OLD screens.
        const expanded = expandWithHiddenDependencyClosure(
            ['screen_inventory', 'user_flows', 'implementation_plan', 'mockup'],
            allDone,
            hiddenComponentInventory,
        );
        expect(expanded).toContain('component_inventory');
    });

    it('leaves a fresh hidden dependency alone when its own inputs are untouched', () => {
        // Design-tokens drift batch: the mockup consumes the hidden subtype, but
        // screen_inventory is not being regenerated and the hidden slot is
        // done — regenerating it would be a wasted API call.
        const expanded = expandWithHiddenDependencyClosure(
            ['design_system', 'mockup'],
            allDone,
            hiddenComponentInventory,
        );
        expect(expanded).not.toContain('component_inventory');
    });

    it('heals a missing/errored hidden dependency when a consumer is in the batch', () => {
        const expanded = expandWithHiddenDependencyClosure(['mockup'], noneDone, hiddenComponentInventory);
        expect(expanded).toContain('component_inventory');
    });

    it('never adds a hidden subtype nothing in the batch consumes', () => {
        const expanded = expandWithHiddenDependencyClosure(['data_model'], noneDone, hiddenComponentInventory);
        expect(expanded).toEqual(['data_model']);
    });

    it('preserves the caller order and appends additions', () => {
        const expanded = expandWithHiddenDependencyClosure(
            ['screen_inventory', 'mockup'],
            allDone,
            hiddenComponentInventory,
        );
        expect(expanded.slice(0, 2)).toEqual(['screen_inventory', 'mockup']);
        expect(expanded[2]).toBe('component_inventory');
    });
});
