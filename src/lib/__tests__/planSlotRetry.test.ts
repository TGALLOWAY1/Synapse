import { describe, it, expect } from 'vitest';
import { planSlotRetry } from '../coreArtifactPipeline';
import type { CoreArtifactSubtype } from '../../types';

// Helper: build an `isHealthy` predicate where the listed subtypes are UNhealthy
// (missing / errored / needs_review) and everything else is healthy.
const healthyExcept = (...unhealthy: CoreArtifactSubtype[]) =>
    (subtype: CoreArtifactSubtype) => !unhealthy.includes(subtype);

describe('planSlotRetry', () => {
    it('plans a plain single-slot retry when every dependency is healthy', () => {
        const plan = planSlotRetry('mockup', healthyExcept());
        expect(plan.unhealthyDeps).toEqual([]);
        expect(plan.slots).toEqual(['mockup']);
    });

    it('queues an errored HIDDEN dependency before the downstream slot (mockup ← component_inventory)', () => {
        // component_inventory is a hidden dependency the mockup consumes.
        const plan = planSlotRetry('mockup', healthyExcept('component_inventory'));
        expect(plan.unhealthyDeps).toContain('component_inventory');
        expect(plan.slots).toContain('component_inventory');
        expect(plan.slots).toContain('mockup');
        // The target slot is included alongside the dependency it will be
        // regenerated against.
        expect(plan.slots[plan.slots.length - 1]).toBe('mockup');
    });

    it('pulls a required dependency into the retry batch (implementation_plan ← screen_inventory)', () => {
        const plan = planSlotRetry('implementation_plan', healthyExcept('screen_inventory'));
        expect(plan.unhealthyDeps).toContain('screen_inventory');
        expect(plan.slots).toContain('screen_inventory');
        expect(plan.slots).toContain('implementation_plan');
    });

    it('transitively pulls an unhealthy dep-of-a-dep', () => {
        // mockup ← component_inventory ← screen_inventory. If both are unhealthy,
        // both must be regenerated (screen_inventory feeds component_inventory).
        const plan = planSlotRetry('mockup', healthyExcept('component_inventory', 'screen_inventory'));
        expect(plan.unhealthyDeps).toContain('component_inventory');
        expect(plan.unhealthyDeps).toContain('screen_inventory');
    });

    it('does not include a healthy dependency', () => {
        const plan = planSlotRetry('mockup', healthyExcept('component_inventory'));
        // design_system is a mockup dep but healthy here — not regenerated.
        expect(plan.slots).not.toContain('design_system');
    });
});
