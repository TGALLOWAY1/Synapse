import type { ArtifactVersion } from '../../types';
import { hashReviewValue } from '../review/hash';
import { parseScreenInventory } from '../screenInventoryNormalize';
import { parseDataModelMarkdown } from '../services/dataModelMarkdown';
import type { DownstreamUpdateRegion } from './downstreamUpdatePlan';

export const MAX_DOWNSTREAM_REGION_SNAPSHOT_LENGTH = 8_000;

export type ResolvedDownstreamRegionContent = {
    found: boolean;
    contentHash?: string;
    snapshot?: string;
    snapshotTruncated?: boolean;
};

const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

const resolved = (value: unknown): ResolvedDownstreamRegionContent => {
    if (value === undefined) return { found: false };
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    return {
        found: true,
        contentHash: hashReviewValue(value),
        snapshot: serialized.slice(0, MAX_DOWNSTREAM_REGION_SNAPSHOT_LENGTH),
        snapshotTruncated: serialized.length > MAX_DOWNSTREAM_REGION_SNAPSHOT_LENGTH,
    };
};

function resolveFlow(markdown: string, region: Extract<DownstreamUpdateRegion, { kind: 'flow' }>): unknown {
    const headings = [...markdown.matchAll(/^#{1,4}\s+Flow:\s*(.+?)\s*$/gim)];
    const heading = headings.find(match => slug(match[1].replace(/\s*[[(].*?[\])]/g, '').trim()) === region.flowId
        || match[1].replace(/\s*[[(].*?[\])]/g, '').trim() === region.flowName);
    if (!heading || heading.index === undefined) return undefined;
    const next = headings.find(match => (match.index ?? 0) > heading.index!);
    const section = markdown.slice(heading.index, next?.index ?? markdown.length).trim();
    if (region.aspect === 'flow') return section;
    const stepsStart = section.search(/^\*\*Steps:\*\*/im);
    if (stepsStart < 0) return undefined;
    const stepsBlock = section.slice(stepsStart).split(/^\*\*(?:Success Outcome|Error Paths|Edge Cases|Assumptions?|Open Questions?):\*\*/im)[0];
    const steps = [...stepsBlock.matchAll(/^\s*(\d+)\.\s+(.+)(?:\n(?!\s*\d+\.\s)[\s\S]*?)?(?=^\s*\d+\.\s|$)/gm)];
    const step = steps.find((_match, index) => index === region.stepIndex);
    if (!step) return undefined;
    if (region.aspect === 'step') return step[0].trim();
    if (!region.label) return step[0].trim();
    const matchingLine = step[0].split('\n').find(line => line.includes(region.label!));
    return matchingLine?.trim() ?? step[0].trim();
}

function resolveLegacyDataModelJson(content: string, region: Extract<DownstreamUpdateRegion, { kind: 'data_model' }>): unknown {
    let raw: unknown;
    try { raw = JSON.parse(content); } catch { return undefined; }
    if (!raw || typeof raw !== 'object') return undefined;
    const entities = (raw as { entities?: unknown }).entities;
    if (!Array.isArray(entities)) return undefined;
    const entity = entities.find(candidate => candidate && typeof candidate === 'object'
        && (candidate as { name?: unknown }).name === region.entityName) as Record<string, unknown> | undefined;
    if (!entity) return undefined;
    if (region.aspect === 'entity') return entity;
    if (region.aspect === 'field') {
        return Array.isArray(entity.fields)
            ? entity.fields.find(candidate => candidate && typeof candidate === 'object'
                && (candidate as { name?: unknown }).name === region.memberName)
            : undefined;
    }
    if (region.aspect === 'relationship') {
        return Array.isArray(entity.relationships)
            ? entity.relationships.find(candidate => {
                if (typeof candidate === 'string') return candidate === region.memberName;
                if (!candidate || typeof candidate !== 'object') return false;
                const value = candidate as { name?: unknown; target?: unknown; description?: unknown };
                return value.name === region.memberName || value.target === region.memberName || value.description === region.memberName;
            })
            : undefined;
    }
    return Array.isArray(entity.constraints)
        ? entity.constraints.find(candidate => candidate === region.memberName)
        : undefined;
}

export function resolveDownstreamUpdateRegionContent(
    artifactVersion: Pick<ArtifactVersion, 'content'>,
    region: DownstreamUpdateRegion,
): ResolvedDownstreamRegionContent {
    // A broad review binds the whole current artifact so it can remain durable
    // and stale correctly, but the proposal contract still forbids any writable
    // operation against this non-precise region.
    if (region.kind === 'artifact_review') return resolved(artifactVersion.content);

    if (region.kind === 'screen') {
        const inventory = parseScreenInventory(artifactVersion.content);
        const screen = inventory?.sections.flatMap(section => section.screens)
            .find(candidate => candidate.id === region.screenId || candidate.name === region.screenName);
        if (!screen) return { found: false };
        if (region.aspect === 'state') return resolved(screen.states?.find(state => slug(state.name) === region.aspectId || state.name === region.label));
        if (region.aspect === 'behavior') return resolved({ coreUIElements: screen.coreUIElements, exitPaths: screen.exitPaths, handoff: screen.handoff });
        if (region.aspect === 'role') return resolved({ purpose: screen.purpose, userIntent: screen.userIntent });
        return resolved(screen);
    }

    if (region.kind === 'flow') return resolved(resolveFlow(artifactVersion.content, region));

    const legacy = resolveLegacyDataModelJson(artifactVersion.content, region);
    if (legacy !== undefined) return resolved(legacy);
    const entity = parseDataModelMarkdown(artifactVersion.content)?.entities.find(candidate => candidate.name === region.entityName);
    if (!entity) return { found: false };
    if (region.aspect === 'field') return resolved(entity.fieldGroups.flatMap(group => group.fields).find(field => field.name === region.memberName));
    if (region.aspect === 'relationship' || region.aspect === 'constraint') {
        const expectedKind = region.aspect === 'relationship' ? 'RELATIONSHIP' : 'CONSTRAINT';
        return resolved(entity.callouts.find(callout => callout.kind === expectedKind && callout.text === region.memberName));
    }
    return resolved(entity);
}
