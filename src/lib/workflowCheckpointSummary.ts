import type { PlanningDestination } from './planning/planningNavigation';
import type { ArtifactValidationDisposition } from '../types';

export type WorkflowCheckpointContext = 'generation' | 'export';
export type WorkflowCheckpointSeverity = 'attention' | 'advisory';
export type WorkflowCheckpointSignalKind =
    | 'critique'
    | 'blocking_validation'
    | 'accepted_validation'
    | 'advisory_validation'
    | 'generation_failure'
    | 'alignment';

export type WorkflowCheckpointSignal = {
    id: string;
    kind: WorkflowCheckpointSignalKind;
    severity: WorkflowCheckpointSeverity;
    label: string;
    detail?: string;
};

export type WorkflowCheckpointArtifactInput = {
    artifactId: string;
    label: string;
    visible: boolean;
    destination: PlanningDestination;
    validationDisposition?: ArtifactValidationDisposition;
    /** Legacy adapter input retained for callers that have not migrated to the
     * typed validation policy yet. */
    validationBlockers?: string[];
    validationWarnings?: string[];
    generationStatus?: 'done' | 'needs_review' | 'error' | 'interrupted';
    generationError?: string;
    alignment?: {
        state: 'aligned' | 'possibly_affected' | 'stale';
        summary: string;
        blocksBuildReadiness: boolean;
    };
};

export type WorkflowCheckpointCritiqueInput = {
    issueId: string;
    label: string;
    detail?: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    implementationImpact: 'blocker' | 'resolve_before_build' | 'deferrable';
    destination: PlanningDestination;
};

export type WorkflowCheckpointPlanningVerdict = {
    kind: 'finalized' | 'working_plan';
    label: string;
    acceptedRisks?: string[];
    rationale?: string;
    containment?: string;
};

export type WorkflowCheckpointRow = {
    id: string;
    label: string;
    severity: WorkflowCheckpointSeverity;
    destination: PlanningDestination;
    signals: WorkflowCheckpointSignal[];
};

export type WorkflowCheckpointSummary = {
    context: WorkflowCheckpointContext;
    headline: string;
    supportingText: string;
    planningVerdict: WorkflowCheckpointPlanningVerdict;
    rows: WorkflowCheckpointRow[];
    counts: {
        totalArtifacts: number;
        readyArtifacts: number;
        rowCount: number;
        attentionSignals: number;
        advisorySignals: number;
    };
};

export type WorkflowCheckpointSummaryInput = {
    context: WorkflowCheckpointContext;
    planningVerdict: WorkflowCheckpointPlanningVerdict;
    artifacts: WorkflowCheckpointArtifactInput[];
    critiqueIssues: WorkflowCheckpointCritiqueInput[];
};

const severityWeight: Record<WorkflowCheckpointSeverity, number> = {
    attention: 2,
    advisory: 1,
};

const strongestSeverity = (signals: WorkflowCheckpointSignal[]): WorkflowCheckpointSeverity =>
    signals.reduce<WorkflowCheckpointSeverity>(
        (strongest, signal) => severityWeight[signal.severity] > severityWeight[strongest]
            ? signal.severity
            : strongest,
        'advisory',
    );

const nonEmptyStrings = (value: string[] | undefined): string[] =>
    [...new Set((value ?? []).map(item => item.trim()).filter(Boolean))];

function artifactSignals(artifact: WorkflowCheckpointArtifactInput): WorkflowCheckpointSignal[] {
    const signals: WorkflowCheckpointSignal[] = [];
    const typedBlockers = artifact.validationDisposition?.blockers ?? [];
    const blockers = typedBlockers.length > 0
        ? typedBlockers.map(blocker => blocker.message)
        : nonEmptyStrings(artifact.validationBlockers);
    if (
        blockers.length > 0
        && artifact.validationDisposition?.effectiveStatus === 'accepted_issue'
        && artifact.validationDisposition.accepted
    ) {
        signals.push({
            id: `${artifact.artifactId}:accepted-validation`,
            kind: 'accepted_validation',
            severity: 'advisory',
            label: blockers.length === 1
                ? 'Accepted validation issue'
                : `${blockers.length} accepted validation issues`,
            detail: `${blockers.join(' · ')} Rationale: ${
                artifact.validationDisposition.accepted.rationale
            }`,
        });
    } else if (blockers.length > 0) {
        signals.push({
            id: `${artifact.artifactId}:blocking-validation`,
            kind: 'blocking_validation',
            severity: 'attention',
            label: blockers.length === 1 ? 'Validation issue' : `${blockers.length} validation issues`,
            detail: blockers.join(' · '),
        });
    }

    const warnings = nonEmptyStrings(artifact.validationWarnings);
    if (warnings.length > 0) {
        signals.push({
            id: `${artifact.artifactId}:advisory-validation`,
            kind: 'advisory_validation',
            severity: 'advisory',
            label: warnings.length === 1 ? 'Validation note' : `${warnings.length} validation notes`,
            detail: warnings.join(' · '),
        });
    }

    if (artifact.generationStatus === 'error' || artifact.generationStatus === 'interrupted') {
        signals.push({
            id: `${artifact.artifactId}:generation-${artifact.generationStatus}`,
            kind: 'generation_failure',
            severity: 'attention',
            label: artifact.generationStatus === 'error' ? 'Generation failed' : 'Generation interrupted',
            detail: artifact.generationError,
        });
    }

    if (artifact.alignment && artifact.alignment.state !== 'aligned') {
        signals.push({
            id: `${artifact.artifactId}:alignment`,
            kind: 'alignment',
            severity: artifact.alignment.blocksBuildReadiness ? 'attention' : 'advisory',
            label: artifact.alignment.state === 'stale' ? 'Output is out of date' : 'Output may be affected',
            detail: artifact.alignment.summary,
        });
    }
    return signals;
}

function critiqueSeverity(issue: WorkflowCheckpointCritiqueInput): WorkflowCheckpointSeverity {
    if (issue.implementationImpact === 'blocker' || issue.implementationImpact === 'resolve_before_build') {
        return 'attention';
    }
    return issue.severity === 'critical' || issue.severity === 'high' ? 'attention' : 'advisory';
}

function checkpointCopy(
    context: WorkflowCheckpointContext,
    counts: WorkflowCheckpointSummary['counts'],
): Pick<WorkflowCheckpointSummary, 'headline' | 'supportingText'> {
    if (counts.rowCount === 0) {
        return context === 'generation'
            ? {
                headline: 'Generation complete',
                supportingText: `${counts.readyArtifacts} output${
                    counts.readyArtifacts === 1 ? '' : 's'
                } ready. No current critique, validation, or alignment notes need your attention.`,
            }
            : {
                headline: 'Ready to export',
                supportingText: 'No current critique, validation, or alignment notes need your attention.',
            };
    }

    const attention = counts.attentionSignals > 0
        ? `${counts.attentionSignals} item${counts.attentionSignals === 1 ? '' : 's'} to review`
        : `${counts.advisorySignals} advisory note${counts.advisorySignals === 1 ? '' : 's'}`;
    return context === 'generation'
        ? {
            headline: `Generation complete — ${attention}`,
            supportingText: `${counts.readyArtifacts} of ${counts.totalArtifacts} output${
                counts.totalArtifacts === 1 ? '' : 's'
            } ready. Your saved outputs remain available; review the combined notes below before relying on them for implementation.`,
        }
        : {
            headline: `Export checkpoint — ${attention}`,
            supportingText: 'Export remains available and will preserve the current version and alignment context.',
        };
}

/**
 * Builds one non-persisted checkpoint projection. Artifact signals are
 * deliberately accumulated on the same row so a blocker cannot hide an
 * advisory warning or an alignment concern (and vice versa).
 */
export function deriveWorkflowCheckpointSummary(
    input: WorkflowCheckpointSummaryInput,
): WorkflowCheckpointSummary {
    const visibleArtifacts = input.artifacts.filter(artifact => artifact.visible);
    const artifactRows: WorkflowCheckpointRow[] = visibleArtifacts.flatMap(artifact => {
        const signals = artifactSignals(artifact);
        if (signals.length === 0) return [];
        return [{
            id: `artifact:${artifact.artifactId}`,
            label: artifact.label,
            severity: strongestSeverity(signals),
            destination: artifact.destination,
            signals,
        }];
    });

    const critiqueRows: WorkflowCheckpointRow[] = input.critiqueIssues.map(issue => {
        const severity = critiqueSeverity(issue);
        return {
            id: `critique:${issue.issueId}`,
            label: issue.label,
            severity,
            destination: issue.destination,
            signals: [{
                id: `${issue.issueId}:critique`,
                kind: 'critique',
                severity,
                label: issue.implementationImpact === 'blocker'
                    ? 'Blocking critique finding'
                    : issue.implementationImpact === 'resolve_before_build'
                        ? 'Review before build'
                        : 'Critique note',
                detail: issue.detail,
            }],
        };
    });

    const rows = [...artifactRows, ...critiqueRows].sort((a, b) =>
        severityWeight[b.severity] - severityWeight[a.severity],
    );
    const signals = rows.flatMap(row => row.signals);
    const attentionArtifactIds = new Set(
        artifactRows
            .filter(row => row.signals.some(signal => signal.severity === 'attention'))
            .map(row => row.id),
    );
    const counts = {
        totalArtifacts: visibleArtifacts.length,
        readyArtifacts: visibleArtifacts.length - attentionArtifactIds.size,
        rowCount: rows.length,
        attentionSignals: signals.filter(signal => signal.severity === 'attention').length,
        advisorySignals: signals.filter(signal => signal.severity === 'advisory').length,
    };
    return {
        context: input.context,
        planningVerdict: input.planningVerdict,
        rows,
        counts,
        ...checkpointCopy(input.context, counts),
    };
}

export function renderWorkflowCheckpointSummaryMarkdown(
    summary: WorkflowCheckpointSummary,
): string {
    const lines = [
        '## Workflow Checkpoint',
        '',
        `**Plan status:** ${summary.planningVerdict.label}`,
        '',
        summary.supportingText,
    ];
    if (summary.planningVerdict.rationale) {
        lines.push('', `**Rationale:** ${summary.planningVerdict.rationale}`);
    }
    if (summary.planningVerdict.containment) {
        lines.push('', `**Containment:** ${summary.planningVerdict.containment}`);
    }
    const acceptedRisks = nonEmptyStrings(summary.planningVerdict.acceptedRisks);
    if (acceptedRisks.length > 0) {
        lines.push('', '### Accepted planning risks');
        for (const risk of acceptedRisks) lines.push('', `- ${risk}`);
    }
    for (const row of summary.rows) {
        lines.push('', `- **${row.label}:** ${row.signals.map(signal => (
            signal.detail ? `${signal.label} — ${signal.detail}` : signal.label
        )).join('; ')}`);
    }
    return lines.join('\n');
}
