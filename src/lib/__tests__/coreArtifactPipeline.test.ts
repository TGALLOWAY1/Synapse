import { describe, it, expect } from 'vitest';
import {
    CORE_ARTIFACT_PIPELINE,
    HIDDEN_ARTIFACT_SUBTYPES,
    buildDependencyLayers,
    getArtifactMeta,
    isHiddenArtifactSubtype,
} from '../coreArtifactPipeline';

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

    it('parallelism: layer 1 fans out to >= 4 artifacts so generation feels parallel', () => {
        const layers = buildDependencyLayers();
        // The first layer dictates the initial concurrency the user sees in
        // the right rail. Anything less than 4 means the UI shows a single
        // spinner at start, which feels sequential. This is intentionally a
        // stronger floor than the topological-validity check.
        expect(layers[0].length).toBeGreaterThanOrEqual(4);
    });

    it('depth: <= 2 sequential layers so the worst-case waiter is one hop deep', () => {
        const layers = buildDependencyLayers();
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
