import { DEMO_PROJECT_ID } from '../data/demoProject';

/** The single policy boundary for project behaviour.  The public sample is
 * deliberately inspectable, but never writable. */
export type ProjectAction = 'explore' | 'persist' | 'generate' | 'image' | 'external';

export type ProjectCapabilities = Readonly<{
    explore: boolean;
    persist: boolean;
    generate: boolean;
    image: boolean;
    external: boolean;
}>;

const DEMO_CAPABILITIES: ProjectCapabilities = Object.freeze({
    explore: true, persist: false, generate: false, image: false, external: false,
});
const STANDARD_CAPABILITIES: ProjectCapabilities = Object.freeze({
    explore: true, persist: true, generate: true, image: true, external: true,
});

export function getProjectCapabilities(projectId: string | undefined): ProjectCapabilities {
    return projectId === DEMO_PROJECT_ID ? DEMO_CAPABILITIES : STANDARD_CAPABILITIES;
}

export function canPerformProjectAction(projectId: string | undefined, action: ProjectAction): boolean {
    return getProjectCapabilities(projectId)[action];
}

/** Store actions which change persisted project data. Keep this list explicit:
 * adding a new write is a conscious policy decision, not a UI convention. */
export const PERSISTENT_STORE_ACTIONS = new Set<string>([
    'updateSpineText', 'regenerateSpine', 'markSpineFinal', 'createBranch', 'addBranchMessage',
    'mergeBranch', 'deleteBranch', 'updateStructuredPRD', 'updateSpineStructuredPRD',
    'editSpineStructuredPRD', 'compareAndAppendStructuredPRD', 'revertSpineToVersion', 'updateSpineQualityScores',
    'updateProjectProductMetadata', 'markSpineGenerationStarted', 'setSpineSafetyReview',
    'setSpineError', 'initPreflightSession', 'setPreflightQuestions', 'setPreflightAnswer',
    'setPreflightIndex', 'setPreflightSummary', 'completePreflightSession', 'setPreflightError',
    'setProjectDesignSystemPreset', 'markDesignSetupComplete', 'createArtifact', 'updateArtifact',
    'deleteArtifact', 'createArtifactVersion', 'revertArtifactToVersion', 'markArtifactCurrentForSpine',
    'setPreferredVersion', 'updateArtifactVersionMetadata', 'createFeedbackItem',
    'updateFeedbackStatus', 'saveTasks', 'setTaskStatus', 'removeProjectTask', 'recordTaskExports',
    'createReviewRun', 'updateReviewRun', 'createSpecialistRun', 'updateSpecialistRun',
    'addReviewFinding', 'addReviewIssue', 'applyReviewIssueDisposition', 'createPlanningRecord',
    'supersedeOpenReviewIssues',
    'updatePlanningRecordStatusByUser', 'appendPlanningDecisionEvent', 'importPlanningAssumptions',
    'addPlanningAssessment',
]);

/** Wrap store writes once, at their authoritative shared boundary. */
export function guardProjectStoreActions<T extends Record<string, unknown>>(state: T): T {
    const mutable = state as Record<string, unknown>;
    for (const name of PERSISTENT_STORE_ACTIONS) {
        const original = mutable[name];
        if (typeof original !== 'function') continue;
        mutable[name] = ((...args: unknown[]) => {
            const projectId = typeof args[0] === 'string' ? args[0] : undefined;
            if (!canPerformProjectAction(projectId, 'persist')) return undefined;
            return (original as (...callArgs: unknown[]) => unknown)(...args);
        });
    }
    return state;
}
