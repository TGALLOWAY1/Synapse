import { describe, expect, it } from 'vitest';
import {
    implementationPlanAnchor,
    implementationPlanNavigationTarget,
} from '../implementationPlanNavigation';
import type { DownstreamUpdateRegion } from '../downstreamUpdatePlan';

describe('implementation-plan update navigation', () => {
    it('maps every rendered structured region to its owning tab and stable anchor', () => {
        const cases: Array<{ region: DownstreamUpdateRegion; expected: ReturnType<typeof implementationPlanNavigationTarget> }> = [
            {
                region: { kind: 'implementation_plan', section: 'architecture', aspect: 'storage', entryIndex: 1, entryLabel: 'Local storage.' },
                expected: { tab: 'overview', anchorId: implementationPlanAnchor.architecture(1) },
            },
            {
                region: { kind: 'implementation_plan', section: 'delivery', aspect: 'risk', collection: 'risks', entryIndex: 0, entryLabel: 'Recovery risk' },
                expected: { tab: 'overview', anchorId: implementationPlanAnchor.risk(0) },
            },
            {
                region: { kind: 'implementation_plan', section: 'delivery', aspect: 'task', collection: 'tasks', milestoneId: 'M 1', taskId: 'Task/API', entryIndex: 0, entryLabel: 'Build API' },
                expected: { tab: 'milestones', milestoneId: 'M 1', anchorId: implementationPlanAnchor.task('M 1', 'Task/API') },
            },
        ];
        cases.forEach(({ region, expected }) => expect(implementationPlanNavigationTarget(region)).toEqual(expected));
    });

    it('does not claim exact navigation for broad or unrendered legacy regions', () => {
        expect(implementationPlanNavigationTarget({
            kind: 'artifact_review', reason: 'legacy_provenance', label: 'Legacy implementation plan',
        })).toBeUndefined();
        expect(implementationPlanNavigationTarget({
            kind: 'implementation_plan', section: 'delivery', aspect: 'acceptance_criterion',
            collection: 'definition_of_done', entryIndex: 0, entryLabel: 'Global criterion',
        })).toBeUndefined();
    });

    it('no longer deep-links removed surfaces (critical path, quality gates)', () => {
        // The Build Timeline is the single sequencing view and Synapse has no
        // validation/quality-gate surface — these regions list as plain text.
        expect(implementationPlanNavigationTarget({
            kind: 'implementation_plan', section: 'delivery', aspect: 'sequencing_assumption',
            collection: 'critical_path', entryIndex: 2, entryLabel: 'Release',
        })).toBeUndefined();
        expect(implementationPlanNavigationTarget({
            kind: 'implementation_plan', section: 'delivery', aspect: 'testing_requirement',
            collection: 'quality_gates', qualityGateId: 'global-gate', entryIndex: 0, entryLabel: 'Release gate',
        })).toBeUndefined();
    });
});
