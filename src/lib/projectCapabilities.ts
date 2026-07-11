import { DEMO_PROJECT_ID } from '../data/demoProject';

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
}

export type DurableProjectCapability = Exclude<keyof ProjectCapabilities, 'isReadOnly' | 'canExplore'>;

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
    return project.id === DEMO_PROJECT_ID ? READ_ONLY_CAPABILITIES : EDITABLE_CAPABILITIES;
}

export class ProjectCapabilityError extends Error {
    readonly capability: DurableProjectCapability;
    readonly projectId?: string;

    constructor(project: ProjectIdentity, capability: DurableProjectCapability) {
        super(project?.id === DEMO_PROJECT_ID
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
