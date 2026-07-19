import { useMemo, useState } from 'react';
import { AlertTriangle, Check, FileEdit, Loader2, RefreshCw, SearchCheck, ShieldCheck, Sparkles } from 'lucide-react';
import {
    latestDownstreamArtifactUpdateReview,
    latestDownstreamArtifactUpdateVerificationReview,
    effectiveDownstreamArtifactUpdate,
    downstreamUpdatePlanItemIntegrityHash,
    validateDownstreamArtifactUpdateApplicationIntegrity,
    validateDownstreamArtifactUpdateProposalIntegrity,
    validateDownstreamArtifactUpdateReviewEventIntegrity,
    validateDownstreamArtifactUpdateVerificationIntegrity,
    type DownstreamArtifactUpdateProposal,
    type DownstreamArtifactUpdateReviewAction,
} from '../../lib/planning/downstreamArtifactUpdateProposal';
import { validateDownstreamUpdatePlanIntegrity, type DownstreamUpdatePlan, type DownstreamUpdatePlanItem } from '../../lib/planning/downstreamUpdatePlan';
import { useProjectStore } from '../../store/projectStore';
import type { ArtifactVersion } from '../../types';
import { hashReviewValue } from '../../lib/review/hash';

const EMPTY_PROPOSALS: DownstreamArtifactUpdateProposal[] = [];
const EMPTY_EVENTS: ReturnType<typeof useProjectStore.getState>['downstreamArtifactUpdateReviewEvents'][string] = [];
const EMPTY_APPLICATIONS: ReturnType<typeof useProjectStore.getState>['downstreamArtifactUpdateApplications'][string] = [];
const EMPTY_ARTIFACT_VERSIONS: ArtifactVersion[] = [];
const EMPTY_ARTIFACTS: ReturnType<typeof useProjectStore.getState>['artifacts'][string] = [];
const EMPTY_VERIFICATIONS: ReturnType<typeof useProjectStore.getState>['downstreamArtifactUpdateVerifications'][string] = [];
const EMPTY_VERIFICATION_EVENTS: ReturnType<typeof useProjectStore.getState>['downstreamArtifactUpdateVerificationEvents'][string] = [];

type PendingAction = Exclude<DownstreamArtifactUpdateReviewAction, 'accepted' | 'edited'> | 'edit';
type ContextIntent = 'replace' | 'rename' | 'requiredness' | 'remove' | 'out_of_scope';

interface DownstreamArtifactUpdateProposalReviewProps {
    projectId: string;
    plan: DownstreamUpdatePlan;
    item: DownstreamUpdatePlanItem;
    readOnly: boolean;
}

const actionLabel: Record<PendingAction, string> = {
    rejected: 'Reject proposal',
    preserved: 'Preserve current content',
    deferred: 'Defer proposal',
    requested_another: 'Request another proposal',
    provided_context: 'Provide context',
    edit: 'Edit proposed change',
};

function proposedSummary(proposal: DownstreamArtifactUpdateProposal): string {
    if (proposal.operation === 'review_only') return 'No focused content change is available. Review manually or provide more context.';
    if (proposal.operation === 'remove') return 'Remove only this exact region.';
    if (proposal.region.kind === 'implementation_plan' && proposal.region.section === 'delivery' && proposal.proposedContent) {
        try {
            const change = JSON.parse(proposal.proposedContent) as { operation?: string; collection?: string; value?: unknown };
            const value = typeof change.value === 'string' ? change.value : JSON.stringify(change.value, null, 2);
            return `${change.operation === 'add' ? 'Add' : 'Replace with'}${change.collection ? ` in ${change.collection.replace(/_/g, ' ')}` : ''}: ${value}`;
        } catch {
            return 'Review the exact structured plan change supplied by the user.';
        }
    }
    return proposal.proposedContent ?? 'No proposed content.';
}

function snapshotRecord(snapshot: string): Record<string, unknown> | undefined {
    try {
        const value = JSON.parse(snapshot) as unknown;
        return value && typeof value === 'object' && !Array.isArray(value)
            ? value as Record<string, unknown>
            : undefined;
    } catch {
        return undefined;
    }
}

function implementationValueWithLabel(
    proposal: DownstreamArtifactUpdateProposal,
    replacement: string,
): unknown {
    const current = snapshotRecord(proposal.currentRegionSnapshot);
    if (!current || proposal.region.kind !== 'implementation_plan' || proposal.region.section !== 'delivery') {
        return replacement;
    }
    const key = proposal.region.collection === 'milestones' ? 'name'
        : proposal.region.collection === 'tasks' || proposal.region.collection === 'quality_gates' ? 'title'
            : proposal.region.collection === 'risks' ? 'description'
                : undefined;
    return key ? { ...current, [key]: replacement } : replacement;
}

export function DownstreamArtifactUpdateProposalReview({
    projectId, plan, item, readOnly,
}: DownstreamArtifactUpdateProposalReviewProps) {
    const proposals = useProjectStore(state => state.downstreamArtifactUpdateProposals[projectId] ?? EMPTY_PROPOSALS);
    const events = useProjectStore(state => state.downstreamArtifactUpdateReviewEvents[projectId] ?? EMPTY_EVENTS);
    const applications = useProjectStore(state => state.downstreamArtifactUpdateApplications[projectId] ?? EMPTY_APPLICATIONS);
    const artifactVersions = useProjectStore(state => state.artifactVersions[projectId] ?? EMPTY_ARTIFACT_VERSIONS);
    const artifacts = useProjectStore(state => state.artifacts[projectId] ?? EMPTY_ARTIFACTS);
    const spineVersions = useProjectStore(state => state.spineVersions[projectId] ?? []);
    const planningRecords = useProjectStore(state => state.planningRecords[projectId] ?? []);
    const verifications = useProjectStore(state => state.downstreamArtifactUpdateVerifications[projectId] ?? EMPTY_VERIFICATIONS);
    const verificationEvents = useProjectStore(state => state.downstreamArtifactUpdateVerificationEvents[projectId] ?? EMPTY_VERIFICATION_EVENTS);
    const generate = useProjectStore(state => state.generateDownstreamArtifactUpdateProposal);
    const appendReview = useProjectStore(state => state.appendDownstreamArtifactUpdateReviewEvent);
    const applyProposal = useProjectStore(state => state.applyDownstreamArtifactUpdateProposal);
    const verifyUpdate = useProjectStore(state => state.verifyDownstreamArtifactUpdateItem);
    const appendVerificationReview = useProjectStore(state => state.appendDownstreamArtifactUpdateVerificationEvent);
    const [pending, setPending] = useState<PendingAction>();
    const [rationale, setRationale] = useState('');
    const [editedContent, setEditedContent] = useState('');
    const [contextIntent, setContextIntent] = useState<ContextIntent>('replace');
    const [contextValue, setContextValue] = useState('');
    const [contextName, setContextName] = useState('');
    const [contextType, setContextType] = useState('string');
    const [contextRequired, setContextRequired] = useState<'required' | 'optional'>('optional');
    const [busy, setBusy] = useState(false);
    const [verificationReviewAction, setVerificationReviewAction] = useState<'rejected' | 'deferred'>();
    const [verificationRationale, setVerificationRationale] = useState('');
    const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string }>();

    const matchingProposals = useMemo(() => proposals
        .filter(candidate => candidate.updatePlanBinding.planId === plan.id
            && candidate.updatePlanBinding.itemId === item.id), [item.id, plan.id, proposals]);
    // The review list passes a projected item with disposition/priority fields.
    // Proposal authority is sealed against the canonical plan item only.
    const canonicalItem = plan.items.find(candidate => candidate.id === item.id);
    const validProposals = useMemo(() => matchingProposals.filter(candidate => (
        validateDownstreamUpdatePlanIntegrity(plan)
        && Boolean(canonicalItem)
        && validateDownstreamArtifactUpdateProposalIntegrity(candidate)
        && candidate.updatePlanBinding.planIntegrityHash === plan.integrityHash
        && candidate.updatePlanBinding.itemIntegrityHash === downstreamUpdatePlanItemIntegrityHash(plan, canonicalItem!)
    )).sort((a, b) => b.createdAt - a.createdAt
        || matchingProposals.indexOf(b) - matchingProposals.indexOf(a)), [canonicalItem, matchingProposals, plan]);
    const proposal = validProposals.find(candidate => (
        useProjectStore.getState().getDownstreamArtifactUpdateProposalCurrentness(projectId, candidate.id)?.current
    )) ?? validProposals[0];
    const corruptedProposalLifecycle = matchingProposals.length !== validProposals.length;
    const boundArtifactVersion = proposal
        ? artifactVersions.find(candidate => candidate.id === proposal.artifact.artifactVersionId)
        : undefined;
    // The named artifact-version subscription above makes proposal freshness
    // reactive to manual/concurrent content changes without hidden rerenders.
    const currentness = proposal && boundArtifactVersion
        ? useProjectStore.getState().getDownstreamArtifactUpdateProposalCurrentness(projectId, proposal.id)
        : undefined;
    const sourceAuthorityCurrent = Boolean(currentness?.current || currentness?.reasons.every(reason => (
        reason === 'artifact_version_changed' || reason === 'artifact_content_changed'
    )));
    const review = proposal ? latestDownstreamArtifactUpdateReview(proposal, events) : undefined;
    const currentArtifact = artifacts.find(candidate => candidate.id === plan.artifact.artifactId);
    const currentArtifactVersionId = currentArtifact?.currentVersionId;
    const currentArtifactVersion = artifactVersions.find(candidate => candidate.id === currentArtifactVersionId);
    const applicationCandidates = proposal
        ? applications.filter(candidate => candidate.proposalId === proposal.id)
        : [];
    const validApplications = applicationCandidates.filter(candidate => {
        const authorization = events.find(event => event.id === candidate.authorizedByReviewEventId);
        const resultVersion = artifactVersions.find(version => version.id === candidate.resultingArtifactVersionId);
        const effective = proposal && authorization
            ? effectiveDownstreamArtifactUpdate(proposal, authorization)
            : undefined;
        return validateDownstreamArtifactUpdateApplicationIntegrity(candidate)
            && candidate.projectId === projectId
            && candidate.proposalIntegrityHash === proposal?.integrityHash
            && candidate.expectedArtifactVersionId === proposal?.artifact.artifactVersionId
            && candidate.expectedArtifactContentHash === proposal?.artifact.artifactContentHash
            && candidate.expectedRegionContentHash === proposal?.currentRegionContentHash
            && Boolean(resultVersion
                && resultVersion.artifactId === proposal?.artifact.artifactId
                && resultVersion.parentVersionId === candidate.expectedArtifactVersionId
                && hashReviewValue(resultVersion.content) === candidate.resultingArtifactContentHash)
            && Boolean(effective
                && effective.operation === candidate.effectiveOperation
                && effective.contentHash === candidate.effectiveContentHash)
            && Boolean(authorization
                && validateDownstreamArtifactUpdateReviewEventIntegrity(authorization)
                && authorization.projectId === projectId
                && authorization.proposalId === proposal?.id
                && authorization.expectedProposalIntegrityHash === proposal?.integrityHash
                && authorization.expectedPlanIntegrityHash === proposal?.updatePlanBinding.planIntegrityHash
                && authorization.expectedItemIntegrityHash === proposal?.updatePlanBinding.itemIntegrityHash
                && authorization.expectedRegionContentHash === proposal?.currentRegionContentHash
                && candidate.authorizedByReviewEventIntegrityHash === authorization.integrityHash);
    });
    const application = sourceAuthorityCurrent
        ? validApplications.find(candidate => candidate.resultingArtifactVersionId === currentArtifactVersionId)
        : undefined;
    const verificationCandidates = verifications.filter(candidate => candidate.subject?.planId === plan.id
        && candidate.subject.itemId === item.id);
    const validVerifications = verificationCandidates.filter(candidate => (
        validateDownstreamArtifactUpdateVerificationIntegrity(candidate)
        && candidate.projectId === projectId
        && candidate.subject?.planIntegrityHash === plan.integrityHash
        && candidate.subject?.itemIntegrityHash === (canonicalItem
            ? downstreamUpdatePlanItemIntegrityHash(plan, canonicalItem)
            : undefined)
        && candidate.subject?.baselineArtifactVersionId === plan.artifact.artifactVersionId
        && candidate.subject?.baselineArtifactContentHash === plan.artifact.artifactContentHash
        && candidate.subject?.targetArtifactContentHash === (currentArtifactVersion
            ? hashReviewValue(currentArtifactVersion.content)
            : undefined)
        && (!candidate.subject?.proposalId || Boolean(proposal
            && candidate.subject.proposalId === proposal.id
            && candidate.subject.proposalIntegrityHash === proposal.integrityHash))
        && (candidate.subject?.kind !== 'application' || validApplications.some(bound => (
            candidate.subject?.applicationId === bound.id
            && candidate.subject.applicationIntegrityHash === bound.integrityHash
        )))
    ));
    const verification = validVerifications
        .filter(candidate => sourceAuthorityCurrent
            && candidate.subject?.targetArtifactVersionId === currentArtifactVersionId)
        .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))[0];
    const corruptedLifecycle = corruptedProposalLifecycle
        || validApplications.length !== applicationCandidates.length
        || validVerifications.length !== verificationCandidates.length;
    const verificationReview = verification
        ? latestDownstreamArtifactUpdateVerificationReview(verification, verificationEvents)
        : undefined;
    // These subscriptions are part of proposal currentness even when visible
    // artifact text is unchanged: authority or spine changes must close review.
    void spineVersions;
    void planningRecords;
    const proposalReadOnly = readOnly || !currentness?.current || Boolean(application);
    const dataModelContextIsManualOnly = proposal?.region.kind === 'data_model'
        && proposal.region.aspect === 'entity'
        && proposal.dataModelImpact?.format === 'json';

    const buildProvidedContext = (): string => {
        if (!proposal) return '';
        if (proposal.region.kind === 'data_model') {
            if (dataModelContextIsManualOnly) return JSON.stringify({ note: contextValue.trim() });
            const memberKind = proposal.region.aspect;
            if (contextIntent === 'remove' || contextIntent === 'out_of_scope') return JSON.stringify({
                changeKind: contextIntent, memberKind, content: null,
            });
            if (memberKind === 'field') {
                const current = snapshotRecord(proposal.currentRegionSnapshot) ?? {};
                return JSON.stringify({
                    changeKind: contextIntent,
                    memberKind,
                    content: {
                        ...current,
                        name: contextName.trim() || proposal.region.memberName || current.name,
                        type: contextType.trim() || current.type || 'string',
                        required: contextRequired === 'required',
                        description: contextValue.trim() || current.description || '',
                    },
                });
            }
            return JSON.stringify({ changeKind: contextIntent, memberKind, content: contextValue.trim() });
        }
        if (proposal.region.kind === 'implementation_plan') {
            if (proposal.region.section === 'architecture') return `replace: ${contextValue.trim()}`;
            return `replace: ${JSON.stringify({
                collection: proposal.region.collection,
                value: implementationValueWithLabel(proposal, contextValue.trim()),
            })}`;
        }
        return contextValue.trim();
    };

    const contextReady = (() => {
        if (pending !== 'provided_context') return true;
        if (!proposal) return false;
        if (dataModelContextIsManualOnly) return contextValue.trim().length >= 3;
        if (proposal.region.kind === 'data_model' && (contextIntent === 'remove' || contextIntent === 'out_of_scope')) return true;
        if (proposal.region.kind === 'data_model' && proposal.region.aspect === 'field') {
            return contextName.trim().length > 0 && contextType.trim().length > 0 && contextValue.trim().length > 0;
        }
        return contextValue.trim().length >= 3;
    })();

    const prepare = () => {
        setBusy(true);
        const result = generate(projectId, plan.id, item.id);
        setBusy(false);
        if (result.status === 'rejected') {
            setMessage({ kind: 'error', text: result.reason === 'stale'
                ? 'The plan changed. Generate a current update plan before preparing another proposal.'
                : 'Synapse could not bind a proposal to this exact region.' });
            return;
        }
        setMessage({ kind: 'success', text: result.operation === 'review_only'
            ? 'Review guidance prepared. No content will be applied from this recommendation.'
            : 'A proposed change is ready for your review.' });
    };

    const record = (action: DownstreamArtifactUpdateReviewAction, payload: string) => {
        if (!proposal) return;
        const result = action === 'provided_context'
            ? appendReview(projectId, proposal.id, { action, context: payload })
            : action === 'edited'
                ? appendReview(projectId, proposal.id, {
                    action, operation: proposal.operation === 'add' ? 'add' : 'replace', editedContent, rationale: payload,
                })
                : action === 'accepted'
                    ? appendReview(projectId, proposal.id, { action })
                    : appendReview(projectId, proposal.id, { action, rationale: payload });
        if (!result.ok) {
            setMessage({ kind: 'error', text: result.reason === 'stale'
                ? 'This proposal became historical while it was open.'
                : 'This review choice could not be recorded.' });
            return;
        }
        setPending(undefined);
        setRationale('');
        setMessage({ kind: 'success', text: action === 'accepted' || action === 'edited'
            ? 'Your approval is recorded. The artifact has not changed yet.'
            : action === 'deferred'
                ? 'This proposal is deferred. The update-plan item remains unresolved and no artifact content changed.'
            : 'Your review choice is preserved in proposal history.' });
        if (action === 'requested_another' || action === 'provided_context') prepare();
    };

    const apply = () => {
        if (!proposal) return;
        setBusy(true);
        const result = applyProposal(projectId, proposal.id);
        setBusy(false);
        setMessage(result.status === 'applied'
            ? { kind: 'success', text: 'Applied as a new output version. Alignment still requires verification.' }
            : { kind: 'error', text: result.reason === 'stale'
                ? 'Nothing changed. The proposal is stale and must be prepared again against the current artifact.'
                : 'Nothing changed. The approved proposal could not be applied safely.' });
    };

    const verify = () => {
        setBusy(true);
        const result = verifyUpdate(projectId, plan.id, item.id);
        setBusy(false);
        setMessage(result.status === 'verified'
            ? { kind: 'success', text: result.result === 'aligned'
                ? 'Synapse verified the exact affected region in the current output version.'
                : 'Verification is recorded. The result remains advisory and the affected region still needs attention.' }
            : { kind: 'error', text: result.reason === 'source_stale'
                ? 'The planning source changed. Create a current update plan before verifying this output.'
                : 'The current artifact could not be safely bound to this update-plan item.' });
    };

    const recordVerificationReview = (action: 'confirmed' | 'rejected' | 'deferred') => {
        if (!verification) return;
        const result = appendVerificationReview(projectId, verification.id, {
            action,
            ...(action === 'confirmed' ? {} : { rationale: verificationRationale.trim() }),
        });
        if (!result.ok) {
            setMessage({ kind: 'error', text: result.reason === 'stale'
                ? 'This verification is historical because the artifact changed.'
                : 'The advisory review choice could not be recorded.' });
            return;
        }
        setVerificationReviewAction(undefined);
        setVerificationRationale('');
        setMessage({ kind: 'success', text: 'Your review of the advisory result is preserved. It does not change the evidence or artifact.' });
    };

    if (!proposal) return (
        <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-950">
                        <Sparkles size={14} aria-hidden="true" /> Prepare a proposed change
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-indigo-800">Synapse will propose content only when the exact region and change are strongly grounded. Otherwise it will explain why manual review is safer.</p>
                </div>
                <button type="button" disabled={readOnly || busy} onClick={prepare} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Prepare proposal
                </button>
            </div>
            {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={`mt-2 text-xs ${message.kind === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>{message.text}</p>}
            {corruptedLifecycle && <p role="alert" className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-950">A saved proposal failed integrity checks and was ignored. Prepare a current proposal before recording authority.</p>}
            {currentArtifactVersionId && currentArtifactVersionId !== plan.artifact.artifactVersionId && (
                <button type="button" disabled={busy} onClick={verify} className="mt-3 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 text-xs font-semibold text-indigo-800 disabled:opacity-50">
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <SearchCheck size={14} />} Verify current output
                </button>
            )}
        </div>
    );

    const writable = proposal.operation !== 'review_only';
    const canApply = !proposalReadOnly && !application && (review?.action === 'accepted' || review?.action === 'edited');
    const approvedOperation = review?.action === 'edited' ? review.operation
        : review?.action === 'accepted' && proposal.operation !== 'review_only' ? proposal.operation
            : undefined;
    const approvedContent = review?.action === 'edited' ? review.editedContent : proposal.proposedContent;
    const startPending = (action: PendingAction) => {
        setPending(action);
        setRationale('');
        if (action === 'edit') setEditedContent(proposal.proposedContent ?? proposal.currentRegionSnapshot);
        if (action === 'provided_context') {
            const current = snapshotRecord(proposal.currentRegionSnapshot);
            setContextIntent('replace');
            setContextValue('');
            setContextName(typeof current?.name === 'string' ? current.name
                : proposal.region.kind === 'data_model' ? proposal.region.memberName ?? '' : '');
            setContextType(typeof current?.type === 'string' ? current.type : 'string');
            setContextRequired(current?.required === true ? 'required' : 'optional');
        }
        setMessage(undefined);
    };

    return (
        <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-indigo-950">
                    <FileEdit size={14} aria-hidden="true" /> Proposed output change
                    <span className="rounded-full border border-indigo-200 bg-white px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                        {application ? 'Completed · applied' : proposal.operation === 'review_only' ? 'Review only' : 'Proposed change'}
                    </span>
                </div>
                <span className="text-[11px] text-indigo-700">Current output version</span>
            </div>

            {!application && !currentness?.current && <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">Historical proposal — its planning source or artifact binding changed. It cannot be approved or applied.</p>}
            {application && <p className="mt-2 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-900">Completed for this proposal. The approved change was applied to a new artifact version; verification is the next separate step.</p>}
            {corruptedLifecycle && <p role="alert" className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-950">One or more saved lifecycle records failed integrity checks and are not shown as applied or aligned.</p>}
            <div className="mt-3 grid min-w-0 gap-2 md:grid-cols-2">
                <div className="min-w-0 rounded-md border border-neutral-200 bg-white p-2.5">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Current region</div>
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-neutral-700">{proposal.currentRegionSnapshot}</pre>
                </div>
                <div className="min-w-0 rounded-md border border-indigo-200 bg-white p-2.5">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-600">Synapse proposes</div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-neutral-800">{proposedSummary(proposal)}</p>
                </div>
            </div>
            <p className="mt-2 break-words text-xs leading-relaxed text-neutral-700"><strong>Why:</strong> {proposal.reasoning}</p>
            {proposal.ambiguity && <p className="mt-1 break-words text-xs leading-relaxed text-neutral-600"><strong>Still uncertain:</strong> {proposal.ambiguity}</p>}
            {proposal.dataModelImpact?.destructive && (
                <div className="mt-2 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-2 text-xs leading-relaxed text-amber-950">
                    <div className="flex items-center gap-1.5 font-semibold"><AlertTriangle size={14} aria-hidden="true" /> Destructive data-model change</div>
                    <p className="mt-1">This can affect persisted data. No migration or dependent region is changed automatically.</p>
                    {proposal.dataModelImpact.relationshipEndpoints.length > 0 && (
                        <p className="mt-1"><strong>Relationship endpoints:</strong> {proposal.dataModelImpact.relationshipEndpoints.join(' ↔ ')}</p>
                    )}
                    {proposal.dataModelImpact.migrationImplications.map(implication => <p key={implication} className="mt-1">• {implication}</p>)}
                </div>
            )}
            {proposal.dataModelImpact && proposal.dataModelImpact.dependencies.length > 0 && (
                <details className="mt-2 rounded-md border border-amber-200 bg-white px-2.5 py-1.5">
                    <summary className="flex min-h-11 cursor-pointer items-center text-xs font-semibold text-amber-900">
                        Dependencies requiring review ({proposal.dataModelImpact.dependencies.length})
                    </summary>
                    <div className="border-t border-amber-100 pb-2 pt-2 text-xs leading-relaxed text-neutral-700">
                        {proposal.dataModelImpact.dependencies.map(dependency => (
                            <p key={dependency.id} className="break-words">• <strong>{dependency.label}</strong> — {dependency.explanation}</p>
                        ))}
                        {proposal.dataModelImpact.blockReasons.map(reason => <p key={reason} className="mt-2 font-medium text-amber-900">{reason}</p>)}
                    </div>
                </details>
            )}
            <details className="mt-2 rounded-md border border-neutral-200 bg-white px-2.5 py-1.5">
                <summary className="flex min-h-11 cursor-pointer items-center text-xs font-semibold text-neutral-700">Evidence and preserved scope</summary>
                <div className="border-t border-neutral-100 pb-2 pt-2 text-xs leading-relaxed text-neutral-600">
                    {proposal.evidence.map(evidence => <p key={evidence.id} className="break-words">• {evidence.summary}</p>)}
                    <div className="mt-2 font-semibold text-emerald-800">Unaffected work remains unchanged</div>
                    {proposal.preservedScope.map(scope => <p key={scope} className="break-words text-emerald-700">• {scope}</p>)}
                </div>
            </details>

            {review && <p className="mt-2 text-xs text-neutral-600"><strong>Latest user choice:</strong> {review.action.replaceAll('_', ' ')}</p>}
            {application && <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700"><Check size={14} /> Applied in a new output version. Verification remains separate.</p>}
            {verification && (
                <div className={`mt-2 rounded-md border px-2.5 py-2 text-xs leading-relaxed ${verification.result === 'aligned'
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                    : verification.result === 'update_still_required'
                        ? 'border-red-200 bg-red-50 text-red-900'
                        : 'border-amber-200 bg-amber-50 text-amber-950'}`}>
                    <div className="flex items-center gap-1.5 font-semibold">
                        <SearchCheck size={14} aria-hidden="true" /> Synapse verification: {verification.result.replaceAll('_', ' ')}
                    </div>
                    <p className="mt-1 break-words">{verification.reasoning}</p>
                    {verification.remainingAmbiguity && <p className="mt-1 break-words"><strong>Still needs attention:</strong> {verification.remainingAmbiguity}</p>}
                    <p className="mt-1 text-[11px] opacity-80">Checked against the current output version. This check does not create user authority or change output content.</p>
                    {verificationReview && <p className="mt-1 text-[11px]"><strong>Your latest review:</strong> {verificationReview.action.replaceAll('_', ' ')}</p>}
                    {verification.result !== 'aligned' && (
                        <div className="mt-2 border-t border-current/10 pt-2">
                            <div className="flex flex-wrap gap-2">
                                <button type="button" onClick={() => recordVerificationReview('confirmed')} className="min-h-11 rounded-lg border border-current/20 bg-white px-3 text-xs font-medium">Record as reviewed</button>
                                <button type="button" onClick={() => setVerificationReviewAction('deferred')} className="min-h-11 rounded-lg border border-current/20 bg-white px-3 text-xs font-medium">Defer review</button>
                                <button type="button" onClick={() => setVerificationReviewAction('rejected')} className="min-h-11 rounded-lg border border-current/20 bg-white px-3 text-xs font-medium">Reject result</button>
                            </div>
                            {verificationReviewAction && (
                                <div className="mt-2">
                                    <label className="block font-medium">
                                        Rationale
                                        <textarea value={verificationRationale} onChange={event => setVerificationRationale(event.target.value)} rows={2} className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm text-neutral-900" />
                                    </label>
                                    <div className="mt-2 flex justify-end gap-2">
                                        <button type="button" onClick={() => setVerificationReviewAction(undefined)} className="min-h-11 rounded-lg px-3 text-xs font-medium">Cancel</button>
                                        <button type="button" disabled={verificationRationale.trim().length < 3} onClick={() => recordVerificationReview(verificationReviewAction)} className="min-h-11 rounded-lg bg-neutral-900 px-3 text-xs font-semibold text-white disabled:opacity-50">Record choice</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
            {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={`mt-2 rounded-md px-2.5 py-2 text-xs ${message.kind === 'error' ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>{message.text}</p>}

            {currentArtifactVersionId && currentArtifactVersionId !== plan.artifact.artifactVersionId && (!verification || verification.result !== 'aligned') && (
                <button type="button" disabled={busy} onClick={verify} className="mt-3 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-indigo-200 bg-white px-3 text-xs font-semibold text-indigo-800 disabled:opacity-50">
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <SearchCheck size={14} />} {verification ? 'Verify again' : 'Verify current output'}
                </button>
            )}

            {!proposalReadOnly && (
                <div className="mt-3 border-t border-indigo-100 pt-3">
                    <div className="flex flex-wrap gap-2" aria-label="Review selective change proposal">
                        {writable && <button type="button" onClick={() => record('accepted', '')} className="min-h-11 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700">Accept proposal</button>}
                        {writable && <button type="button" onClick={() => startPending('edit')} className="min-h-11 rounded-lg border border-indigo-200 bg-white px-3 text-xs font-medium text-indigo-800">Edit proposal</button>}
                        <button type="button" onClick={() => startPending('preserved')} className="min-h-11 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700">Preserve current</button>
                        <button type="button" onClick={() => startPending('rejected')} className="min-h-11 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700">Reject</button>
                        <button type="button" onClick={() => startPending('deferred')} className="min-h-11 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700">Defer</button>
                        <button type="button" onClick={() => startPending('provided_context')} className="min-h-11 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700">Add context</button>
                        <button type="button" onClick={() => startPending('requested_another')} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-3 text-xs font-medium text-neutral-700"><RefreshCw size={13} /> Another proposal</button>
                    </div>
                    {pending && (
                        <div className="mt-3 rounded-md border border-indigo-200 bg-white p-3">
                            <div className="text-xs font-semibold text-neutral-900">{actionLabel[pending]}</div>
                            {pending === 'edit' && <label className="mt-2 block text-xs text-neutral-700">
                                Exact replacement for this region
                                <textarea value={editedContent} onChange={event => setEditedContent(event.target.value)} rows={5} className="mt-1 w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 font-mono text-xs" />
                            </label>}
                            {pending === 'provided_context' ? (
                                <div className="mt-2 space-y-2 text-xs text-neutral-700">
                                    {proposal.region.kind === 'data_model' ? (
                                        <>
                                            {dataModelContextIsManualOnly ? (
                                                <>
                                                    <label className="block font-medium">Planning context<textarea value={contextValue} onChange={event => setContextValue(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" /></label>
                                                    <p className="text-neutral-500">A whole JSON entity cannot be safely reconstructed from a short form. Synapse will preserve this context for review, but the exact entity replacement remains a manual artifact edit.</p>
                                                </>
                                            ) : <><label className="block font-medium">
                                                Intended change
                                                <select value={contextIntent} onChange={event => setContextIntent(event.target.value as ContextIntent)} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm">
                                                    <option value="replace">Replace this exact definition</option>
                                                    {proposal.region.aspect === 'field' && <option value="rename">Rename this field</option>}
                                                    {proposal.region.aspect === 'field' && <option value="requiredness">Change whether this field is required</option>}
                                                    <option value="remove">Remove this exact region</option>
                                                    <option value="out_of_scope">Mark this region out of current scope</option>
                                                </select>
                                            </label>
                                            {contextIntent !== 'remove' && contextIntent !== 'out_of_scope' && proposal.region.aspect === 'field' && (
                                                <div className="grid gap-2 sm:grid-cols-2">
                                                    <label className="font-medium">Field name<input value={contextName} onChange={event => setContextName(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm" /></label>
                                                    <label className="font-medium">Field type<input value={contextType} onChange={event => setContextType(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-300 px-3 text-sm" /></label>
                                                    <label className="font-medium">Requirement<select value={contextRequired} onChange={event => setContextRequired(event.target.value as 'required' | 'optional')} className="mt-1 min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 text-sm"><option value="optional">Optional</option><option value="required">Required</option></select></label>
                                                    <label className="font-medium sm:col-span-2">Description<textarea value={contextValue} onChange={event => setContextValue(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" /></label>
                                                </div>
                                            )}
                                            {contextIntent !== 'remove' && contextIntent !== 'out_of_scope' && proposal.region.aspect !== 'field' && (
                                                <label className="block font-medium">Exact replacement text<textarea value={contextValue} onChange={event => setContextValue(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" /></label>
                                            )}
                                            <p className="text-neutral-500">Synapse constructs the focused change from these fields. You do not need to enter a command prefix or JSON.</p>
                                            </>}
                                        </>
                                    ) : proposal.region.kind === 'implementation_plan' ? (
                                        <>
                                            <label className="block font-medium">
                                                Exact replacement {proposal.region.section === 'delivery' ? 'label or text' : 'text'}
                                                <textarea value={contextValue} onChange={event => setContextValue(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
                                            </label>
                                            <p className="text-neutral-500">This creates a replacement proposal for the exact selected entry. Adding a new structured milestone or task remains a manual artifact edit in this release.</p>
                                        </>
                                    ) : (
                                        <>
                                            <label className="block font-medium">Planning context<textarea value={contextValue} onChange={event => setContextValue(event.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm" /></label>
                                            <p className="text-neutral-500">Synapse will immediately reconsider this exact region using your context. Structured screen or flow replacements that cannot be safely constructed remain manual-only.</p>
                                        </>
                                    )}
                                </div>
                            ) : (
                                <label className="mt-2 block text-xs text-neutral-700">
                                    Rationale
                                    <textarea value={rationale} onChange={event => setRationale(event.target.value)} rows={3} className="mt-1 w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
                                </label>
                            )}
                            <div className="mt-2 flex justify-end gap-2">
                                <button type="button" onClick={() => setPending(undefined)} className="min-h-11 rounded-lg px-3 text-xs font-medium text-neutral-700">Cancel</button>
                                <button type="button" disabled={!contextReady || pending !== 'provided_context' && (rationale.trim().length < 3 || pending === 'edit' && editedContent.trim().length === 0)} onClick={() => record(pending === 'edit' ? 'edited' : pending, pending === 'provided_context' ? buildProvidedContext() : rationale.trim())} className="min-h-11 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white disabled:opacity-50">{pending === 'provided_context' ? 'Use context' : 'Record choice'}</button>
                            </div>
                        </div>
                    )}
                    {canApply && <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3">
                        <div className="min-w-0 text-xs text-emerald-950">
                            <div className="flex items-center gap-1.5 font-semibold"><ShieldCheck size={14} /> Apply the exact user-approved change</div>
                            <div className="mt-2 grid gap-2 rounded-md border border-emerald-200 bg-white p-2.5 sm:grid-cols-2">
                                <div><strong>Operation:</strong> {approvedOperation?.replaceAll('_', ' ')}</div>
                                <div><strong>Output version:</strong> Current when this review opened</div>
                                <div className="sm:col-span-2">
                                    <strong>{review?.action === 'edited' ? 'Your edited replacement:' : 'Approved content:'}</strong>
                                    {approvedOperation === 'remove'
                                        ? <p className="mt-1 font-medium text-amber-800">This exact region will be removed. No neighboring region is included.</p>
                                        : <pre className="mt-1 max-h-36 overflow-auto whitespace-pre-wrap break-words font-sans text-xs text-neutral-800">{approvedContent}</pre>}
                                </div>
                                <div className="sm:col-span-2">
                                    <strong>Preserved:</strong> {proposal.preservedScope.length > 0 ? proposal.preservedScope.join(' · ') : 'All content outside the exact bound region.'}
                                </div>
                            </div>
                            {(approvedOperation === 'remove' || proposal.dataModelImpact?.destructive) && (
                                <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 font-medium text-amber-900"><AlertTriangle size={14} className="mt-0.5 shrink-0" /> Destructive change: review the exact removed content above. Synapse will not update migrations or dependencies automatically.</p>
                            )}
                            <p className="mt-2">Synapse will recheck that this change still matches the current plan and create a new artifact version. It will not regenerate the output, and application does not prove alignment.</p>
                        </div>
                        <div className="mt-3 flex justify-end">
                            <button type="button" disabled={busy} onClick={apply} className="min-h-11 shrink-0 rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white disabled:opacity-50">Apply approved change</button>
                        </div>
                    </div>}
                </div>
            )}
        </div>
    );
}
