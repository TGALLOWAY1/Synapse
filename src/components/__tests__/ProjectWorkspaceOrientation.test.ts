import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspace = readFileSync(
    resolve(process.cwd(), 'src/components/ProjectWorkspace.tsx'),
    'utf8',
);
const artifactWorkspaceSource = readFileSync(
    resolve(process.cwd(), 'src/components/ArtifactWorkspace.tsx'),
    'utf8',
);

describe('ProjectWorkspace orientation', () => {
    it('does not render the retired global next-action strip', () => {
        expect(workspace).not.toContain('GlobalNextActionStrip');
    });

    it('has no Finalize / readiness-commitment layer left in the workspace', () => {
        // Removed: the readiness review modal, commit/authorize/reopen, the
        // materiality gate, the finalize success modal, the pre-build card,
        // the assumption arrival card and the sharpen flow.
        for (const retired of [
            'ReadinessCheckpoint', 'FinalizationSuccessModal', 'PreBuildCheckpointCard',
            'AssumptionArrivalCard', 'SharpenPlanFlow', 'createReadinessReview',
            'commitReadinessReview', 'reopenReadinessCommitment', 'authorizeReadinessCommitment',
            'deriveMaterialityGateSnapshot', 'handleToggleFinal', 'markSpineFinal',
            'Review readiness', 'Reopen plan', 'Finalize', 'Explore outputs',
        ]) expect(workspace).not.toContain(retired);
    });

    // `structuredPRD` is truthy after the first streamed section, so the
    // outputs pill has to be gated on the run being settled — otherwise it
    // invites the user to build outputs from a half-written plan. The gate is
    // the PRD edit lock: unlike the section grid it also covers the final
    // consistency-review pass, which still rewrites the spine in place.
    it('hides the outputs pill while the PRD is still generating', () => {
        const start = workspace.indexOf('const showAssetsPill =');
        const decl = workspace.slice(start, workspace.indexOf(';', start));

        expect(decl).toContain('!isPrdEditLocked');
        expect(workspace).toContain('const isPrdEditLocked = isPrdRunInFlight(latestSpine,');
    });

    // A second pipeline started mid-run would race the first on the same
    // project; Regenerate Draft waits for the run to settle and says why.
    it('locks Regenerate Draft while a PRD run is in flight', () => {
        const start = workspace.indexOf('onClick={() => { handleRegenerate(); setShowNavOverflow(false); }}');
        const button = workspace.slice(start, workspace.indexOf('</button>', start));

        expect(button).toMatch(/disabled=\{[^}]*isPrdEditLocked[^}]*\}/);
        expect(button).toContain('Regenerate unlocks when generation finishes.');
        const handler = workspace.slice(workspace.indexOf('const handleRegenerate = async'));
        expect(handler.slice(0, handler.indexOf('regenerateInFlight.current = true'))).toContain('isPrdEditLocked) return;');
    });

    // Plan §W6: the outputs CTA states the action only. It never claims build
    // readiness from the planning projection or the advisory packet report.
    it('labels the outputs CTA by action — Generate, Review, or Building', () => {
        const start = workspace.indexOf('const assetsOutputsCtaLabel');
        const label = workspace.slice(start, workspace.indexOf(';', start));
        expect(label).toContain("'Building outputs…'");
        expect(label).toContain("'Review outputs'");
        expect(label).toContain("'Generate outputs'");

        const pillStart = workspace.indexOf('{showAssetsPill && (');
        const pill = workspace.slice(pillStart, workspace.indexOf('</button>', pillStart));
        expect(pill).not.toContain('planningReadiness.isReadyToBuild');
        expect(pill).toContain('aria-label={assetsOutputsCtaLabel}');
    });

    it('evaluates the advisory build packet from the plan and outputs alone', () => {
        const start = workspace.indexOf('const buildPacketReadiness = deriveBuildPacketReadiness(');
        expect(start).toBeGreaterThan(-1);
        // Only the argument object: the function name itself says "Readiness".
        const argsStart = workspace.indexOf('({', start);
        const args = workspace.slice(argsStart, workspace.indexOf('});', argsStart));

        expect(args).toContain('...buildPacketInputs');
        expect(args).not.toMatch(/commit|readiness|planningProjection|currentSpineVersionId/i);
    });

    it('offers output generation on the Build stage itself', () => {
        const bannerStart = workspace.indexOf('{showBuildGenerateBanner && (');
        const artifactStart = workspace.indexOf('<ArtifactWorkspace');
        expect(bannerStart).toBeGreaterThan(-1);
        expect(bannerStart).toBeLessThan(artifactStart);
        const banner = workspace.slice(bannerStart, artifactStart);
        expect(banner).toContain('onClick={handleGenerateAssets}');
        expect(banner).toContain('Generate outputs');
        const gateStart = workspace.indexOf('const showBuildGenerateBanner');
        const gate = workspace.slice(gateStart, workspace.indexOf(';', gateStart));
        expect(gate).toContain('capabilities.canGenerateArtifacts');
        expect(gate).toContain('!isPrdEditLocked');
    });

    it('preserves exact Final Review artifact targets through the workspace renderer', () => {
        const handlerStart = workspace.indexOf('const navigateBuildPacketTarget');
        const handler = workspace.slice(handlerStart, workspace.indexOf('const planReturnTarget', handlerStart));
        const artifactStart = workspace.indexOf('<ArtifactWorkspace');
        const artifactProps = workspace.slice(artifactStart, workspace.indexOf('/>', artifactStart));

        expect(handler).toContain('setWorkspaceInitialBuildPacketTarget(target)');
        expect(artifactProps).toContain('initialBuildPacketTarget={workspaceInitialBuildPacketTarget}');
        expect(artifactWorkspaceSource).toContain('initialBuildPacketSection={buildPacketArtifactTarget?.nodeId === subtype');
        expect(artifactWorkspaceSource).toContain("initiallyOpen={buildPacketArtifactTarget?.nodeId === 'component_inventory'}");
    });

    it('feeds the one-line PlanningStateBar from the planning readiness open items only', () => {
        const start = workspace.indexOf('<PlanningStateBar');
        const props = workspace.slice(start, workspace.indexOf('/>', start));

        expect(props).toContain('openItems={planningReadiness.openItems}');
        expect(props).toContain('onOpenDecisions=');
        expect(props).not.toMatch(/buildPacket|committed|onReviewReadiness|onStartSharpen|readiness=/);
    });

    it('presents the journey as Plan · Decide · Build with the open-item badge', () => {
        const start = workspace.indexOf('const journeyPresentation = deriveJourneyPresentation(');
        const call = workspace.slice(start, workspace.indexOf('});', start));
        expect(call).toContain('decisionCenterOpen');
        expect(call).toContain('openItemCount');
        expect(call).not.toMatch(/planFinalized|canFinalize|readinessOpen/);

        const handlerStart = workspace.indexOf('const handleJourneyStepChange');
        const handler = workspace.slice(handlerStart, workspace.indexOf('const headerPlanStatus', handlerStart));
        expect(handler).toContain("step === 'decide'");
        expect(handler).toContain('openDecisionCenter()');
        expect(handler).toContain("setPipelineStage('workspace')");
    });

    // History Mode selects an old PRD version. The Build stage's retry and
    // regenerate actions would generate outputs from that old PRD and make
    // them current, so Build is never presented against a historical spine.
    it('never presents the Build stage against a historical spine', () => {
        const journeyStart = workspace.indexOf('const journeyPresentation = deriveJourneyPresentation(');
        const journeyCall = workspace.slice(journeyStart, workspace.indexOf('});', journeyStart));
        expect(journeyCall).toContain('viewingHistoricalVersion: isOldVersion');

        const stageStart = workspace.indexOf('const pipelineStage: PipelineStage =');
        expect(stageStart).toBeGreaterThan(-1);
        const stage = workspace.slice(stageStart, workspace.indexOf(';', stageStart));
        expect(stage).toContain('isOldVersion && isOutputPipelineStage(requestedStage)');
        expect(stage).toContain("? 'prd'");

        // Navigating to an output stage leaves History Mode first.
        const setterStart = workspace.indexOf('const applyPresentationStage = useCallback(');
        const setter = workspace.slice(setterStart, workspace.indexOf('}, [', setterStart));
        expect(setter).toContain('if (isOutputPipelineStage(stage)) setViewedSpineId(null);');

        // The header CTA and the Build-stage banner stay hidden there too.
        for (const gate of ['const showAssetsPill =', 'const showBuildGenerateBanner =']) {
            const gateStart = workspace.indexOf(gate);
            expect(workspace.slice(gateStart, workspace.indexOf(';', gateStart))).toContain('!isOldVersion');
        }
    });

    // "Generate anyway" is the durable incomplete-PRD acknowledgement now that
    // Finalize (and its `isFinal`) is gone: recorded on the spine version,
    // asked once per version, and offered inline wherever Sync outputs needs it.
    it('records the incomplete-PRD acknowledgement on the spine version and offers it in Sync outputs', () => {
        const confirmStart = workspace.indexOf('confirmLabel="Generate anyway"');
        expect(confirmStart).toBeGreaterThan(-1);
        const confirm = workspace.slice(confirmStart, workspace.indexOf('</ConfirmDialog>', confirmStart));
        expect(confirm).toContain('acknowledgeIncompleteSpine(projectId, activeSpine.id)');

        const handlerStart = workspace.indexOf('const handleGenerateAssets');
        const handler = workspace.slice(handlerStart, workspace.indexOf('const openDecisionCenter', handlerStart));
        expect(handler).toContain('!isIncompleteAcknowledged(activeSpine)');

        expect(artifactWorkspaceSource).toContain('onAcknowledge: () => acknowledgeIncompleteSpine(projectId, latestSpineId)');
        expect(artifactWorkspaceSource).not.toContain('Acknowledge the incomplete PRD before regenerating outputs.');
    });

    it('keeps critique in Refine while decisions open in the universal slide-over', () => {
        const reviewContainerStart = workspace.indexOf('<ReviewWorkspaceContainer');
        const reviewContainer = workspace.slice(
            reviewContainerStart,
            workspace.indexOf('/>', reviewContainerStart),
        );
        const decisionCenterStart = workspace.indexOf('<DecisionCenterSlideOver');
        const decisionCenter = workspace.slice(
            decisionCenterStart,
            workspace.indexOf('/>', decisionCenterStart),
        );

        expect(workspace).not.toContain('CritiqueGate');
        expect(reviewContainer).not.toContain('critiqueUnlocked');
        expect(reviewContainer).not.toContain('initialRecordId');
        expect(decisionCenter).toContain('initialRecordId={reviewInitialRecordId}');
        expect(decisionCenter).toContain('open={decisionCenterOpen}');
    });

    it('prepares deterministic Careful-sync proposals after importing assumptions', () => {
        const importCall = workspace.indexOf('.importPlanningAssumptions');
        const prepareCall = workspace.indexOf('.prepareCurrentDownstreamArtifactUpdateProposals');
        const effectStart = workspace.lastIndexOf('useEffect(() =>', prepareCall);
        const effect = workspace.slice(effectStart, workspace.indexOf(']);', prepareCall) + 3);

        expect(prepareCall).toBeGreaterThan(importCall);
        expect(effect).toContain('capabilities.canPersistWorkflowState');
        expect(effect).toContain('planningArtifactVersions');
        expect(effect).toContain('planningRecords');
        expect(effect).not.toContain('Application');
        expect(effect).not.toContain('Verification');
    });

    it('only announces a generation checkpoint after an observed active-to-settled transition', () => {
        const effectStart = workspace.indexOf('const previousAssetJobRef');
        const effectEnd = workspace.indexOf('// Incomplete-PRD generation gate', effectStart);
        const effect = workspace.slice(effectStart, effectEnd);
        const summaryRender = workspace.indexOf('<WorkflowCheckpointSummaryCard');
        const artifactWorkspace = workspace.indexOf('<ArtifactWorkspace');

        expect(effect).toContain('previous.key === assetJobKey');
        expect(effect).toContain('previous.active');
        expect(effect).toContain('setCompletedGenerationJobKey(assetJobKey)');
        expect(summaryRender).toBeLessThan(artifactWorkspace);
        expect(workspace).toContain('assetJobKey === completedGenerationJobKey');
        // Dismissal is remembered per generation-job key (localStorage, not a
        // persisted store collection) so a closed banner stays closed across a
        // remount instead of resurfacing on the next visit.
        expect(workspace).toContain('useGenerationCheckpointDismissal(projectId)');
        expect(workspace).toContain('!generationCheckpointDismissal.isDismissed(assetJobKey)');
        expect(workspace).toContain('generationCheckpointDismissal.dismiss(assetJobKey)');
    });

    it('passes one current checkpoint to export with no gate', () => {
        const start = workspace.indexOf('<ExportModal');
        const modal = workspace.slice(start, workspace.indexOf('/>', start));

        expect(modal).toContain('checkpointSummary={exportCheckpointSummary}');
        expect(modal).toContain('onNavigateCheckpoint={openCheckpointDestination}');
        expect(modal).not.toMatch(/buildBlocked|blockingPlanningItems|planningReady/);
    });

    it('lists only the latest plan\'s current substantive critique in the checkpoint', () => {
        const start = workspace.indexOf('const checkpointChallenge = planningSourceSpine');
        const block = workspace.slice(start, workspace.indexOf('const checkpointArtifacts', start));

        expect(block).toContain('deriveChallengeCoverage');
        expect(block).toContain('versionId: planningSourceSpine.id');
        expect(block).toContain('checkpointChallenge?.substantive?.id');
        expect(block).toContain('checkpointChallenge?.untriagedFindings');
        expect(block).toContain('findingId: finding.id');
        expect(block).toContain('issue.reviewId === currentSubstantiveReviewId');
        expect(block).not.toMatch(/planningVerdict|commitment/);
    });

    it('keys session-only workflow state to the project route', () => {
        expect(workspace).toContain(
            "<ProjectWorkspaceSession key={projectId ?? 'invalid-project'} projectId={projectId} />",
        );
    });

    it('still imports PRD assumptions for the latest spine, with no arrival card state', () => {
        const importStart = workspace.indexOf('.importPlanningAssumptions');
        const effect = workspace.slice(workspace.lastIndexOf('useEffect(() =>', importStart), workspace.indexOf(']);', importStart));
        expect(effect).toContain('planningSourceSpine.id');
        expect(workspace).not.toContain('setAssumptionArrival');
    });
});
