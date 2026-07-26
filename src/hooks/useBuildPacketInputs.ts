// React binding for the store-derived half of the build-packet readiness
// evaluator (`src/lib/planning/buildPacketReadiness.ts`, plan §W6).
//
// The evaluator itself is pure and takes plain structural input. This hook
// assembles the part of that input that comes out of the project store —
// per-slot artifact state, the freshness evaluation, the resolved Data Model /
// API endpoints, and the consolidated plan — so the component only has to add
// the pieces it already computes (PRD, safety context, the current committed
// readiness checkpoint).
//
// Nothing here is persisted (cross-cutting rule 10), and staleness is CONSUMED
// from `useProjectFreshness` — the one freshness engine (rule 9) — never
// re-derived.
//
// SELECTOR-STABILITY RULE (CLAUDE.md; React error #185): each store read is its
// own selector returning the store's own reference or `undefined` — never a
// `?? []` literal inside a selector.

import { useMemo } from 'react';
import { useProjectStore } from '../store/projectStore';
import { useProjectFreshness } from './useProjectFreshness';
import { readArtifactValidationDisposition } from '../lib/artifactValidationPolicy';
import { resolveDataModelForTrace } from '../lib/screenArtifactTraceBridge';
import { parseDataModelMarkdown } from '../lib/services/dataModelMarkdown';
import { buildConsolidatedPlan } from '../lib/services/implementationPlanAdapter';
import {
    buildPacketRequiredSlots,
    type BuildPacketArtifactState,
    type BuildPacketFreshnessInput,
    type BuildPacketPlanInput,
} from '../lib/planning/buildPacketReadiness';
import type { ApiEndpointLike } from '../lib/apiContractCompleteness';
import type { Artifact, ArtifactSlotKey, ArtifactVersion, DataModelContent } from '../types';

export interface BuildPacketStoreInputs {
    artifacts: BuildPacketArtifactState[];
    freshness: BuildPacketFreshnessInput;
    /**
     * Resolved through the SAME resolver the advisory cross-cutting card uses
     * (`resolveDataModelForTrace`), so the gate and that card can never
     * disagree about which obligations a project owes.
     */
    dataModel: DataModelContent | null;
    /**
     * Endpoints resolved separately: a markdown-stored data model parses its
     * endpoints through `parseDataModelMarkdown`, which the trace resolver
     * deliberately does not carry through.
     */
    apiEndpoints: ApiEndpointLike[];
    plan: BuildPacketPlanInput | null;
}

const EMPTY_ENDPOINTS: ApiEndpointLike[] = [];

/** Endpoint contracts, from structured JSON content or stored markdown. */
function resolveApiEndpoints(content: string | undefined): ApiEndpointLike[] {
    if (!content || !content.trim()) return EMPTY_ENDPOINTS;
    try {
        const parsed = JSON.parse(content) as Partial<DataModelContent>;
        if (Array.isArray(parsed?.apiEndpoints)) return parsed.apiEndpoints;
    } catch {
        // not JSON — fall through to the markdown parser
    }
    return parseDataModelMarkdown(content)?.apiEndpoints ?? EMPTY_ENDPOINTS;
}

export function useBuildPacketInputs(projectId: string): BuildPacketStoreInputs {
    const artifacts = useProjectStore(s => s.artifacts[projectId]);
    const artifactVersions = useProjectStore(s => s.artifactVersions[projectId]);
    const job = useProjectStore(s => s.jobs[projectId]);
    const freshnessResult = useProjectFreshness(projectId);

    return useMemo(() => {
        const allArtifacts: Artifact[] = artifacts ?? [];
        const allVersions: ArtifactVersion[] = artifactVersions ?? [];
        // Slot → artifact resolution mirrors `buildDependencyEvaluationInput`
        // exactly (first mockup artifact as-is; first non-archived core
        // artifact per subtype; the `isPreferred` version), so the artifact
        // state and the freshness evaluation always describe the same version.
        const artifactFor = (slot: ArtifactSlotKey): Artifact | undefined => (
            slot === 'mockup'
                ? allArtifacts.find(item => item.type === 'mockup')
                : allArtifacts.find(item => (
                    item.type === 'core_artifact' && item.subtype === slot && item.status !== 'archived'
                ))
        );
        const preferredFor = (artifactId: string): ArtifactVersion | undefined =>
            allVersions.find(version => version.artifactId === artifactId && version.isPreferred);

        const states: BuildPacketArtifactState[] = [];
        const contentBySlot = new Map<ArtifactSlotKey, string>();
        for (const slot of buildPacketRequiredSlots()) {
            const artifact = artifactFor(slot);
            const preferred = artifact ? preferredFor(artifact.id) : undefined;
            if (preferred) contentBySlot.set(slot, preferred.content);
            const slotStatus = job?.slots[slot]?.status;
            states.push({
                nodeId: slot,
                artifactId: artifact?.id,
                versionId: preferred?.id,
                errored: slotStatus === 'error' || slotStatus === 'interrupted',
                validation: readArtifactValidationDisposition(preferred?.metadata),
            });
        }

        // Legacy `prompt_pack` artifacts still feed the consolidated plan
        // adapter, and they are not a required slot — resolve one separately.
        const legacyPromptPack = allArtifacts.find(item => (
            item.type === 'core_artifact' && item.subtype === 'prompt_pack' && item.status !== 'archived'
        ));
        const promptPackContent = legacyPromptPack
            ? preferredFor(legacyPromptPack.id)?.content
            : undefined;

        const dataModelContent = contentBySlot.get('data_model');
        const planContent = contentBySlot.get('implementation_plan');

        return {
            artifacts: states,
            freshness: {
                evaluations: freshnessResult.evaluations,
                artifactIdBySlot: freshnessResult.artifactIdBySlot,
            },
            dataModel: resolveDataModelForTrace(dataModelContent),
            apiEndpoints: resolveApiEndpoints(dataModelContent),
            plan: buildConsolidatedPlan({ planContent, promptPackContent }),
        };
    }, [artifacts, artifactVersions, job, freshnessResult]);
}
