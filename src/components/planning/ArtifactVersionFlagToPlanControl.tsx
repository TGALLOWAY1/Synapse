import { artifactConcernPlanningSourceKey } from '../../lib/planning/flagToPlan';
import type { PlanningReturnTarget } from '../../lib/planning/planningNavigation';
import { useProjectStore } from '../../store/projectStore';
import type { Artifact, ArtifactSlotKey, ArtifactVersion } from '../../types';
import { ArtifactFlagToPlanControl } from './ArtifactFlagToPlanControl';

interface ArtifactVersionFlagToPlanControlProps {
    projectId: string;
    spineVersionId: string;
    artifact?: Artifact;
    preferred: ArtifactVersion;
    canPersistWorkflowState: boolean;
    onOpenPlanningRecord?: (recordId?: string, returnTo?: PlanningReturnTarget) => void;
}

function planningSlotForArtifact(artifact: Artifact): ArtifactSlotKey | undefined {
    if (artifact.type === 'mockup') return 'mockup';
    if (artifact.type === 'core_artifact') return artifact.subtype;
    return undefined;
}

export function ArtifactVersionFlagToPlanControl({
    projectId,
    spineVersionId,
    artifact,
    preferred,
    canPersistWorkflowState,
    onOpenPlanningRecord,
}: ArtifactVersionFlagToPlanControlProps) {
    if (!artifact || !canPersistWorkflowState || preferred.artifactId !== artifact.id) {
        return null;
    }
    const artifactSlot = planningSlotForArtifact(artifact);
    if (!artifactSlot) return null;

    return (
        <ArtifactFlagToPlanControl
            artifactTitle={artifact.title}
            onCreate={({ title, statement }) => {
                const trimmedTitle = title.trim();
                const trimmedStatement = statement.trim();
                return useProjectStore.getState().flagPlanningConcern(projectId, {
                    sourceKey: artifactConcernPlanningSourceKey({
                        artifactId: artifact.id,
                        artifactVersionId: preferred.id,
                        title: trimmedTitle,
                        statement: trimmedStatement,
                    }),
                    artifactId: artifact.id,
                    artifactVersionId: preferred.id,
                    artifactSubtype: artifact.type === 'core_artifact'
                        ? artifact.subtype
                        : undefined,
                    artifactSlot,
                    spineVersionId,
                    title: trimmedTitle,
                    statement: trimmedStatement,
                    materiality: 'normal',
                    locator: {
                        entityType: 'artifact',
                        entityId: artifact.id,
                    },
                });
            }}
            onReviewNow={onOpenPlanningRecord
                ? (recordId) => onOpenPlanningRecord(recordId, {
                    destination: {
                        kind: 'artifact',
                        artifactId: artifact.id,
                        nodeId: artifactSlot,
                    },
                    label: `Back to ${artifact.title}`,
                })
                : undefined}
        />
    );
}
