import { describe, it, expect } from 'vitest';
import {
    findMissingRequiredDependencies,
    assertDependenciesSufficient,
    DependencyInsufficiencyError,
} from '../artifactDependencyGate';
import { buildDependencyContext, summarizeScreenInventoryDependency } from '../artifactOrchestration';

describe('artifact dependency gate', () => {
    it('reports implementation_plan required deps as missing when absent', () => {
        const missing = findMissingRequiredDependencies('implementation_plan', {});
        expect(missing).toContain('screen_inventory');
        expect(missing).toContain('data_model');
    });

    it('treats an empty-string dependency as missing', () => {
        const missing = findMissingRequiredDependencies('implementation_plan', {
            screen_inventory: '   ',
            data_model: '# Data Model\n## Entity',
        });
        expect(missing).toEqual(['screen_inventory']);
    });

    it('blocks implementation_plan generation when required upstream artifacts are missing', () => {
        expect(() => assertDependenciesSufficient('implementation_plan', {}))
            .toThrow(DependencyInsufficiencyError);
    });

    it('allows generation when degraded generation is explicitly acknowledged', () => {
        expect(() => assertDependenciesSufficient('implementation_plan', {}, { allowMissing: true }))
            .not.toThrow();
    });

    it('does not block when all required deps are present', () => {
        expect(() => assertDependenciesSufficient('implementation_plan', {
            screen_inventory: JSON.stringify({ sections: [{ title: 'Core', screens: [{ name: 'Home', purpose: 'x' }] }] }),
            data_model: '# Data Model\n## Entity\n## API Endpoints',
        })).not.toThrow();
    });
});

describe('dependency context preserves screen roster under truncation', () => {
    // Build a screen inventory whose verbose prose far exceeds the prose budget.
    const screens = Array.from({ length: 20 }, (_, i) => ({
        name: `Screen ${i + 1}`,
        purpose: 'This is a deliberately long purpose description repeated to blow past the truncation budget. '.repeat(6),
        priority: 'P0' as const,
    }));
    const inventory = JSON.stringify({ sections: [{ title: 'All Screens', screens }] });

    it('lists every screen name even when detail is truncated', () => {
        const summary = summarizeScreenInventoryDependency(inventory, 400);
        expect(summary.length).toBeLessThan(2000); // prose was truncated
        for (let i = 1; i <= 20; i++) {
            expect(summary).toContain(`Screen ${i}`);
        }
    });

    it('buildDependencyContext for user_flows keeps every screen name', () => {
        const context = buildDependencyContext('user_flows', { screen_inventory: inventory });
        expect(context).toContain('(REQUIRED)');
        for (let i = 1; i <= 20; i++) {
            expect(context).toContain(`Screen ${i}`);
        }
    });

    it('labels a missing required dependency explicitly (not "Not generated yet")', () => {
        const context = buildDependencyContext('user_flows', {});
        expect(context).toContain('(REQUIRED)');
        expect(context).toContain('MISSING');
        expect(context).not.toContain('Not generated yet');
    });
});
