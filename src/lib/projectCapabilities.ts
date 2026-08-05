import { isShowcaseProjectId } from '../data/demoProject';

export interface ProjectCapabilities {
    isReadOnly: boolean;
    canExplore: boolean;
    canEditProjectContent: boolean;
    canChangeFinality: boolean;
    canEditArtifacts: boolean;
    canReviewArtifacts: boolean;
    canGenerateArtifacts: boolean;
    canManageDesignSystem: boolean;
    canPersistWorkflowState: boolean;
    canExportExternally: boolean;
    /** Provider/key setup nudges (e.g. "no OpenAI key configured"). Showcase
     * viewers can't generate anyway, so configuration warnings are noise on
     * the product's shop window — presentation-only, never a write guard. */
    showsProviderSetupWarnings: boolean;
}

export type DurableProjectCapability = Exclude<keyof ProjectCapabilities, 'isReadOnly' | 'canExplore' | 'showsProviderSetupWarnings'>;

type ProjectIdentity = { id: string } | null | undefined;

const EDITABLE_CAPABILITIES: ProjectCapabilities = Object.freeze({
    isReadOnly: false,
    canExplore: true,
    canEditProjectContent: true,
    canChangeFinality: true,
    canEditArtifacts: true,
    canReviewArtifacts: true,
    canGenerateArtifacts: true,
    canManageDesignSystem: true,
    canPersistWorkflowState: true,
    canExportExternally: true,
    showsProviderSetupWarnings: true,
});

const READ_ONLY_CAPABILITIES: ProjectCapabilities = Object.freeze({
    isReadOnly: true,
    canExplore: true,
    canEditProjectContent: false,
    canChangeFinality: false,
    canEditArtifacts: false,
    canReviewArtifacts: false,
    canGenerateArtifacts: false,
    canManageDesignSystem: false,
    canPersistWorkflowState: false,
    canExportExternally: false,
    showsProviderSetupWarnings: false,
});

const UNAVAILABLE_CAPABILITIES: ProjectCapabilities = Object.freeze({
    ...READ_ONLY_CAPABILITIES,
    canExplore: false,
});

/**
 * The authoritative durable-action policy for a project. A missing project is
 * deliberately unavailable rather than optimistically editable; callers must
 * pass an identity that actually exists in the active project namespace.
 */
export function getProjectCapabilities(project: ProjectIdentity): ProjectCapabilities {
    if (!project?.id) return UNAVAILABLE_CAPABILITIES;
    // Showcase projects — the public demo and every gallery slot — share one
    // read-only policy; they are all hydrated from pinned cloud snapshots.
    return isShowcaseProjectId(project.id) ? READ_ONLY_CAPABILITIES : EDITABLE_CAPABILITIES;
}

export class ProjectCapabilityError extends Error {
    readonly capability: DurableProjectCapability;
    readonly projectId?: string;

    constructor(project: ProjectIdentity, capability: DurableProjectCapability) {
        super(isShowcaseProjectId(project?.id)
            ? 'This example project is read-only.'
            : 'This project is unavailable or does not allow that action.');
        this.name = 'ProjectCapabilityError';
        this.capability = capability;
        this.projectId = project?.id;
    }
}

/** Domain-boundary guard for all durable project mutations. */
export function assertProjectCapability(
    project: ProjectIdentity,
    capability: DurableProjectCapability,
): void {
    if (!getProjectCapabilities(project)[capability]) {
        throw new ProjectCapabilityError(project, capability);
    }
}

// ---------------------------------------------------------------------------
// Id-based convenience layer used by the planning/review surfaces and the
// store-action guard. It maps the coarse action vocabulary onto the capability
// model above so both express ONE policy.

export type ProjectAction = 'explore' | 'persist' | 'generate' | 'image' | 'external';

const ACTION_CAPABILITY: Record<ProjectAction, keyof ProjectCapabilities> = {
    explore: 'canExplore',
    persist: 'canPersistWorkflowState',
    generate: 'canGenerateArtifacts',
    image: 'canGenerateArtifacts',
    external: 'canExportExternally',
};

/** Unlike `getProjectCapabilities`, an unknown id is treated as a standard
 * project — call sites pass ids from live routes/stores, and the showcase
 * ids (demo + gallery slots) are the only read-only identities. */
export function canPerformProjectAction(projectId: string | undefined, action: ProjectAction): boolean {
    const capabilities = isShowcaseProjectId(projectId) ? READ_ONLY_CAPABILITIES : EDITABLE_CAPABILITIES;
    return capabilities[ACTION_CAPABILITY[action]];
}

/** Store actions which change persisted project data. Keep this list explicit:
 * adding a new write is a conscious policy decision, not a UI convention. */
export const PERSISTENT_STORE_ACTIONS = new Set<string>([
    'updateSpineText', 'regenerateSpine', 'markSpineFinal', 'createBranch', 'addBranchMessage',
    'mergeBranch', 'stageBranch', 'unstageBranch', 'applyStagedBranchesToSpine',
    'deleteBranch', 'updateStructuredPRD', 'updateSpineStructuredPRD',
    'editSpineStructuredPRD', 'compareAndAppendStructuredPRD', 'revertSpineToVersion', 'updateSpineQualityScores',
    'updateProjectProductMetadata', 'markSpineGenerationStarted', 'setSpineSafetyReview',
    'setSpineError', 'initPreflightSession', 'setPreflightQuestions', 'setPreflightAnswer',
    'setPreflightIndex', 'setPreflightSummary', 'completePreflightSession', 'setPreflightError',
    'setProjectDesignSystemPreset', 'markDesignSetupComplete', 'createArtifact', 'updateArtifact',
    'deleteArtifact', 'createArtifactVersion', 'revertArtifactToVersion', 'markArtifactCurrentForSpine',
    'acceptArtifactValidationIssue',
    'setPreferredVersion', 'updateArtifactVersionMetadata', 'updateArtifactOverlay',
    'updateFeedbackStatus', 'saveTasks', 'setTaskStatus', 'removeProjectTask', 'recordTaskExports',
    'createReviewRun', 'updateReviewRun', 'createSpecialistRun', 'updateSpecialistRun',
    'addReviewFinding', 'addReviewIssue', 'applyReviewIssueDisposition', 'reopenReviewIssue',
    'createPlanningRecord', 'flagPlanningConcern',
    'supersedeOpenReviewIssues',
    'updatePlanningRecordStatusByUser', 'appendPlanningDecisionEvent', 'importPlanningAssumptions',
    'addPlanningAssessment', 'setPlanningRecordDecisionOptions',
    'createReadinessReview', 'authorizeReadinessCommitment',
    'commitReadinessReview', 'reopenReadinessCommitment',
    'recordDownstreamUpdatePlan', 'generateDownstreamUpdatePlans', 'appendDownstreamUpdatePlanEvent',
    'recordDownstreamArtifactUpdateProposal', 'appendDownstreamArtifactUpdateReviewEvent',
    'recordDownstreamArtifactUpdateApplication', 'recordDownstreamArtifactUpdateVerification',
    'appendDownstreamArtifactUpdateVerificationEvent',
]);

/** Wrap store writes once, at their authoritative shared boundary. Rejections
 * are loud (`ProjectCapabilityError`), matching `assertProjectCapability` —
 * UI surfaces pre-check with `canPerformProjectAction`/`useProjectCapabilities`
 * so an ordinary demo session never reaches this throw. */
export function guardProjectStoreActions<T extends Record<string, unknown>>(state: T): T {
    const mutable = state as Record<string, unknown>;
    for (const name of PERSISTENT_STORE_ACTIONS) {
        const original = mutable[name];
        if (typeof original !== 'function') continue;
        mutable[name] = ((...args: unknown[]) => {
            const projectId = typeof args[0] === 'string' ? args[0] : undefined;
            if (!canPerformProjectAction(projectId, 'persist')) {
                throw new ProjectCapabilityError(projectId ? { id: projectId } : undefined, 'canPersistWorkflowState');
            }
            return (original as (...callArgs: unknown[]) => unknown)(...args);
        });
    }
    return state;
}
