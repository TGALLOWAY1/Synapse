import type { ArtifactVersion } from '../../types';
import { parseFlows } from '../../components/renderers/userFlows/parseFlow';
import { parseScreenInventory } from '../screenInventoryNormalize';
import { hashReviewValue } from '../review/hash';
import {
    downstreamUpdatePlanItemIntegrityHash,
    downstreamUpdateRegionKey,
    resolveDownstreamUpdateRegionContent,
    sealDownstreamArtifactUpdateProposal,
    type DownstreamArtifactUpdateOperation,
    type DownstreamArtifactUpdateProposal,
    type DownstreamArtifactUpdateReviewEvent,
} from './downstreamArtifactUpdateProposal';
import type { DownstreamUpdatePlan, DownstreamUpdatePlanItem, DownstreamUpdateRegion } from './downstreamUpdatePlan';

const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

type ProposalInput = {
    projectId: string;
    plan: DownstreamUpdatePlan;
    item: DownstreamUpdatePlanItem;
    artifactVersion: ArtifactVersion;
    createdAt?: number;
    requestNonce?: string;
};

export type ScreenFlowProposalResult =
    | { ok: true; proposal: DownstreamArtifactUpdateProposal }
    | { ok: false; reason: 'unsupported_artifact' | 'region_missing' | 'binding_mismatch' };

const WRITABLE_REMOVE_SCREEN_ASPECTS = new Set([
    'state', 'empty', 'error', 'permission', 'component', 'interaction', 'navigation',
]);
const WRITABLE_REMOVE_FLOW_ASPECTS = new Set([
    'step', 'branch', 'decision', 'error_recovery', 'entry', 'exit',
]);

function canProposeExactRemoval(plan: DownstreamUpdatePlan, item: DownstreamUpdatePlanItem): boolean {
    if (!plan.source.confirmed || item.certainty !== 'definite' || item.recommendedAction !== 'remove_obsolete_element'
        && item.recommendedAction !== 'reconsider_flow_branch') return false;
    if (!item.evidence.some(candidate => candidate.quality === 'direct')) return false;
    if (item.region.kind === 'screen') return WRITABLE_REMOVE_SCREEN_ASPECTS.has(item.region.aspect);
    if (item.region.kind === 'flow') return WRITABLE_REMOVE_FLOW_ASPECTS.has(item.region.aspect);
    return false;
}

function preservedBindings(
    version: ArtifactVersion,
    target: DownstreamUpdateRegion,
): DownstreamArtifactUpdateProposal['preservedRegionBindings'] {
    const regions: DownstreamUpdateRegion[] = [];
    if (target.kind === 'screen') {
        const inventory = parseScreenInventory(version.content);
        for (const screen of inventory?.sections.flatMap(section => section.screens) ?? []) {
            const screenId = screen.id ?? slug(screen.name);
            if (screenId !== target.screenId && screen.name !== target.screenName) {
                regions.push({ kind: 'screen', screenId, screenName: screen.name, aspect: 'screen' });
                continue;
            }
            if (target.aspect !== 'role') regions.push({ kind: 'screen', screenId, screenName: screen.name, aspect: 'role' });
            if (!['state', 'empty', 'error', 'permission'].includes(target.aspect)) {
                for (const state of screen.states ?? []) regions.push({
                    kind: 'screen', screenId, screenName: screen.name,
                    aspect: state.type === 'empty' || state.type === 'error' || state.type === 'permission' ? state.type : 'state',
                    aspectId: slug(state.name), label: state.name,
                });
            }
        }
    } else if (target.kind === 'flow') {
        for (const flow of parseFlows(version.content)) {
            const flowId = slug(flow.title);
            if (flowId !== target.flowId && flow.title !== target.flowName) {
                regions.push({ kind: 'flow', flowId, flowName: flow.title, aspect: 'flow' });
                continue;
            }
            for (const step of flow.steps) {
                if (step.index !== target.stepIndex) regions.push({
                    kind: 'flow', flowId, flowName: flow.title, aspect: 'step', stepIndex: step.index, label: step.title,
                });
            }
        }
    }
    return regions.flatMap(region => {
        const content = resolveDownstreamUpdateRegionContent(version, region);
        return content.found && content.contentHash ? [{
            region, regionKey: downstreamUpdateRegionKey(region), contentHash: content.contentHash,
        }] : [];
    });
}

export function deriveScreenFlowArtifactUpdateProposal(input: ProposalInput): ScreenFlowProposalResult {
    const { plan, item, artifactVersion } = input;
    if (plan.projectId !== input.projectId || plan.artifact.artifactVersionId !== artifactVersion.id
        || !plan.items.some(candidate => candidate.id === item.id)) return { ok: false, reason: 'binding_mismatch' };
    if (plan.artifact.slot !== 'screen_inventory' && plan.artifact.slot !== 'user_flows') {
        return { ok: false, reason: 'unsupported_artifact' };
    }
    const region = resolveDownstreamUpdateRegionContent(artifactVersion, item.region);
    if (!region.found || !region.contentHash || region.snapshot === undefined) return { ok: false, reason: 'region_missing' };
    const exactRemoval = canProposeExactRemoval(plan, item);
    const operation: DownstreamArtifactUpdateOperation = exactRemoval ? 'remove' : 'review_only';
    const createdAt = input.createdAt ?? Date.now();
    const requestNonce = input.requestNonce ?? 'initial';
    const generator = {
        provider: 'synapse', model: 'bounded-structural-planner',
        promptHash: hashReviewValue({ plan: plan.integrityHash, item, requestNonce }),
        reasoningVersion: 'phase-5-screen-flow-v1',
    };
    return { ok: true, proposal: sealDownstreamArtifactUpdateProposal({
        schemaVersion: 1,
        id: `artifact-update-${hashReviewValue({ plan: plan.id, item: item.id, region: region.contentHash, requestNonce, createdAt })}`,
        projectId: input.projectId,
        authoredBy: 'synapse',
        updatePlanBinding: {
            planId: plan.id,
            planIntegrityHash: plan.integrityHash,
            itemId: item.id,
            itemIntegrityHash: downstreamUpdatePlanItemIntegrityHash(plan, item),
        },
        source: plan.source,
        artifact: plan.artifact,
        region: item.region,
        regionKey: downstreamUpdateRegionKey(item.region),
        currentRegionContentHash: region.contentHash,
        currentRegionSnapshot: region.snapshot,
        currentRegionSnapshotTruncated: Boolean(region.snapshotTruncated),
        operation,
        proposedContent: null,
        evidence: item.evidence,
        reasoning: exactRemoval
            ? 'The confirmed source change and direct dependency evidence support removing only this exact obsolete region.'
            : 'The dependency warrants review, but the durable project state does not specify a safe exact replacement. Add context or make a manual change.',
        certainty: item.certainty,
        ...(item.ambiguity ? { ambiguity: item.ambiguity } : {}),
        preservedScope: item.preservedScope,
        preservedScopeHash: hashReviewValue(item.preservedScope),
        preservedRegionBindings: preservedBindings(artifactVersion, item.region),
        generator,
        createdAt,
    }) };
}

type ApplyResult =
    | { ok: true; content: string; resultingRegionContentHash: string }
    | { ok: false; reason: 'unsupported_region' | 'invalid_content' | 'target_missing' | 'no_change' };

type MutableRecord = Record<string, unknown>;

function parsedReplacement(value: string, existing: unknown): unknown {
    try { return JSON.parse(value); } catch {
        return typeof existing === 'string' ? value : undefined;
    }
}

function mutateArrayTarget(
    values: unknown[],
    index: number,
    operation: Exclude<DownstreamArtifactUpdateOperation, 'review_only'>,
    proposedContent: string | null,
): boolean {
    if (index < 0) return false;
    if (operation === 'remove') values.splice(index, 1);
    else {
        if (proposedContent === null) return false;
        const next = parsedReplacement(proposedContent, values[index]);
        if (next === undefined) return false;
        if (operation === 'add') values.splice(index + 1, 0, next);
        else values[index] = next;
    }
    return true;
}

function applyScreenChange(
    content: string,
    region: Extract<DownstreamUpdateRegion, { kind: 'screen' }>,
    operation: Exclude<DownstreamArtifactUpdateOperation, 'review_only'>,
    proposedContent: string | null,
): string | undefined {
    let root: MutableRecord;
    try { root = JSON.parse(content) as MutableRecord; } catch { return undefined; }
    const groups = (Array.isArray(root.sections) ? root.sections : Array.isArray(root.groups) ? root.groups : []) as MutableRecord[];
    let screen: MutableRecord | undefined;
    let screenArray: unknown[] | undefined;
    let screenIndex = -1;
    for (const group of groups) {
        if (!Array.isArray(group.screens)) continue;
        const index = group.screens.findIndex(candidate => {
            if (!candidate || typeof candidate !== 'object') return false;
            const value = candidate as MutableRecord;
            return value.id === region.screenId || value.name === region.screenName || slug(String(value.name ?? '')) === region.screenId;
        });
        if (index >= 0) {
            screenArray = group.screens;
            screenIndex = index;
            screen = group.screens[index] as MutableRecord;
            break;
        }
    }
    if (!screen || !screenArray) return undefined;
    if (region.aspect === 'screen') {
        if (!mutateArrayTarget(screenArray, screenIndex, operation, proposedContent)) return undefined;
        return JSON.stringify(root);
    }
    const findNamed = (values: unknown[], kind?: string): number => values.findIndex(candidate => {
        if (typeof candidate === 'string') return slug(candidate) === region.aspectId || candidate === region.label;
        if (!candidate || typeof candidate !== 'object') return false;
        const value = candidate as MutableRecord;
        return slug(String(value.name ?? value.label ?? value.target ?? '')) === region.aspectId
            || value.name === region.label || value.label === region.label || value.target === region.label
            || (kind ? value.type === kind : false);
    });
    if (['state', 'empty', 'error', 'permission'].includes(region.aspect)) {
        if (!Array.isArray(screen.states)) return undefined;
        const index = findNamed(screen.states, region.aspect === 'state' ? undefined : region.aspect);
        if (!mutateArrayTarget(screen.states, index, operation, proposedContent)) return undefined;
    } else if (region.aspect === 'component') {
        const key = Array.isArray(screen.coreUIElements) ? 'coreUIElements' : 'components';
        if (!Array.isArray(screen[key])) return undefined;
        const index = findNamed(screen[key] as unknown[]);
        if (!mutateArrayTarget(screen[key] as unknown[], index, operation, proposedContent)) return undefined;
    } else if (region.aspect === 'interaction') {
        if (!screen.handoff || typeof screen.handoff !== 'object' || !Array.isArray((screen.handoff as MutableRecord).events)) return undefined;
        const events = (screen.handoff as MutableRecord).events as unknown[];
        if (!mutateArrayTarget(events, findNamed(events), operation, proposedContent)) return undefined;
    } else if (region.aspect === 'navigation') {
        if (Array.isArray(screen.exitPaths)) {
            const index = findNamed(screen.exitPaths);
            if (index >= 0) {
                if (!mutateArrayTarget(screen.exitPaths, index, operation, proposedContent)) return undefined;
                return JSON.stringify(root);
            }
        }
        if (Array.isArray(screen.entryPoints)) {
            const index = findNamed(screen.entryPoints);
            if (index >= 0) {
                if (!mutateArrayTarget(screen.entryPoints, index, operation, proposedContent)) return undefined;
                return JSON.stringify(root);
            }
        }
        const handoff = screen.handoff as MutableRecord | undefined;
        if (!handoff || typeof handoff.route !== 'string'
            || !(slug(handoff.route) === region.aspectId || handoff.route === region.label)) return undefined;
        if (operation === 'remove') delete handoff.route;
        else if (proposedContent !== null) handoff.route = parsedReplacement(proposedContent, handoff.route) as string;
        else return undefined;
    } else if (region.aspect === 'role') {
        if (operation === 'remove') return undefined;
        if (proposedContent === null) return undefined;
        const replacement = parsedReplacement(proposedContent, { purpose: screen.purpose, userIntent: screen.userIntent });
        if (!replacement || typeof replacement !== 'object') return undefined;
        const value = replacement as MutableRecord;
        if (typeof value.purpose === 'string') screen.purpose = value.purpose;
        if (typeof value.userIntent === 'string') screen.userIntent = value.userIntent;
    } else return undefined;
    return JSON.stringify(root);
}

type Line = { start: number; end: number; text: string };
const linesWithOffsets = (content: string): Line[] => {
    const lines: Line[] = [];
    let start = 0;
    for (const match of content.matchAll(/.*(?:\n|$)/g)) {
        if (!match[0]) continue;
        lines.push({ start, end: start + match[0].length, text: match[0].replace(/\r?\n$/, '') });
        start += match[0].length;
    }
    return lines;
};

function applyFlowChange(
    content: string,
    region: Extract<DownstreamUpdateRegion, { kind: 'flow' }>,
    operation: Exclude<DownstreamArtifactUpdateOperation, 'review_only'>,
    proposedContent: string | null,
): string | undefined {
    const lines = linesWithOffsets(content);
    const headings = lines.map((line, index) => ({ line, index, match: line.text.match(/^#{1,4}\s+Flow:\s*(.+?)\s*$/i) }))
        .filter(candidate => candidate.match);
    const headingIndex = headings.findIndex(candidate => {
        const title = candidate.match![1].replace(/\s*[[(].*?[\])]/g, '').trim();
        return slug(title) === region.flowId || title === region.flowName;
    });
    if (headingIndex < 0) return undefined;
    const startLine = headings[headingIndex].index;
    const endLine = headings[headingIndex + 1]?.index ?? lines.length;
    let targetStart = -1;
    let targetEnd = -1;
    if (region.aspect === 'flow') {
        targetStart = startLine;
        targetEnd = endLine;
    } else {
        const sectionName = region.aspect === 'entry' ? /Entry\s*Points?/i
            : region.aspect === 'exit' ? /Success Outcome/i
                : region.aspect === 'error_recovery' && region.stepIndex === undefined ? /Error Paths/i
                    : /Steps/i;
        const sectionLine = lines.slice(startLine + 1, endLine).findIndex(line => /^\*\*[^\n]+:\*\*/.test(line.text) && sectionName.test(line.text));
        if (sectionLine < 0) return undefined;
        const sectionAbsolute = startLine + 1 + sectionLine;
        const nextSection = lines.slice(sectionAbsolute + 1, endLine).findIndex(line => /^\*\*[^\n]+:\*\*/.test(line.text));
        const sectionEnd = nextSection < 0 ? endLine : sectionAbsolute + 1 + nextSection;
        if (region.aspect === 'entry' || region.aspect === 'exit' || (region.aspect === 'error_recovery' && region.stepIndex === undefined)) {
            if (!region.label) {
                targetStart = sectionAbsolute + 1;
                targetEnd = sectionEnd;
            } else {
                const index = lines.slice(sectionAbsolute + 1, sectionEnd).findIndex(line => line.text.includes(region.label!));
                if (index < 0) return undefined;
                targetStart = sectionAbsolute + 1 + index;
                targetEnd = targetStart + 1;
            }
        } else {
            const stepStarts = lines.slice(sectionAbsolute + 1, sectionEnd)
                .map((line, index) => (/^\s*\d+\.\s+/.test(line.text) ? sectionAbsolute + 1 + index : -1))
                .filter(index => index >= 0);
            const stepStart = region.stepIndex === undefined ? undefined : stepStarts[region.stepIndex];
            if (stepStart === undefined) return undefined;
            const stepPosition = stepStarts.indexOf(stepStart);
            const stepEnd = stepStarts[stepPosition + 1] ?? sectionEnd;
            if (region.aspect === 'step') {
                targetStart = stepStart;
                targetEnd = stepEnd;
            } else if (region.aspect === 'actor') {
                const line = lines[stepStart];
                if (operation === 'remove' || proposedContent === null) return undefined;
                const arrow = line.text.search(/\s*(?:→|->|⇒)\s*/);
                const prefix = line.text.match(/^(\s*\d+\.\s+(?:\[[^\]]+\]\s*[—-]\s*)?)/)?.[1];
                if (!prefix || arrow < prefix.length) return undefined;
                const next = `${line.text.slice(0, prefix.length)}${proposedContent}${line.text.slice(arrow)}`;
                return content.slice(0, line.start) + next + content.slice(line.start + line.text.length);
            } else {
                const index = lines.slice(stepStart + 1, stepEnd).findIndex(line => region.label ? line.text.includes(region.label) : false);
                if (index < 0) return undefined;
                targetStart = stepStart + 1 + index;
                targetEnd = targetStart + 1;
            }
        }
    }
    if (targetStart < 0 || targetEnd <= targetStart) return undefined;
    const start = lines[targetStart].start;
    const end = lines[targetEnd - 1].end;
    let replacement = '';
    if (operation !== 'remove') {
        if (proposedContent === null) return undefined;
        const indent = lines[targetStart].text.match(/^\s*/)?.[0] ?? '';
        replacement = proposedContent.split('\n').map(line => `${indent}${line}`).join('\n');
        if (content.slice(start, end).endsWith('\n')) replacement += '\n';
        if (operation === 'add') return content.slice(0, end) + replacement + content.slice(end);
    }
    return content.slice(0, start) + replacement + content.slice(end);
}

export function removedDownstreamUpdateRegionHash(region: DownstreamUpdateRegion): string {
    return hashReviewValue({ removed: true, regionKey: downstreamUpdateRegionKey(region) });
}

export function applyScreenFlowArtifactUpdate(input: {
    proposal: DownstreamArtifactUpdateProposal;
    review: DownstreamArtifactUpdateReviewEvent;
    artifactVersion: ArtifactVersion;
}): ApplyResult {
    const { proposal, review, artifactVersion } = input;
    if (proposal.artifact.slot !== 'screen_inventory' && proposal.artifact.slot !== 'user_flows') {
        return { ok: false, reason: 'unsupported_region' };
    }
    const operation = review.action === 'edited' ? review.operation
        : review.action === 'accepted' && proposal.operation !== 'review_only' ? proposal.operation
            : undefined;
    const proposedContent = review.action === 'edited' ? review.editedContent : proposal.proposedContent;
    if (!operation) return { ok: false, reason: 'unsupported_region' };
    const next = proposal.region.kind === 'screen'
        ? applyScreenChange(artifactVersion.content, proposal.region, operation, proposedContent)
        : proposal.region.kind === 'flow'
            ? applyFlowChange(artifactVersion.content, proposal.region, operation, proposedContent)
            : undefined;
    if (next === undefined) return { ok: false, reason: 'target_missing' };
    if (next === artifactVersion.content) return { ok: false, reason: 'no_change' };
    const resultRegion = resolveDownstreamUpdateRegionContent({ content: next }, proposal.region);
    if (operation === 'remove') {
        if (resultRegion.found) return { ok: false, reason: 'invalid_content' };
        return { ok: true, content: next, resultingRegionContentHash: removedDownstreamUpdateRegionHash(proposal.region) };
    }
    if (!resultRegion.found || !resultRegion.contentHash) return { ok: false, reason: 'invalid_content' };
    return { ok: true, content: next, resultingRegionContentHash: resultRegion.contentHash };
}
