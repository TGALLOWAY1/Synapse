import type { DownstreamUpdateRegion } from './downstreamUpdatePlan';

export type ImplementationPlanNavigationTab = 'overview' | 'milestones' | 'quality_gates';

export type ImplementationPlanNavigationTarget = {
    tab: ImplementationPlanNavigationTab;
    anchorId: string;
    milestoneId?: string;
};

const token = (value: string): string => value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'entry';

export const implementationPlanAnchor = {
    architecture: (index: number) => `impl-architecture-${index}`,
    criticalPath: (index: number) => `impl-critical-path-${index}`,
    risk: (index: number) => `impl-risk-${index}`,
    milestone: (milestoneId: string) => `impl-milestone-${token(milestoneId)}`,
    task: (milestoneId: string, taskId: string) => `impl-task-${token(milestoneId)}-${token(taskId)}`,
    dependency: (milestoneId: string, index: number) => `impl-dependency-${token(milestoneId)}-${index}`,
    definitionOfDone: (milestoneId: string, index: number) => `impl-dod-${token(milestoneId)}-${index}`,
    promptCriterion: (milestoneId: string, promptPackId: string, index: number) => `impl-prompt-criterion-${token(milestoneId)}-${token(promptPackId)}-${index}`,
    validationCommand: (milestoneId: string, index: number) => `impl-validation-${token(milestoneId)}-${index}`,
    qualityGate: (milestoneId: string | undefined, gateId: string, index: number) => `impl-quality-gate-${milestoneId ? token(milestoneId) : 'global'}-${token(gateId)}-${index}`,
};

export function implementationPlanNavigationTarget(
    region: DownstreamUpdateRegion,
): ImplementationPlanNavigationTarget | undefined {
    if (region.kind !== 'implementation_plan') return undefined;
    if (region.section === 'architecture') return {
        tab: 'overview', anchorId: implementationPlanAnchor.architecture(region.entryIndex),
    };
    if (region.collection === 'risks') return {
        tab: 'overview', anchorId: implementationPlanAnchor.risk(region.entryIndex),
    };
    if (region.collection === 'critical_path') return {
        tab: 'overview', anchorId: implementationPlanAnchor.criticalPath(region.entryIndex),
    };
    if (region.collection === 'quality_gates' && region.qualityGateId) return {
        tab: 'quality_gates',
        anchorId: implementationPlanAnchor.qualityGate(region.milestoneId, region.qualityGateId, region.entryIndex),
        ...(region.milestoneId ? { milestoneId: region.milestoneId } : {}),
    };
    if (!region.milestoneId) return undefined;
    if (region.collection === 'milestones') return {
        tab: 'milestones', anchorId: implementationPlanAnchor.milestone(region.milestoneId), milestoneId: region.milestoneId,
    };
    if (region.collection === 'tasks' && region.taskId) return {
        tab: 'milestones', anchorId: implementationPlanAnchor.task(region.milestoneId, region.taskId), milestoneId: region.milestoneId,
    };
    if (region.collection === 'dependencies') return {
        tab: 'milestones', anchorId: implementationPlanAnchor.dependency(region.milestoneId, region.entryIndex), milestoneId: region.milestoneId,
    };
    if (region.collection === 'definition_of_done') return {
        tab: 'milestones', anchorId: implementationPlanAnchor.definitionOfDone(region.milestoneId, region.entryIndex), milestoneId: region.milestoneId,
    };
    if (region.collection === 'prompt_acceptance_criteria' && region.promptPackId) return {
        tab: 'milestones',
        anchorId: implementationPlanAnchor.promptCriterion(region.milestoneId, region.promptPackId, region.entryIndex),
        milestoneId: region.milestoneId,
    };
    if (region.collection === 'validation_commands') return {
        tab: 'milestones', anchorId: implementationPlanAnchor.validationCommand(region.milestoneId, region.entryIndex), milestoneId: region.milestoneId,
    };
    return undefined;
}
