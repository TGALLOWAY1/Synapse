import { describe, it, expect } from 'vitest';
import {
    CORE_ARTIFACT_PIPELINE,
    HIDDEN_ARTIFACT_SUBTYPES,
    RETIRED_ARTIFACT_SUBTYPES,
    buildDependencyLayers,
    getArtifactMeta,
    isHiddenArtifactSubtype,
    isRetiredArtifactSubtype,
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

    it('depth: <= 2 sequential layers so the worst-case waiter is one hop deep', () => {
        const layers = buildDependencyLayers(ACTIVE_PIPELINE);
        expect(layers.length).toBeLessThanOrEqual(2);
    });

    it('hidden artifacts are still in the pipeline so they keep generating', () => {
        // The whole point of "hidden" is display-only: component_inventory is
        // hidden from the assets list but MUST remain generated (mockups consume
        // it). If a hidden subtype ever leaves the pipeline, mockup component
        // tagging silently breaks — catch that here.
        const subtypes = new Set(CORE_ARTIFACT_PIPELINE.map(m => m.subtype));
        for (const hidden of HIDDEN_ARTIFACT_SUBTYPES) {
            expect(subtypes.has(hidden)).toBe(true);
        }
    });

    it('isHiddenArtifactSubtype hides component_inventory and nothing else visible', () => {
        expect(isHiddenArtifactSubtype('component_inventory')).toBe(true);
        expect(isHiddenArtifactSubtype('screen_inventory')).toBe(false);
        expect(isHiddenArtifactSubtype('design_system')).toBe(false);
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
