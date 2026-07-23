import { useEffect, useMemo, useRef } from 'react';
import { canPerformProjectAction } from '../../lib/projectCapabilities';
import {
    assetOpenItemPlanningSourceKey,
    assetOpenItemTitle,
    deriveAssetOpenItems,
    type AssetOpenItem,
    type AssetOpenItemSource,
} from '../../lib/planning/assetOpenItems';
import type { PlanningDestination } from '../../lib/planning/planningNavigation';
import type { Artifact, ArtifactSlotKey } from '../../types';
import { projectDecision } from '../../lib/planning/decisionProjection';
import { useProjectStore } from '../../store/projectStore';
import { DecisionCenter } from './DecisionCenter';
import { buildPlanningRecordViews } from './planningRecordViews';
import { useAssumptionValidationActions } from './useAssumptionValidationActions';
import { useBatchVerdictCoordinator } from './useBatchVerdictCoordinator';
import { useDecisionImpactActions } from './useDecisionImpactActions';
import { useDecisionOptionSuggestions } from './useDecisionOptionSuggestions';

interface DecisionCenterContainerProps {
    projectId: string;
    initialRecordId?: string;
    /** Jumps to the existing Explore/Build surface. Open decisions remain
     * advisory and never disable this action. */
    onContinueToExplore?: () => void;
    /** Navigates to the asset region an advisory open item was scanned from. */
    onNavigateToAsset?: (destination: PlanningDestination) => void;
}

const EMPTY_PROJECT_COLLECTION: never[] = [];
const MAX_EAGER_OPTION_PREPARATIONS = 6;

/**
 * Store-backed Decision Center controller that can be mounted independently
 * from specialist critique. The slide-over and any future embedded surface use
 * this one authority-preserving action path.
 */
const planningSlotForArtifact = (artifact: Artifact): ArtifactSlotKey | undefined => {
    if (artifact.type === 'mockup') return 'mockup';
    if (artifact.type === 'core_artifact') return artifact.subtype;
    return undefined;
};

export function DecisionCenterContainer({
    projectId,
    initialRecordId,
    onContinueToExplore,
    onNavigateToAsset,
}: DecisionCenterContainerProps) {
    const project = useProjectStore(state => state.projects[projectId]);
    const spines = useProjectStore(
        state => state.spineVersions[projectId] ?? EMPTY_PROJECT_COLLECTION,
    );
    const planningRecords = useProjectStore(
        state => state.planningRecords[projectId] ?? EMPTY_PROJECT_COLLECTION,
    );
    const artifacts = useProjectStore(
        state => state.artifacts[projectId] ?? EMPTY_PROJECT_COLLECTION,
    );
    const artifactVersions = useProjectStore(
        state => state.artifactVersions[projectId] ?? EMPTY_PROJECT_COLLECTION,
    );
    const canWrite = canPerformProjectAction(projectId, 'persist');
    const latestSpine = spines.find(spine => spine.isLatest);

    // Advisory projection — recomputed on every read, never persisted. Assets
    // no longer flag their own open items; they surface here instead, each one
    // able to navigate back to the exact flow/region it came from.
    const assetOpenItems = useMemo(() => {
        const sources: AssetOpenItemSource[] = [];
        for (const artifact of artifacts) {
            const slot = planningSlotForArtifact(artifact);
            if (!slot || !artifact.currentVersionId) continue;
            const version = artifactVersions.find(v => v.id === artifact.currentVersionId);
            if (!version?.content) continue;
            sources.push({
                artifactId: artifact.id,
                artifactVersionId: version.id,
                slot,
                subtype: artifact.subtype,
                artifactTitle: artifact.title,
                content: version.content,
            });
        }
        return deriveAssetOpenItems(sources);
    }, [artifacts, artifactVersions]);

    const promotedAssetItemIds = useMemo(() => {
        const keys = new Set(
            planningRecords.flatMap(record => (record.sources ?? []).map(source => source.key)),
        );
        return new Set(
            assetOpenItems
                .filter(item => keys.has(assetOpenItemPlanningSourceKey(item)))
                .map(item => item.id),
        );
    }, [assetOpenItems, planningRecords]);

    const handleAddAssetItemToPlan = (item: AssetOpenItem) => {
        if (!canWrite || !latestSpine) return;
        useProjectStore.getState().flagPlanningConcern(projectId, {
            sourceKey: assetOpenItemPlanningSourceKey(item),
            artifactId: item.artifactId,
            artifactVersionId: item.artifactVersionId,
            artifactSubtype: item.slot === 'mockup' ? undefined : item.slot,
            artifactSlot: item.slot,
            spineVersionId: latestSpine.id,
            title: assetOpenItemTitle(item),
            statement: item.text,
            materiality: 'normal',
            locator: { entityType: 'artifact', entityId: item.artifactId },
        });
    };

    const handleOpenAssetItem = (item: AssetOpenItem) => {
        onNavigateToAsset?.({
            kind: 'artifact',
            artifactId: item.artifactId,
            nodeId: item.slot,
            region: {
                label: item.locationLabel,
                ...(item.flowId ? { flowId: item.flowId } : {}),
                ...(typeof item.flowStepIndex === 'number'
                    ? { flowStepIndex: item.flowStepIndex }
                    : {}),
            },
        });
    };
    const { optionSuggestions, prepareDecisionOptions } = useDecisionOptionSuggestions({
        projectId,
        canWrite,
    });

    // Bound eager preparation to one small batch per mount. Opening a record
    // beyond the batch still prepares its options through DecisionCenter's
    // selected-record effect.
    const eagerPreparedIds = useRef(new Set<string>());
    useEffect(() => {
        if (!canWrite) return;
        for (const record of planningRecords) {
            if (eagerPreparedIds.current.size >= MAX_EAGER_OPTION_PREPARATIONS) break;
            if (record.type !== 'decision' && record.type !== 'open_question') continue;
            if (!['open', 'proposed'].includes(projectDecision(record).status)) continue;
            if (record.decisionOptions?.length || eagerPreparedIds.current.has(record.id)) continue;
            eagerPreparedIds.current.add(record.id);
            void prepareDecisionOptions(record.id);
        }
    }, [canWrite, planningRecords, prepareDecisionOptions]);

    const {
        handleGenerateAssumptionValidationPlan,
        handleRecordAssumptionValidationPlan,
        handleAddAssumptionEvidence,
        handleRetractAssumptionEvidence,
        handleCorrectAssumptionEvidence,
        handleInterpretAssumptionEvidence,
        handleRecordAssumptionOutcome,
        handleRecordAssumptionTreatment,
        handleReopenAssumptionOutcome,
    } = useAssumptionValidationActions({ projectId, canWrite });
    const {
        alignmentAnalysis,
        handleDecisionAction,
        handlePreviewImpact,
        handleAlignmentProposalReview,
        handleRequestAlignmentProposal,
        handleApplyToPlan,
    } = useDecisionImpactActions({ projectId, canWrite, planningRecords });
    const recommendationBatch = useBatchVerdictCoordinator({
        projectId,
        canWrite,
        prepareImpact: handlePreviewImpact,
    });
    const planningViews = buildPlanningRecordViews({
        planningRecords,
        latestSpine,
        alignmentAnalysis,
        optionSuggestions,
    });

    if (!project || !latestSpine?.structuredPRD) {
        return (
            <div className="p-6 text-sm text-neutral-500">
                A structured working plan is needed before Synapse can open the Decision Center.
            </div>
        );
    }

    return (
        <DecisionCenter
            records={planningViews}
            initialSelectedId={initialRecordId}
            readOnly={!canWrite}
            onDecide={handleDecisionAction}
            onPrepareOptions={recordId => void prepareDecisionOptions(recordId)}
            recommendationBatchBusy={recommendationBatch.busy}
            recommendationBatchResult={recommendationBatch.result}
            onAcceptRecommendations={candidates => void recommendationBatch.runBatch(candidates)}
            onPreviewImpact={handlePreviewImpact}
            onApplyToPlan={handleApplyToPlan}
            onReviewAlignmentProposal={handleAlignmentProposalReview}
            onRequestAlignmentProposal={handleRequestAlignmentProposal}
            onGenerateAssumptionValidationPlan={handleGenerateAssumptionValidationPlan}
            onRecordAssumptionValidationPlan={handleRecordAssumptionValidationPlan}
            onAddAssumptionEvidence={handleAddAssumptionEvidence}
            onCorrectAssumptionEvidence={handleCorrectAssumptionEvidence}
            onRetractAssumptionEvidence={handleRetractAssumptionEvidence}
            onInterpretAssumptionEvidence={handleInterpretAssumptionEvidence}
            onRecordAssumptionOutcome={handleRecordAssumptionOutcome}
            onRecordAssumptionTreatment={handleRecordAssumptionTreatment}
            onReopenAssumptionOutcome={handleReopenAssumptionOutcome}
            onContinueToExplore={onContinueToExplore}
            assetOpenItems={assetOpenItems}
            assetOpenItemsPromotedIds={promotedAssetItemIds}
            onOpenAssetItem={onNavigateToAsset ? handleOpenAssetItem : undefined}
            onAddAssetItemToPlan={handleAddAssetItemToPlan}
        />
    );
}
