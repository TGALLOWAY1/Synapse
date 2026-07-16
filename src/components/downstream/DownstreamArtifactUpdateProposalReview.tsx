import { useMemo, useState } from 'react';
import { AlertTriangle, Check, FileEdit, Loader2, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import {
    latestDownstreamArtifactUpdateReview,
    type DownstreamArtifactUpdateProposal,
    type DownstreamArtifactUpdateReviewAction,
} from '../../lib/planning/downstreamArtifactUpdateProposal';
import type { DownstreamUpdatePlan, DownstreamUpdatePlanItem } from '../../lib/planning/downstreamUpdatePlan';
import { useProjectStore } from '../../store/projectStore';
import type { ArtifactVersion } from '../../types';

const EMPTY_PROPOSALS: DownstreamArtifactUpdateProposal[] = [];
const EMPTY_EVENTS: ReturnType<typeof useProjectStore.getState>['downstreamArtifactUpdateReviewEvents'][string] = [];
const EMPTY_APPLICATIONS: ReturnType<typeof useProjectStore.getState>['downstreamArtifactUpdateApplications'][string] = [];
const EMPTY_ARTIFACT_VERSIONS: ArtifactVersion[] = [];

type PendingAction = Exclude<DownstreamArtifactUpdateReviewAction, 'accepted' | 'edited'> | 'edit';

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
    if (proposal.operation === 'review_only') return 'No bounded content change is available. Review manually or provide more context.';
    if (proposal.operation === 'remove') return 'Remove only this exact region.';
    return proposal.proposedContent ?? 'No proposed content.';
}

export function DownstreamArtifactUpdateProposalReview({
    projectId, plan, item, readOnly,
}: DownstreamArtifactUpdateProposalReviewProps) {
    const proposals = useProjectStore(state => state.downstreamArtifactUpdateProposals[projectId] ?? EMPTY_PROPOSALS);
    const events = useProjectStore(state => state.downstreamArtifactUpdateReviewEvents[projectId] ?? EMPTY_EVENTS);
    const applications = useProjectStore(state => state.downstreamArtifactUpdateApplications[projectId] ?? EMPTY_APPLICATIONS);
    const artifactVersions = useProjectStore(state => state.artifactVersions[projectId] ?? EMPTY_ARTIFACT_VERSIONS);
    const generate = useProjectStore(state => state.generateDownstreamArtifactUpdateProposal);
    const appendReview = useProjectStore(state => state.appendDownstreamArtifactUpdateReviewEvent);
    const applyProposal = useProjectStore(state => state.applyDownstreamArtifactUpdateProposal);
    const [pending, setPending] = useState<PendingAction>();
    const [rationale, setRationale] = useState('');
    const [editedContent, setEditedContent] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string }>();

    const proposal = useMemo(() => proposals
        .filter(candidate => candidate.updatePlanBinding.planId === plan.id
            && candidate.updatePlanBinding.itemId === item.id)
        .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))[0], [item.id, plan.id, proposals]);
    const boundArtifactVersion = proposal
        ? artifactVersions.find(candidate => candidate.id === proposal.artifact.artifactVersionId)
        : undefined;
    const review = proposal ? latestDownstreamArtifactUpdateReview(proposal, events) : undefined;
    const application = proposal ? applications.find(candidate => candidate.proposalId === proposal.id) : undefined;
    // The named artifact-version subscription above makes proposal freshness
    // reactive to manual/concurrent content changes without hidden rerenders.
    const currentness = proposal && boundArtifactVersion
        ? useProjectStore.getState().getDownstreamArtifactUpdateProposalCurrentness(projectId, proposal.id)
        : undefined;
    const proposalReadOnly = readOnly || !currentness?.current || Boolean(application);

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
            : 'A bounded proposal is ready for your review.' });
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
            : 'Your review choice is preserved in proposal history.' });
        if (action === 'requested_another') prepare();
    };

    const apply = () => {
        if (!proposal) return;
        setBusy(true);
        const result = applyProposal(projectId, proposal.id);
        setBusy(false);
        setMessage(result.status === 'applied'
            ? { kind: 'success', text: `Applied as a new artifact version (${result.artifactVersionId.slice(0, 8)}). Alignment still requires verification.` }
            : { kind: 'error', text: result.reason === 'stale'
                ? 'Nothing changed. The proposal is stale and must be prepared again against the current artifact.'
                : 'Nothing changed. The approved proposal could not be applied safely.' });
    };

    if (!proposal) return (
        <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-indigo-950">
                        <Sparkles size={14} aria-hidden="true" /> Prepare a bounded change proposal
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-indigo-800">Synapse will propose content only when the exact region and change are strongly grounded. Otherwise it will explain why manual review is safer.</p>
                </div>
                <button type="button" disabled={readOnly || busy} onClick={prepare} className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50">
                    {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} Prepare proposal
                </button>
            </div>
            {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={`mt-2 text-xs ${message.kind === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>{message.text}</p>}
        </div>
    );

    const writable = proposal.operation !== 'review_only';
    const canApply = !proposalReadOnly && !application && (review?.action === 'accepted' || review?.action === 'edited');
    const startPending = (action: PendingAction) => {
        setPending(action);
        setRationale('');
        if (action === 'edit') setEditedContent(proposal.proposedContent ?? proposal.currentRegionSnapshot);
        setMessage(undefined);
    };

    return (
        <div className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-indigo-950">
                    <FileEdit size={14} aria-hidden="true" /> Selective change proposal
                    <span className="rounded-full border border-indigo-200 bg-white px-2 py-0.5 text-[11px] font-medium text-indigo-700">
                        {proposal.operation === 'review_only' ? 'Review only' : 'Bounded change'}
                    </span>
                </div>
                <span className="text-[11px] text-indigo-700">Artifact version {proposal.artifact.artifactVersionId.slice(0, 8)}</span>
            </div>

            {!currentness?.current && <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-900">Historical proposal — its planning source or artifact binding changed. It cannot be approved or applied.</p>}
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
            {application && <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700"><Check size={14} /> Applied in version {application.resultingArtifactVersionId.slice(0, 8)}. Verification remains separate.</p>}
            {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className={`mt-2 rounded-md px-2.5 py-2 text-xs ${message.kind === 'error' ? 'bg-red-50 text-red-800' : 'bg-emerald-50 text-emerald-800'}`}>{message.text}</p>}

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
                            <label className="mt-2 block text-xs text-neutral-700">
                                {pending === 'provided_context' ? 'Missing context' : 'Rationale'}
                                <textarea value={rationale} onChange={event => setRationale(event.target.value)} rows={3} className="mt-1 w-full resize-y rounded-lg border border-neutral-300 px-3 py-2 text-sm" />
                            </label>
                            <div className="mt-2 flex justify-end gap-2">
                                <button type="button" onClick={() => setPending(undefined)} className="min-h-11 rounded-lg px-3 text-xs font-medium text-neutral-700">Cancel</button>
                                <button type="button" disabled={rationale.trim().length < 3 || pending === 'edit' && editedContent.trim().length === 0} onClick={() => record(pending === 'edit' ? 'edited' : pending, rationale.trim())} className="min-h-11 rounded-lg bg-indigo-600 px-3 text-xs font-semibold text-white disabled:opacity-50">Record choice</button>
                            </div>
                        </div>
                    )}
                    {canApply && <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 p-3">
                        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0 text-xs text-emerald-900">
                                <div className="flex items-center gap-1.5 font-semibold"><ShieldCheck size={14} /> Apply only this approved region</div>
                                <p className="mt-1">Synapse will recheck every version binding and create a new artifact version. Application does not prove alignment.</p>
                            </div>
                            <button type="button" disabled={busy} onClick={apply} className="min-h-11 shrink-0 rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white disabled:opacity-50">Apply approved change</button>
                        </div>
                    </div>}
                </div>
            )}
        </div>
    );
}
