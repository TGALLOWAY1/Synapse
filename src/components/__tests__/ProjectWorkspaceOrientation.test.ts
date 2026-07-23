import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workspace = readFileSync(
    resolve(process.cwd(), 'src/components/ProjectWorkspace.tsx'),
    'utf8',
);

describe('ProjectWorkspace orientation', () => {
    it('places one global strip after the rail and before stage content', () => {
        const rail = workspace.indexOf('<PipelineStageBar');
        const strip = workspace.indexOf('<GlobalNextActionStrip');
        const main = workspace.indexOf('{/* Main Workspace Area');

        expect(strip).toBeGreaterThan(rail);
        expect(strip).toBeLessThan(main);
        expect(workspace.match(/<GlobalNextActionStrip/g)).toHaveLength(1);
    });

    it('does not pass global primary props into PlanningStateBar', () => {
        const start = workspace.indexOf('<PlanningStateBar');
        const props = workspace.slice(start, workspace.indexOf('/>', start));

        expect(props).not.toContain('attention=');
        expect(props).not.toContain('onOpenAttention=');
        expect(props).not.toContain('onNextAction=');
    });

    it('routes global items through the direct commit-aware dispatcher', () => {
        const start = workspace.indexOf('const openPlanningAttention');
        const handler = workspace.slice(start, workspace.indexOf('const handleExport', start));

        expect(handler).toContain('dispatchPlanningAttentionItem');
        expect(handler).toContain('onCommit: handleToggleFinal');
        expect(handler).toContain('onNavigate:');
    });

    it('keeps decisions-first Challenge orientation without gating critique', () => {
        const handlerStart = workspace.indexOf('const handlePipelineStageChange');
        const handler = workspace.slice(handlerStart, workspace.indexOf('const activeSpine', handlerStart));
        const reviewContainerStart = workspace.indexOf('<ReviewWorkspaceContainer');
        const reviewContainer = workspace.slice(
            reviewContainerStart,
            workspace.indexOf('/>', reviewContainerStart),
        );

        expect(handler).toContain("planningReadiness.openDecisionCount > 0 ? 'decisions' : 'review'");
        expect(workspace).not.toContain('CritiqueGate');
        expect(reviewContainer).not.toContain('critiqueUnlocked');
    });

    it('prepares deterministic Careful-sync snapshots after importing assumptions', () => {
        const importCall = workspace.indexOf('.importPlanningAssumptions');
        const generateCall = workspace.indexOf('.generateDownstreamUpdatePlans');
        const effectStart = workspace.lastIndexOf('useEffect(() =>', generateCall);
        const effect = workspace.slice(effectStart, workspace.indexOf(']);', generateCall) + 3);

        expect(generateCall).toBeGreaterThan(importCall);
        expect(effect).toContain('capabilities.canPersistWorkflowState');
        expect(effect).toContain('planningArtifactVersions');
        expect(effect).toContain('planningRecords');
        expect(effect).not.toContain('Proposal');
        expect(effect).not.toContain('Application');
        expect(effect).not.toContain('Verification');
    });

    it('shows the advisory pre-build checkpoint inline below the stage rail', () => {
        const rail = workspace.indexOf('<PipelineStageBar');
        const checkpoint = workspace.indexOf('<PreBuildCheckpointCard');
        const strip = workspace.indexOf('<GlobalNextActionStrip');
        const rankingStart = workspace.indexOf('const preBuildAttentionItem');
        const ranking = workspace.slice(
            rankingStart,
            workspace.indexOf('const readinessAuthorization', rankingStart),
        );

        expect(checkpoint).toBeGreaterThan(rail);
        expect(checkpoint).toBeLessThan(strip);
        expect(workspace).not.toContain('PreBuildCheckModal');
        expect(ranking).toContain('planningAttention.primary');
        expect(ranking).toContain("item.destination.kind !== 'planning_record'");
        expect(workspace).toContain('openPlanningAttention(preBuildAttentionItem)');
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
        expect(workspace).toContain('assetJobKey !== dismissedGenerationJobKey');
    });

    it('passes one current checkpoint to export without a planning-ready shortcut', () => {
        const start = workspace.indexOf('<ExportModal');
        const modal = workspace.slice(start, workspace.indexOf('/>', start));

        expect(modal).toContain('checkpointSummary={exportCheckpointSummary}');
        expect(modal).toContain('onNavigateCheckpoint={openCheckpointDestination}');
        expect(modal).not.toContain('planningReady');
    });

    it('uses only the current trusted commitment and current substantive critique', () => {
        const verdictStart = workspace.indexOf('const checkpointCommittedReadiness');
        const verdict = workspace.slice(
            verdictStart,
            workspace.indexOf('const checkpointArtifacts', verdictStart),
        );

        expect(verdict).toContain('compareReadinessReviewCurrentness');
        expect(verdict).toContain('checkpointReadinessReviewInput');
        expect(verdict).toContain('item.review.spineVersionId === planningSourceSpine?.id');
        expect(verdict).toContain('checkpointCommittedReadiness?.commitment.activeCommit');
        expect(verdict).toContain('checkpointCommittedReadiness?.commitment.authorization');
        expect(verdict).toContain("label: 'Working plan'");
        expect(verdict).toContain('checkpointStrictChallenge?.substantive?.id');
        expect(verdict).toContain('checkpointStrictChallenge?.untriagedFindings');
        expect(verdict).toContain('findingId: finding.id');
        expect(verdict).toContain('issue.reviewId === currentSubstantiveReviewId');
    });

    it('keys session-only workflow state to the project route', () => {
        expect(workspace).toContain(
            "<ProjectWorkspaceSession key={projectId ?? 'invalid-project'} projectId={projectId} />",
        );
    });

    it('binds an assumption arrival and batch result to the exact latest spine', () => {
        const summaryStart = workspace.indexOf('const assumptionArrivalSummary');
        const summary = workspace.slice(
            summaryStart,
            workspace.indexOf('// Keep immutable Careful-sync snapshots', summaryStart),
        );
        const importStart = workspace.indexOf('.importPlanningAssumptions');
        const importEffect = workspace.slice(
            workspace.lastIndexOf('useEffect(() =>', importStart),
            summaryStart,
        );

        expect(summary).toContain('assumptionArrival.spineVersionId === planningSourceSpine?.id');
        expect(importEffect).toContain('if (imported.importedAssumptionIds.length)');
        expect(importEffect).toContain('clearAssumptionBatchResult()');
    });
});
