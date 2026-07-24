import { Clock, FileText, Package, MessageSquare, CheckCircle, XCircle, Pencil, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { useProjectStore } from '../store/projectStore';
import type { HistoryEventType } from '../types';
import {
    compareReadinessReviewCurrentness,
    compareReadinessReviewProjections,
    deriveReadinessReview,
} from '../lib/planning';
import { ReadinessCheckpoint } from './planning/ReadinessCheckpoint';
import { buildReadinessCheckpointView } from './planning/readinessCheckpointView';
import { hashReviewValue } from '../lib/review/hash';
import { buildReviewContextManifest } from '../lib/review/manifest';

interface HistoryViewProps {
    projectId: string;
    /** Panels provide their own labelled header. */
    showHeader?: boolean;
}

const EVENT_CONFIG: Record<HistoryEventType, { icon: typeof Clock; color: string; bgColor: string }> = {
    Init: { icon: FileText, color: 'text-blue-600', bgColor: 'bg-blue-50' },
    Regenerated: { icon: FileText, color: 'text-indigo-600', bgColor: 'bg-indigo-50' },
    Consolidated: { icon: CheckCircle, color: 'text-green-600', bgColor: 'bg-green-50' },
    ArtifactGenerated: { icon: Package, color: 'text-purple-600', bgColor: 'bg-purple-50' },
    ArtifactRegenerated: { icon: Package, color: 'text-purple-600', bgColor: 'bg-purple-50' },
    FeedbackCreated: { icon: MessageSquare, color: 'text-amber-600', bgColor: 'bg-amber-50' },
    FeedbackApplied: { icon: CheckCircle, color: 'text-emerald-600', bgColor: 'bg-emerald-50' },
    GenerationFailed: { icon: XCircle, color: 'text-red-600', bgColor: 'bg-red-50' },
    Edited: { icon: Pencil, color: 'text-violet-600', bgColor: 'bg-violet-50' },
    Reverted: { icon: RotateCcw, color: 'text-amber-600', bgColor: 'bg-amber-50' },
    MarkedCurrent: { icon: CheckCircle, color: 'text-emerald-600', bgColor: 'bg-emerald-50' },
    ValidationIssueAccepted: { icon: CheckCircle, color: 'text-sky-700', bgColor: 'bg-sky-50' },
    ReadinessReviewed: { icon: Clock, color: 'text-indigo-600', bgColor: 'bg-indigo-50' },
    PlanCommitted: { icon: CheckCircle, color: 'text-emerald-600', bgColor: 'bg-emerald-50' },
    PlanReopened: { icon: RotateCcw, color: 'text-amber-600', bgColor: 'bg-amber-50' },
};

export function HistoryView({ projectId, showHeader = true }: HistoryViewProps) {
    const {
        getHistoryEvents, getSpineVersions, getProjectOutputAlignment, getProject,
        readinessReviews, readinessCommitmentEvents, planningRecords,
        reviewRuns, specialistRuns, reviewIssues, reviewFindings, artifacts, artifactVersions,
    } = useProjectStore();
    const [selectedReadinessReviewId, setSelectedReadinessReviewId] = useState<string | null>(null);
    const events = getHistoryEvents(projectId);
    const sortedEvents = [...events].sort((a, b) => b.createdAt - a.createdAt);

    // Spine ids are opaque (UUIDs for new versions) — show the positional
    // "Version N" label the rest of the workspace uses.
    const spines = getSpineVersions(projectId);
    const selectedReadinessReview = (readinessReviews[projectId] ?? []).find(review => review.id === selectedReadinessReviewId);
    const latestSpine = spines.find(spine => spine.isLatest);
    const project = getProject(projectId);
    const currentArtifactRefs = (artifacts[projectId] ?? [])
        .filter(artifact => artifact.status !== 'archived')
        .flatMap(artifact => {
            const versions = artifactVersions[projectId] ?? [];
            const version = artifact.currentVersionId
                ? versions.find(item => item.id === artifact.currentVersionId)
                : versions.find(item => item.artifactId === artifact.id && item.isPreferred);
            return version ? [{
                artifactId: artifact.id,
                artifactVersionId: version.id,
                contentHash: hashReviewValue(version.content),
            }] : [];
        });
    const currentReviewArtifacts = (artifacts[projectId] ?? []).flatMap(artifact => {
        if (artifact.type !== 'core_artifact' || !artifact.subtype || !artifact.currentVersionId) return [];
        const version = (artifactVersions[projectId] ?? []).find(item => item.id === artifact.currentVersionId);
        return version ? [{
            artifactId: artifact.id,
            versionId: version.id,
            subtype: artifact.subtype,
            title: artifact.title,
            content: version.content,
        }] : [];
    });
    const currentChallengeContextSignature = project && latestSpine?.structuredPRD
        ? buildReviewContextManifest({
            projectId,
            projectName: project.name,
            platform: project.platform,
            productCategory: project.productCategory,
            spine: {
                versionId: latestSpine.id,
                schemaVersion: latestSpine.prdVersion,
                content: latestSpine.responseText,
                structuredPRD: latestSpine.structuredPRD,
                canonicalSpine: latestSpine.canonicalSpine,
            },
            artifacts: currentReviewArtifacts,
            safetyBoundaries: latestSpine.safetyReview?.detectedConcerns ?? [],
        }).contextSignature
        : undefined;
    const spineLabel = (spineId: string) => {
        const idx = spines.findIndex(s => s.id === spineId);
        return idx >= 0 ? `Version ${idx + 1}` : spineId;
    };
    const currentReadinessInput = latestSpine ? {
        projectId,
        spine: {
            versionId: latestSpine.id,
            content: latestSpine.responseText,
            structuredPRD: latestSpine.structuredPRD,
            incompleteSectionCount: latestSpine.generationMeta?.failedSections?.length ?? 0,
            isCommitted: latestSpine.isFinal,
            safetyReview: latestSpine.safetyReview && {
                status: latestSpine.safetyReview.status,
                classification: latestSpine.safetyReview.classification,
                detectedConcerns: latestSpine.safetyReview.detectedConcerns,
                reviewedAt: latestSpine.safetyReview.reviewedAt,
            },
        },
        planningRecords: planningRecords[projectId] ?? [],
        reviewRuns: reviewRuns[projectId] ?? [],
        specialistRuns: specialistRuns[projectId] ?? [],
        reviewIssues: reviewIssues[projectId] ?? [],
        reviewFindings: reviewFindings[projectId] ?? [],
        outputAlignment: getProjectOutputAlignment(projectId),
        currentArtifactRefs,
        currentChallengeContextSignature,
    } : undefined;
    const selectedReadinessCurrentness = selectedReadinessReview && currentReadinessInput
        ? compareReadinessReviewCurrentness(selectedReadinessReview, currentReadinessInput)
        : undefined;
    const readinessComparisonSummary = selectedReadinessReview
        && selectedReadinessCurrentness
        && !selectedReadinessCurrentness.current
        && selectedReadinessCurrentness.integrityValid
        && currentReadinessInput
        && latestSpine
        ? compareReadinessReviewProjections(
            selectedReadinessReview,
            deriveReadinessReview({ ...currentReadinessInput, createdAt: selectedReadinessReview.createdAt }),
            {
                reviewedVersionLabel: spineLabel(selectedReadinessReview.spineVersionId),
                currentVersionLabel: spineLabel(latestSpine.id),
            },
        )
        : undefined;
    const selectedReadinessView = selectedReadinessReview ? buildReadinessCheckpointView(
        selectedReadinessReview,
        selectedReadinessCurrentness
            ?? { current: false, historical: true, integrityValid: true, reasons: ['spine_identity_changed'] },
        readinessCommitmentEvents[projectId] ?? [],
        spineLabel(selectedReadinessReview.spineVersionId),
        readinessComparisonSummary,
    ) : undefined;

    // Group events by date
    const groupedByDate: Record<string, typeof sortedEvents> = {};
    for (const event of sortedEvents) {
        const dateKey = new Date(event.createdAt).toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
        });
        if (!groupedByDate[dateKey]) groupedByDate[dateKey] = [];
        groupedByDate[dateKey].push(event);
    }

    return (
        <div className="max-w-3xl mx-auto space-y-6">
            {showHeader && (
                <div className="flex items-center gap-3">
                    <Clock size={24} className="text-indigo-600" />
                    <h2 className="text-xl font-bold text-neutral-900">Project History</h2>
                    <span className="bg-neutral-100 text-neutral-600 text-xs px-2 py-0.5 rounded-full font-medium">
                        {events.length} events
                    </span>
                </div>
            )}

            {events.length === 0 ? (
                <div className="text-center py-16 text-neutral-400">
                    <Clock size={48} className="mx-auto mb-4 opacity-30" />
                    <p className="text-lg font-medium text-neutral-500 mb-2">No history yet</p>
                    <p className="text-sm">Changes to the plan, its reasoning, and downstream outputs will appear here.</p>
                </div>
            ) : (
                <div className="space-y-8">
                    {Object.entries(groupedByDate).map(([dateKey, dateEvents]) => (
                        <div key={dateKey}>
                            <h3 className="text-xs font-bold text-neutral-400 uppercase tracking-wider mb-3 sticky top-0 bg-neutral-50 py-1">
                                {dateKey}
                            </h3>
                            <div className="space-y-2">
                                {dateEvents.map(event => {
                                    const config = EVENT_CONFIG[event.type] || EVENT_CONFIG.Init;
                                    const Icon = config.icon;

                                    return (
                                        <div
                                            key={event.id}
                                            className="flex items-start gap-3 p-3 bg-white rounded-lg border border-neutral-200 hover:border-neutral-300 transition"
                                        >
                                            <div className={`p-1.5 rounded-md shrink-0 ${config.bgColor}`}>
                                                <Icon size={14} className={config.color} />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-neutral-800">{event.description}</p>
                                                <div className="text-xs text-neutral-400 mt-1 flex items-center gap-2">
                                                    <span>{new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                                    {event.spineVersionId && <span>PRD {spineLabel(event.spineVersionId)}</span>}
                                                </div>

                                                {event.diff?.matches && (
                                                    <div className="mt-2 bg-neutral-50 border border-neutral-100 rounded p-2 font-mono text-xs">
                                                        <p className="text-red-500 line-through truncate">- {event.diff.matches[0].before}</p>
                                                        <p className="text-green-600 truncate">+ {event.diff.matches[0].after}</p>
                                                    </div>
                                                )}
                                                {event.readinessReviewId && (
                                                    <button
                                                        type="button"
                                                        onClick={() => setSelectedReadinessReviewId(event.readinessReviewId!)}
                                                        className="mt-3 inline-flex min-h-11 w-full items-center justify-center rounded-lg border border-neutral-200 px-3 text-xs font-semibold text-neutral-700 hover:bg-neutral-50 sm:w-auto"
                                                    >
                                                        Inspect readiness review
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            )}
            {selectedReadinessView && (
                <ReadinessCheckpoint
                    review={selectedReadinessView}
                    readOnly
                    onClose={() => setSelectedReadinessReviewId(null)}
                />
            )}
        </div>
    );
}
