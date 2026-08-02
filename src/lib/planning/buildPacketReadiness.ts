// Build-packet readiness — the SECOND, separate readiness evaluator introduced
// by §W6 of docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md (the keystone).
//
// TWO EVALUATORS, TWO QUESTIONS. They must stay independently reportable and
// must never be conflated in copy:
//
//   derivePlanningReadiness   → "is the product REASONING sound?"      → PRD approved
//   deriveBuildPacketReadiness → "is the implementation PACKET
//                                 complete and current?"              → Ready to build
//
// `derivePlanningReadiness.isReadyToBuild` looks at foundation clarity, scope
// confirmation, decisions, challenge coverage and alignment. Nothing in it
// looks at whether the artifacts exist, are current, are complete, or are
// reviewed. This module answers exactly that, and deliberately does NOT export
// a field named `isReadyToBuild` — that name belongs to the reasoning
// projection.
//
// Rules this module holds to:
//  - PURE and DERIVED ON READ (cross-cutting rule 10). No store, no React, no
//    LLM, no persistence, no side effects. Nothing here is written to an
//    artifact or a collection, and nothing auto-rewrites an artifact.
//  - ADVISORY TRANSPORT, HONEST REPORT. The evaluator *reports*; it never
//    prevents rendering or generation on its own. Consumers decide what to do
//    with a blocker list.
//  - ONE FRESHNESS ENGINE (cross-cutting rule 9). Staleness is CONSUMED from
//    `evaluateProjectFreshness` / `useProjectFreshness` output — never
//    re-derived, and no second staleness source is introduced. Both `status`
//    AND `impactedBy` are read: `evaluateDependencyGraph` leaves a node
//    `up_to_date` when an upstream is MISSING or ERRORED (it has nothing
//    concrete to compare) and records the problem only in `impactedBy`, so
//    `isStaleStatus(status)` alone misses exactly the case §W2 called out.
//  - NO COMPOSITE SCORE (cross-cutting rule 13). There is no percentage,
//    weight, or confidence number — only per-criterion booleans, an itemised
//    blocker list, and an itemised warning list.
//  - NON-BLOCKING WARNINGS ARE EARNED. A warning is permitted only when its
//    owner, impact, and rationale are all recorded (the `BuildPacketWarning`
//    type makes all three required). Anything that cannot state those three is
//    a blocker, not a warning.
//  - FAIL CLOSED. An input that cannot be verified (absent freshness, an
//    unverifiable readiness commitment, a commitment bound to a different
//    spine) blocks rather than passing silently.
//  - SELF-REPORTED PROGRESS IS NEVER EVIDENCE (plan §W8). Nothing in this
//    module may read a task's progress state: not `ImplementationPlanTask
//    .status`, not the persisted `ProjectTask.status` the Implementation
//    progress checklist ticks, and not the `planProgress` overlay. Synapse
//    never runs a build, a test, or a command, so "implemented" is a user
//    claim (see `lib/taskProgressLanguage.ts`) — treating it as evidence would
//    let a project tick its way to a green packet. Plan tasks are read for
//    their STRUCTURE only: ids, titles, descriptions, `linkedArtifacts`,
//    `dependencies`, and the verification texts around them (definition of
//    done, quality gates, prompt-pack acceptance criteria).
//    `BuildPacketReadinessInput` deliberately has no tasks/progress field.
//    Locked by `__tests__/buildPacketReadiness.test.ts` →
//    "self-reported task progress is never evidence".
//
// Every criterion carries evidence and a navigable action target so §W7's
// Final Review can render "Resolve N blockers" with somewhere to send the user.

import type {
    ArtifactSlotKey,
    ArtifactValidationBlocker,
    ArtifactValidationDisposition,
    DataModelContent,
    Feature,
    ImplementationPlanMilestone,
    ImplementationPlanTask,
    ImplementationPromptPack,
    ImplementationQualityGate,
    PlanMeasurementSection,
    PlanSecurityPrivacySection,
    ReadinessActionTarget,
    ReadinessCriterionEvidenceQuality,
    ReadinessReviewConclusion,
    StructuredPRD,
} from '../../types';
import type { DependencyNodeEvaluation, DependencyNodeId } from '../artifactDependencyGraph';
import { isStaleStatus } from '../artifactFreshness';
import { getArtifactMeta, visibleCoreSubtypes } from '../coreArtifactPipeline';
import {
    evaluateEndpointContract,
    type ApiEndpointLike,
    type ContractFieldName,
} from '../apiContractCompleteness';
import {
    buildRequirementIndex,
    resolveCriterionRefs,
    type RequirementId,
    type RequirementIndex,
} from '../requirementIdentity';
import { hashReviewValue } from '../review/hash';
import {
    deriveCrossCuttingObligations,
    type CrossCuttingObligationsReport,
    type CrossCuttingSafetyContext,
} from './crossCuttingObligations';

// --- Public shape -------------------------------------------------------------

/**
 * The eight blocking criteria of the §W6 table, in blocker-report order.
 * Deliberately its OWN vocabulary — never merged with
 * `ReadinessReviewCriterionId` (product reasoning) or `DependencyNodeStatus`
 * (system freshness).
 */
export type BuildPacketCriterionId =
    | 'artifacts_present'
    | 'sources_current'
    | 'validation_clear'
    | 'requirement_coverage'
    | 'api_contract'
    | 'cross_cutting'
    | 'first_slice'
    | 'reasoning_committed';

export const BUILD_PACKET_CRITERION_ORDER: readonly BuildPacketCriterionId[] = [
    'artifacts_present',
    'sources_current',
    'validation_clear',
    'requirement_coverage',
    'api_contract',
    'cross_cutting',
    'first_slice',
    'reasoning_committed',
];

export const BUILD_PACKET_CRITERION_LABELS: Record<BuildPacketCriterionId, string> = {
    artifacts_present: 'Required outputs generated',
    sources_current: 'Packet inputs current',
    validation_clear: 'Output validation clear',
    requirement_coverage: 'In-scope requirements covered',
    api_contract: 'First-slice API contracts complete',
    cross_cutting: 'Cross-cutting obligations discharged',
    first_slice: 'First slice is executable',
    reasoning_committed: 'Product reasoning committed',
};

/** Which artifact sub-surface a slot action target should open. */
export type BuildPacketArtifactSection = 'api_contract' | 'coverage' | 'first_milestone';

/**
 * Action targets reuse `ReadinessActionTarget` (prd / feature /
 * planning_record / challenge / update_plan / output) and add only the two
 * destinations the packet needs that it does not already carry: an artifact
 * SLOT that may not have an artifact id yet (a missing output has none), and
 * the readiness checkpoint where a commitment is recorded.
 */
export interface BuildPacketArtifactActionTarget {
    kind: 'artifact_slot';
    nodeId: ArtifactSlotKey;
    artifactId?: string;
    section?: BuildPacketArtifactSection;
    milestoneId?: string;
}

export type BuildPacketActionTarget =
    | ReadinessActionTarget
    | BuildPacketArtifactActionTarget
    | { kind: 'readiness_commitment' };

export type BuildPacketEvidenceSourceType =
    | 'artifact'
    | 'freshness'
    | 'validation'
    | 'prd'
    | 'plan'
    | 'data_model'
    | 'commitment';

export interface BuildPacketEvidence {
    id: string;
    /** Same honest three-way quality vocabulary the readiness review uses. */
    quality: ReadinessCriterionEvidenceQuality;
    summary: string;
    sourceType: BuildPacketEvidenceSourceType;
    sourceId?: string;
    sourceVersionId?: string;
}

export interface BuildPacketBlocker {
    id: string;
    criterionId: BuildPacketCriterionId;
    title: string;
    /** What goes wrong if this packet is handed to a build as-is. */
    consequence: string;
    /** The concrete next move, in the user's own workflow terms. */
    remedy: string;
    evidenceQuality: ReadinessCriterionEvidenceQuality;
    actionTarget: BuildPacketActionTarget;
}

/** Who has to act on a warning. A warning with no owner is a blocker. */
export type BuildPacketWarningOwner = 'user' | 'synapse';

/**
 * A NON-BLOCKING finding. All three of `owner`, `impact` and `rationale` are
 * REQUIRED by the type: §W6 permits a non-blocking warning only when those are
 * recorded, so anything that cannot state them must be pushed as a blocker.
 */
export interface BuildPacketWarning {
    id: string;
    criterionId: BuildPacketCriterionId;
    title: string;
    owner: BuildPacketWarningOwner;
    impact: string;
    rationale: string;
    actionTarget: BuildPacketActionTarget;
}

export interface BuildPacketCriterion {
    id: BuildPacketCriterionId;
    label: string;
    status: 'met' | 'attention' | 'not_started';
    blocking: boolean;
    explanation: string;
    evidence: BuildPacketEvidence[];
    /** Always present — every criterion is navigable. */
    actionTarget: BuildPacketActionTarget;
    blockerIds: string[];
    warningIds: string[];
}

export type BuildPacketStatus = 'complete' | 'incomplete';

export interface BuildPacketReadiness {
    /**
     * True only when NO criterion is blocking. Deliberately not named
     * `isReadyToBuild` — that field belongs to `PlanningReadiness` and means
     * something else.
     */
    isPacketComplete: boolean;
    status: BuildPacketStatus;
    headline: string;
    summary: string;
    criteria: BuildPacketCriterion[];
    blockers: BuildPacketBlocker[];
    warnings: BuildPacketWarning[];
    /** The first blocker in criterion order — §W7's single primary action. */
    nextBlocker?: BuildPacketBlocker;
    evaluatedAt: number;
}

// --- Input shape --------------------------------------------------------------

export interface BuildPacketArtifactState {
    nodeId: ArtifactSlotKey;
    /** Display title; defaults to the pipeline meta title. */
    title?: string;
    artifactId?: string;
    /** Preferred/current version id. Absent → this slot has no output. */
    versionId?: string;
    /** The slot's latest generation failed or was interrupted. */
    errored?: boolean;
    /**
     * `readArtifactValidationDisposition(version.metadata)` — read by the
     * caller, never re-derived here. `accepted_issue` carries the user's
     * recorded rationale and becomes a warning; `needs_review` blocks.
     */
    validation?: Pick<ArtifactValidationDisposition, 'blockers' | 'accepted' | 'effectiveStatus'>;
}

/**
 * Exactly the shape `evaluateProjectFreshness` / `useProjectFreshness` already
 * return. Passed through, never rebuilt: this module has no staleness logic of
 * its own.
 */
export interface BuildPacketFreshnessInput {
    evaluations: ReadonlyMap<DependencyNodeId, DependencyNodeEvaluation>;
    artifactIdBySlot?: Partial<Record<ArtifactSlotKey, string>>;
}

/**
 * The plan, declared structurally so both `ConsolidatedImplementationPlan`
 * (the adapter's render-time view model — the §W6 "plan adapter" source) and a
 * raw `StructuredImplementationPlan` are assignable without conversion.
 */
export interface BuildPacketPlanInput {
    milestones?: readonly ImplementationPlanMilestone[];
    globalQualityGates?: readonly ImplementationQualityGate[];
    definitionOfDone?: readonly string[];
    unassignedPromptPacks?: readonly ImplementationPromptPack[];
    securityPrivacy?: PlanSecurityPrivacySection;
    measurement?: PlanMeasurementSection;
}

/**
 * The CURRENT COMMITTED readiness checkpoint — already filtered by the caller
 * through `commitmentRemainsCurrent(...)` **and** an `activeCommit`. The live
 * `derivePlanningReadiness` projection is NOT accepted here; see
 * `planningProjectionReadyToBuild`.
 */
export interface BuildPacketCommittedReadiness {
    reviewId: string;
    /** The spine version the commitment binds to. */
    spineVersionId: string;
    conclusion: ReadinessReviewConclusion;
    committedAt: number;
    /**
     * The authorizing `commit_authorized` event's rationale. Required for a
     * `not_ready` commitment ("proceeding with accepted risk") to be
     * reportable as a warning instead of a blocker.
     */
    acceptedRiskRationale?: string;
}

export interface BuildPacketReadinessInput {
    prd?: StructuredPRD | null;
    /** One entry per required slot. A slot with no entry is treated as missing. */
    artifacts?: readonly BuildPacketArtifactState[];
    /** Override the required slot set (defaults to `buildPacketRequiredSlots()`). */
    requiredSlots?: readonly ArtifactSlotKey[];
    /** Freshness engine output. ABSENT → the currency criterion fails closed. */
    freshness?: BuildPacketFreshnessInput | null;
    /** Resolved Data Model content (entities/privacy → cross-cutting triggers). */
    dataModel?: DataModelContent | null;
    /**
     * Endpoint list for the API-contract criterion. Defaults to
     * `dataModel.apiEndpoints`; passed separately because a markdown-stored
     * data model parses its endpoints through a different resolver than its
     * entities.
     */
    apiEndpoints?: readonly ApiEndpointLike[] | null;
    plan?: BuildPacketPlanInput | null;
    safety?: CrossCuttingSafetyContext | null;
    committedReadiness?: BuildPacketCommittedReadiness | null;
    /**
     * The `isCommitmentUnverifiable` case: the spine claims commitment and
     * readiness provenance exists, but no current commitment can be verified.
     * FAIL CLOSED on it.
     */
    commitmentUnverifiable?: boolean;
    /**
     * ADVISORY ONLY. `derivePlanningReadiness().isReadyToBuild` — a projection
     * recomputed every render. It may at most inform the COPY of the
     * not-committed blocker (i.e. whether a commit action is being offered).
     * It can never satisfy the criterion; only a current committed
     * `ReadinessReview` can.
     */
    planningProjectionReadyToBuild?: boolean;
    /** The spine the packet is evaluated against; the commitment must bind to it. */
    currentSpineVersionId?: string;
    evaluatedAt?: number;
}

/**
 * The artifact slots a build packet requires: every user-visible core subtype
 * plus the mockups. Deliberately the same set `ProjectWorkspace.assetsReady`
 * gates on (`visibleCoreSubtypes()`), so the gate never demands an output the
 * generator does not produce (plan §7).
 */
export function buildPacketRequiredSlots(): ArtifactSlotKey[] {
    return [...visibleCoreSubtypes(), 'mockup'];
}

export const buildPacketSlotTitle = (slot: ArtifactSlotKey): string =>
    slot === 'mockup' ? 'Mockups' : getArtifactMeta(slot).title;

// --- Small helpers ------------------------------------------------------------

const hasText = (value: string | undefined | null): value is string =>
    typeof value === 'string' && value.trim().length > 0;

const textItems = (values: readonly (string | undefined)[] | undefined): string[] =>
    (values ?? []).filter(hasText).map(value => value.trim());

const normalize = (value: string): string =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const tokenSet = (value: string): Set<string> =>
    new Set(normalize(value).split(' ').filter(Boolean));

const truncate = (value: string, max = 110): string =>
    value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

const list = (values: readonly string[], max = 3): string => {
    const shown = values.slice(0, max);
    const rest = values.length - shown.length;
    return rest > 0 ? `${shown.join(', ')} (+${rest} more)` : shown.join(', ');
};

const plural = (count: number, singular: string, pluralForm = `${singular}s`): string =>
    `${count} ${count === 1 ? singular : pluralForm}`;

const evidenceId = (criterionId: BuildPacketCriterionId, sourceId: string, summary: string): string =>
    `build-packet-evidence-${hashReviewValue({ criterionId, sourceId, summary })}`;

const blockerId = (criterionId: BuildPacketCriterionId, kind: string, sourceId: string): string =>
    `build-packet-blocker-${hashReviewValue({ criterionId, kind, sourceId })}`;

const warningId = (criterionId: BuildPacketCriterionId, kind: string, sourceId: string): string =>
    `build-packet-warning-${hashReviewValue({ criterionId, kind, sourceId })}`;

// --- In-scope requirement resolution -----------------------------------------

/**
 * §W6's in-scope definition, in the codebase's own vocabulary (`Feature` never
 * carries P0/P1): `tier === 'mvp'` OR `priority === 'must'`, with a feature
 * that declares NEITHER field counted IN scope.
 */
export function isInScopeRequirement(feature: Pick<Feature, 'tier' | 'priority'>): boolean {
    if (feature.tier === 'mvp') return true;
    if (feature.priority === 'must') return true;
    return feature.tier === undefined && feature.priority === undefined;
}

export interface InScopeRequirementResolution {
    inScope: Feature[];
    /** should / could / v1 / later — coverage reported as a warning, never blocking. */
    outOfScope: Feature[];
    /**
     * True when no feature matched the rule and the whole feature set was used
     * instead — the same empty-set fallback `derivePlanningReadiness`'s
     * `scopeCandidates` applies, so the gate and the existing scope criterion
     * never disagree about which features matter (and "no in-scope
     * requirement" can never become a vacuous pass).
     */
    usedAllFeaturesFallback: boolean;
}

export function resolveInScopeRequirements(
    features: readonly Feature[],
): InScopeRequirementResolution {
    const inScope = features.filter(isInScopeRequirement);
    if (inScope.length === 0 && features.length > 0) {
        return { inScope: [...features], outOfScope: [], usedAllFeaturesFallback: true };
    }
    return {
        inScope,
        outOfScope: features.filter(feature => !isInScopeRequirement(feature)),
        usedAllFeaturesFallback: false,
    };
}

// --- Plan projection ----------------------------------------------------------

/**
 * A plan task, projected to exactly the fields this evaluator is allowed to
 * read. `task.status` is carried on the underlying `ImplementationPlanTask`
 * but is deliberately NOT projected and must not be consulted here: it is
 * self-reported progress, not evidence (see the §W8 rule in the module
 * header). If you need to know whether something is *verifiable*, look at the
 * verification texts on `PlanMilestoneEntry`, not at what someone ticked.
 */
interface PlanTaskEntry {
    task: ImplementationPlanTask;
    milestoneId: string;
    milestoneName: string;
    milestoneIndex: number;
    /** Explicit feature refs the generator was asked to emit. */
    featureRefs: string[];
    /** Task title + description, for the inferred (text) match tier. */
    text: string;
}

interface PlanMilestoneEntry {
    milestone: ImplementationPlanMilestone;
    index: number;
    tasks: PlanTaskEntry[];
    /** Definition of Done + quality gates + prompt-pack acceptance criteria. */
    verificationTexts: string[];
    /** Everything the milestone says, for text-tier matching. */
    text: string;
    dataModelNames: string[];
    apiNames: string[];
}

interface PlanProjection {
    milestones: PlanMilestoneEntry[];
    tasks: PlanTaskEntry[];
    taskIds: Set<string>;
    milestoneIds: Set<string>;
    /** Plan-wide verification surface (global gates + plan-level DoD). */
    globalVerificationTexts: string[];
    /** True when at least one task carries an explicit `linkedArtifacts.prd` ref. */
    hasExplicitRequirementRefs: boolean;
}

function projectPlan(plan: BuildPacketPlanInput | null | undefined): PlanProjection {
    const milestones: PlanMilestoneEntry[] = [];
    const tasks: PlanTaskEntry[] = [];
    const taskIds = new Set<string>();
    const milestoneIds = new Set<string>();
    let hasExplicitRequirementRefs = false;

    (plan?.milestones ?? []).forEach((milestone, index) => {
        if (!milestone) return;
        if (hasText(milestone.id)) milestoneIds.add(milestone.id.trim());
        const milestoneTasks: PlanTaskEntry[] = (milestone.tasks ?? []).map(task => {
            if (hasText(task?.id)) taskIds.add(task.id.trim());
            const featureRefs = textItems(task?.linkedArtifacts?.prd);
            if (featureRefs.length > 0) hasExplicitRequirementRefs = true;
            return {
                task,
                milestoneId: milestone.id,
                milestoneName: milestone.name,
                milestoneIndex: index,
                featureRefs,
                text: [task?.title, task?.description].filter(hasText).join(' '),
            };
        });
        const verificationTexts = [
            ...textItems(milestone.definitionOfDone),
            ...(milestone.qualityGates ?? []).flatMap(gate => textItems([gate?.title, gate?.description])),
            ...(milestone.promptPacks ?? []).flatMap(pack => textItems(pack?.acceptanceCriteria)),
        ];
        const text = [
            milestone.name,
            milestone.goal,
            milestone.objective,
            ...milestoneTasks.map(entry => entry.text),
            ...(milestone.promptPacks ?? []).flatMap(pack => [
                pack?.title,
                pack?.purpose,
                pack?.prompt,
                ...(pack?.scope?.include ?? []),
            ]),
            ...verificationTexts,
            ...textItems(milestone.validationCommands),
            ...textItems(milestone.linkedArtifacts?.screens),
            ...textItems(milestone.linkedArtifacts?.dataModels),
            ...textItems(milestone.linkedArtifacts?.apis),
            ...textItems(milestone.linkedArtifacts?.userFlows),
            ...milestoneTasks.flatMap(entry => textItems(entry.task?.linkedArtifacts?.dataModel)),
        ].filter(hasText).join(' \n ');

        milestones.push({
            milestone,
            index,
            tasks: milestoneTasks,
            verificationTexts,
            text,
            dataModelNames: [
                ...textItems(milestone.linkedArtifacts?.dataModels),
                ...milestoneTasks.flatMap(entry => textItems(entry.task?.linkedArtifacts?.dataModel)),
            ].map(normalize).filter(Boolean),
            apiNames: textItems(milestone.linkedArtifacts?.apis).map(normalize).filter(Boolean),
        });
        tasks.push(...milestoneTasks);
    });

    return {
        milestones,
        tasks,
        taskIds,
        milestoneIds,
        globalVerificationTexts: [
            ...(plan?.globalQualityGates ?? []).flatMap(gate => textItems([gate?.title, gate?.description])),
            ...textItems(plan?.definitionOfDone),
        ],
        hasExplicitRequirementRefs,
    };
}

// --- Requirement ↔ plan matching ---------------------------------------------

/** Does one explicit ref (`linkedArtifacts.prd` entry) denote this feature? */
function refDenotesFeature(ref: string, feature: Feature): boolean {
    const refTokens = tokenSet(ref);
    if (refTokens.has(normalize(feature.id))) return true;
    const name = normalize(feature.name);
    if (!name) return false;
    const refText = normalize(ref);
    return refText === name || refText.includes(name) || name.includes(refText);
}

/** Weaker tier: the feature's id token or full name appears in free text. */
function textDenotesFeature(text: string, feature: Feature): boolean {
    if (!hasText(text)) return false;
    const normalized = normalize(text);
    if (tokenSet(text).has(normalize(feature.id))) return true;
    const name = normalize(feature.name);
    return name.length >= 3 && normalized.includes(name);
}

type CoverageConfidence = 'explicit' | 'inferred';

interface RequirementCoverage {
    feature: Feature;
    confidence?: CoverageConfidence;
    coveringTasks: PlanTaskEntry[];
    /** Milestones whose tasks cover this requirement. */
    coveringMilestones: PlanMilestoneEntry[];
    /** Verification texts available on those milestones (+ plan-wide surface). */
    verificationTexts: string[];
    /** Canonical criterion ids of this requirement traced into the packet. */
    tracedCriterionIds: string[];
}

function coverRequirement(
    feature: Feature,
    projection: PlanProjection,
    tracedByRequirement: ReadonlyMap<RequirementId, Set<string>>,
): RequirementCoverage {
    const explicit = projection.tasks.filter(entry =>
        entry.featureRefs.some(ref => refDenotesFeature(ref, feature)),
    );
    const inferred = explicit.length > 0
        ? []
        : projection.tasks.filter(entry => (
            textDenotesFeature(entry.text, feature)
            || textDenotesFeature(entry.milestoneName, feature)
        ));
    const coveringTasks = explicit.length > 0 ? explicit : inferred;
    const milestoneIndexes = new Set(coveringTasks.map(entry => entry.milestoneIndex));
    const coveringMilestones = projection.milestones.filter(entry => milestoneIndexes.has(entry.index));
    return {
        feature,
        confidence: explicit.length > 0 ? 'explicit' : inferred.length > 0 ? 'inferred' : undefined,
        coveringTasks,
        coveringMilestones,
        verificationTexts: [
            ...coveringMilestones.flatMap(entry => entry.verificationTexts),
            ...projection.globalVerificationTexts,
        ],
        tracedCriterionIds: [...(tracedByRequirement.get(feature.id) ?? [])],
    };
}

/**
 * Resolve every verification line in the packet back to canonical criterion
 * ids (W1). Advisory: a criterion the packet never quotes is reported as "not
 * traced", never auto-rewritten and never counted as absent from the PRD.
 */
function traceCriteria(
    index: RequirementIndex,
    projection: PlanProjection,
): Map<RequirementId, Set<string>> {
    const byRequirement = new Map<RequirementId, Set<string>>();
    if (index.criteria.length === 0) return byRequirement;
    const texts = [
        ...projection.milestones.flatMap(entry => entry.verificationTexts),
        ...projection.globalVerificationTexts,
    ];
    for (const text of texts) {
        const resolved = resolveCriterionRefs(text, index);
        if (resolved.confidence === 'unmatched' || !resolved.id) continue;
        const bucket = byRequirement.get(resolved.requirementId);
        if (bucket) bucket.add(resolved.id);
        else byRequirement.set(resolved.requirementId, new Set([resolved.id]));
    }
    return byRequirement;
}

// --- First-slice endpoint reachability ---------------------------------------

/**
 * Is this endpoint reachable from the FIRST slice? Three deliberate tiers, all
 * derived from what the generator was actually asked to emit:
 *   1. the endpoint's `requirementIds` intersect the requirements the first
 *      milestone's tasks implement,
 *   2. the endpoint's entity is one the first milestone links (milestone
 *      `linkedArtifacts.dataModels` or a task's `linkedArtifacts.dataModel`),
 *   3. the endpoint's path (or method+path) appears in the milestone's text or
 *      its `linkedArtifacts.apis`.
 * No signal at all → NOT reachable, and the criterion says so out loud rather
 * than gating endpoints it cannot tie to the first slice.
 */
function endpointReachableFromFirstSlice(
    endpoint: ApiEndpointLike,
    firstSlice: PlanMilestoneEntry | undefined,
    firstSliceRequirementIds: ReadonlySet<RequirementId>,
): boolean {
    if (!firstSlice) return false;
    const requirementIds = textItems(endpoint.requirementIds);
    if (requirementIds.some(id => firstSliceRequirementIds.has(id.trim()))) return true;
    const entity = normalize(endpoint.entity ?? '');
    if (entity && firstSlice.dataModelNames.some(name => name === entity || name.includes(entity))) {
        return true;
    }
    const path = normalize(endpoint.path ?? '');
    if (!path) return false;
    const sliceText = normalize(firstSlice.text);
    if (sliceText.includes(path)) return true;
    return firstSlice.apiNames.some(name => name.includes(path) || path.includes(name));
}

const CONTRACT_FIELD_LABELS: Record<ContractFieldName, string> = {
    'auth.authentication': 'authentication',
    'auth.authorization': 'authorization',
    requestSchema: 'request schema',
    responseSchema: 'response schema',
    errors: 'error cases',
    pagination: 'pagination',
    idempotency: 'idempotency',
    rateLimit: 'rate limit',
    requirementIds: 'requirement ids',
    tests: 'tests',
};

const fieldLabels = (fields: readonly ContractFieldName[]): string =>
    fields.map(field => CONTRACT_FIELD_LABELS[field]).join(', ');

// --- Internal collector -------------------------------------------------------

interface Collector {
    blockers: BuildPacketBlocker[];
    warnings: BuildPacketWarning[];
}

function addBlocker(
    collector: Collector,
    criterionId: BuildPacketCriterionId,
    kind: string,
    sourceId: string,
    blocker: Omit<BuildPacketBlocker, 'id' | 'criterionId'>,
): string {
    const id = blockerId(criterionId, kind, sourceId);
    if (!collector.blockers.some(item => item.id === id)) {
        collector.blockers.push({ id, criterionId, ...blocker });
    }
    return id;
}

function addWarning(
    collector: Collector,
    criterionId: BuildPacketCriterionId,
    kind: string,
    sourceId: string,
    warning: Omit<BuildPacketWarning, 'id' | 'criterionId'>,
): string {
    const id = warningId(criterionId, kind, sourceId);
    if (!collector.warnings.some(item => item.id === id)) {
        collector.warnings.push({ id, criterionId, ...warning });
    }
    return id;
}

/** Fallback evidence source per criterion, so the "every criterion carries
 * evidence" invariant holds even when a criterion had nothing concrete to cite. */
const CRITERION_EVIDENCE_SOURCE: Record<BuildPacketCriterionId, BuildPacketEvidenceSourceType> = {
    artifacts_present: 'artifact',
    sources_current: 'freshness',
    validation_clear: 'validation',
    requirement_coverage: 'prd',
    api_contract: 'data_model',
    cross_cutting: 'plan',
    first_slice: 'plan',
    reasoning_committed: 'commitment',
};

const makeEvidence = (
    criterionId: BuildPacketCriterionId,
    quality: ReadinessCriterionEvidenceQuality,
    summary: string,
    sourceType: BuildPacketEvidenceSourceType,
    sourceId: string,
    sourceVersionId?: string,
): BuildPacketEvidence => ({
    id: evidenceId(criterionId, sourceId, summary),
    quality,
    summary,
    sourceType,
    sourceId,
    sourceVersionId,
});

// --- Main entry ---------------------------------------------------------------

/**
 * THE build-packet evaluator. Reports, per §W6 criterion, whether the
 * implementation packet is complete and current — with evidence, a navigable
 * action target, an itemised blocker list, and earned (owner/impact/rationale)
 * non-blocking warnings.
 *
 * This never answers "is the product reasoning sound?" — call
 * `derivePlanningReadiness` for that, and keep the two states separately
 * visible.
 */
export function deriveBuildPacketReadiness(
    input: BuildPacketReadinessInput,
): BuildPacketReadiness {
    const evaluatedAt = input.evaluatedAt ?? Date.now();
    const collector: Collector = { blockers: [], warnings: [] };
    const criteria: BuildPacketCriterion[] = [];

    const requiredSlots = [...(input.requiredSlots ?? buildPacketRequiredSlots())];
    const artifactBySlot = new Map(
        (input.artifacts ?? []).map(state => [state.nodeId, state] as const),
    );
    const freshness = input.freshness ?? undefined;
    const evaluationFor = (slot: ArtifactSlotKey): DependencyNodeEvaluation | undefined =>
        freshness?.evaluations.get(slot);
    const artifactIdFor = (slot: ArtifactSlotKey): string | undefined =>
        artifactBySlot.get(slot)?.artifactId ?? freshness?.artifactIdBySlot?.[slot];
    const slotTarget = (
        slot: ArtifactSlotKey,
        extra: { section?: BuildPacketArtifactSection; milestoneId?: string } = {},
    ): BuildPacketActionTarget => ({
        kind: 'artifact_slot',
        nodeId: slot,
        artifactId: artifactIdFor(slot),
        ...extra,
    });
    const titleFor = (slot: ArtifactSlotKey): string =>
        artifactBySlot.get(slot)?.title ?? buildPacketSlotTitle(slot);

    // ── 1. Required artifacts exist and are non-errored ────────────────────
    // Source: artifact slots (the caller's per-slot state) UNIONED with the
    // freshness engine's `missing` / `error` / `generating` statuses, so a
    // disagreement fails closed instead of passing.
    const missingSlots: ArtifactSlotKey[] = [];
    const erroredSlots: ArtifactSlotKey[] = [];
    const generatingSlots: ArtifactSlotKey[] = [];
    const presentSlots: ArtifactSlotKey[] = [];
    for (const slot of requiredSlots) {
        const state = artifactBySlot.get(slot);
        const evaluation = evaluationFor(slot);
        const present = hasText(state?.versionId)
            || (evaluation !== undefined && evaluation.status !== 'missing');
        const errored = state?.errored === true || evaluation?.status === 'error';
        if (!present) missingSlots.push(slot);
        else if (errored) erroredSlots.push(slot);
        else if (evaluation?.status === 'generating') generatingSlots.push(slot);
        else presentSlots.push(slot);
    }
    const presenceBlockerIds: string[] = [];
    for (const slot of missingSlots) {
        presenceBlockerIds.push(addBlocker(collector, 'artifacts_present', 'missing', slot, {
            title: `${titleFor(slot)} has not been generated`,
            consequence: 'The packet is missing an output the build depends on, so part of the product has no specification at all.',
            remedy: `Generate ${titleFor(slot)} from the outputs workspace.`,
            evidenceQuality: 'incomplete',
            actionTarget: slotTarget(slot),
        }));
    }
    for (const slot of erroredSlots) {
        presenceBlockerIds.push(addBlocker(collector, 'artifacts_present', 'errored', slot, {
            title: `${titleFor(slot)} failed to generate`,
            consequence: 'An errored output cannot be implemented against, and anything generated from it inherits the gap.',
            remedy: `Retry ${titleFor(slot)} from the outputs workspace.`,
            evidenceQuality: 'direct',
            actionTarget: slotTarget(slot),
        }));
    }
    for (const slot of generatingSlots) {
        presenceBlockerIds.push(addBlocker(collector, 'artifacts_present', 'generating', slot, {
            title: `${titleFor(slot)} is still generating`,
            consequence: 'The packet cannot be assessed as complete while an output is still being written.',
            remedy: 'Wait for generation to finish, then re-check the packet.',
            evidenceQuality: 'direct',
            actionTarget: slotTarget(slot),
        }));
    }
    criteria.push({
        id: 'artifacts_present',
        label: BUILD_PACKET_CRITERION_LABELS.artifacts_present,
        status: presenceBlockerIds.length > 0
            ? (presentSlots.length === 0 ? 'not_started' : 'attention')
            : 'met',
        blocking: presenceBlockerIds.length > 0,
        explanation: presenceBlockerIds.length === 0
            ? `All ${plural(requiredSlots.length, 'required output')} exist and none is in an error state.`
            : [
                missingSlots.length > 0 ? `${plural(missingSlots.length, 'output')} not generated` : '',
                erroredSlots.length > 0 ? `${plural(erroredSlots.length, 'output')} errored` : '',
                generatingSlots.length > 0 ? `${plural(generatingSlots.length, 'output')} still generating` : '',
            ].filter(Boolean).join(', ') + '.',
        evidence: [
            ...presentSlots.map(slot => makeEvidence(
                'artifacts_present', 'direct', `${titleFor(slot)} has a generated version.`,
                'artifact', slot, artifactBySlot.get(slot)?.versionId,
            )),
            ...missingSlots.map(slot => makeEvidence(
                'artifacts_present', 'incomplete', `${titleFor(slot)} has no generated version.`,
                'artifact', slot,
            )),
            ...erroredSlots.map(slot => makeEvidence(
                'artifacts_present', 'direct', `${titleFor(slot)} is in an error state.`,
                'artifact', slot, artifactBySlot.get(slot)?.versionId,
            )),
        ],
        actionTarget: slotTarget(
            missingSlots[0] ?? erroredSlots[0] ?? generatingSlots[0] ?? requiredSlots[0] ?? 'implementation_plan',
        ),
        blockerIds: presenceBlockerIds,
        warningIds: [],
    });

    // ── 2. No required source is stale OR missing ──────────────────────────
    // Source: the ONE freshness engine — `status` AND `impactedBy`. Consumed,
    // never re-derived (cross-cutting rule 9). Reading `impactedBy` is what
    // catches a dependent that reads `up_to_date` while an upstream is missing
    // or errored (see plan §W2 — do NOT "fix" that in the engine).
    const currencyBlockerIds: string[] = [];
    const currencyWarningIds: string[] = [];
    const currencyEvidence: BuildPacketEvidence[] = [];
    if (!freshness) {
        currencyBlockerIds.push(addBlocker(collector, 'sources_current', 'unverifiable', 'freshness', {
            title: 'Output currency could not be verified',
            consequence: 'Without a freshness evaluation Synapse cannot tell whether these outputs still describe the current plan, so the packet cannot be reported as current.',
            remedy: 'Open the Project Map (Dependency Graph) to evaluate output currency.',
            evidenceQuality: 'incomplete',
            actionTarget: slotTarget('implementation_plan'),
        }));
        currencyEvidence.push(makeEvidence(
            'sources_current', 'incomplete',
            'No freshness evaluation was supplied to the build-packet evaluator.',
            'freshness', 'missing',
        ));
    } else {
        // Currency is only a meaningful claim about an output that exists.
        // A missing / errored / still-generating slot is already reported by the
        // presence criterion; re-reporting it here would double-count it.
        const notYetPresent = new Set<ArtifactSlotKey>([
            ...missingSlots, ...erroredSlots, ...generatingSlots,
        ]);
        for (const slot of requiredSlots) {
            const evaluation = evaluationFor(slot);
            if (!evaluation || notYetPresent.has(slot)) continue;
            if (isStaleStatus(evaluation.status)) {
                const reason = evaluation.reasons[0]?.detail;
                currencyBlockerIds.push(addBlocker(collector, 'sources_current', 'stale', slot, {
                    title: `${titleFor(slot)} is out of date`,
                    consequence: reason
                        ? `The packet would be built from an output that no longer matches its inputs — ${truncate(reason)}`
                        : 'The packet would be built from an output that no longer matches its inputs.',
                    remedy: `Regenerate ${titleFor(slot)} — or mark it current — from Sync outputs.`,
                    evidenceQuality: evaluation.status === 'needs_update' ? 'direct' : 'inferred',
                    actionTarget: slotTarget(slot),
                }));
                currencyEvidence.push(makeEvidence(
                    'sources_current', 'incomplete',
                    `${titleFor(slot)}: ${evaluation.status}${reason ? ` — ${truncate(reason)}` : ''}`,
                    'freshness', slot,
                ));
                continue;
            }
            // An up-to-date node whose ancestor is missing/errored/stale. The
            // engine records that ONLY here, never in `status`.
            if (evaluation.impactedBy.length > 0) {
                const upstream = evaluation.impactedBy.map(id => (
                    id === 'prd' ? 'PRD' : buildPacketSlotTitle(id as ArtifactSlotKey)
                ));
                currencyBlockerIds.push(addBlocker(collector, 'sources_current', 'impacted', slot, {
                    title: `${titleFor(slot)} depends on an input that is not sound`,
                    consequence: `${titleFor(slot)} reads as up to date, but ${list(upstream)} ${upstream.length === 1 ? 'is' : 'are'} missing, errored, or stale — so what it says about ${upstream.length === 1 ? 'that input' : 'those inputs'} was never derived from a trustworthy source.`,
                    remedy: `Resolve ${list(upstream)} first, then re-check ${titleFor(slot)}.`,
                    evidenceQuality: 'direct',
                    actionTarget: slotTarget(evaluation.impactedBy[0] === 'prd'
                        ? slot
                        : evaluation.impactedBy[0] as ArtifactSlotKey),
                }));
                currencyEvidence.push(makeEvidence(
                    'sources_current', 'direct',
                    `${titleFor(slot)} is impacted by ${list(upstream)}.`,
                    'freshness', `${slot}:impacted`,
                ));
                continue;
            }
            if (evaluation.manuallyEdited) {
                currencyWarningIds.push(addWarning(collector, 'sources_current', 'manual_edit', slot, {
                    title: `${titleFor(slot)} carries manual edits`,
                    owner: 'user',
                    impact: 'A regeneration appends a new version rather than overwriting this one, so the manual wording can silently stop being the version a build reads.',
                    rationale: 'The freshness engine records the latest version as a user edit; user authorship is preserved, not overridden, so this is reported rather than blocked.',
                    actionTarget: slotTarget(slot),
                }));
            }
            currencyEvidence.push(makeEvidence(
                'sources_current', 'direct',
                `${titleFor(slot)} is current and no upstream input is in trouble.`,
                'freshness', slot,
            ));
        }
    }
    criteria.push({
        id: 'sources_current',
        label: BUILD_PACKET_CRITERION_LABELS.sources_current,
        status: currencyBlockerIds.length > 0 ? 'attention' : freshness ? 'met' : 'not_started',
        blocking: currencyBlockerIds.length > 0,
        explanation: !freshness
            ? 'Output currency could not be evaluated, so it cannot be claimed.'
            : currencyBlockerIds.length === 0
                ? 'Every required output is current, and none depends on a missing, errored, or stale input.'
                : `${plural(currencyBlockerIds.length, 'output')} ${currencyBlockerIds.length === 1 ? 'is' : 'are'} stale or built on an input that is not sound.`,
        evidence: currencyEvidence,
        actionTarget: slotTarget('implementation_plan'),
        blockerIds: currencyBlockerIds,
        warningIds: currencyWarningIds,
    });

    // ── 3. Zero unresolved blocking validation issues ──────────────────────
    // Source: `artifactBlockingValidation` / `artifactValidationPolicy` (the
    // per-version disposition the caller read), unioned with the freshness
    // engine's `needs_review`. A user-ACCEPTED issue carries a recorded
    // rationale, which is exactly what makes it reportable as a warning rather
    // than a blocker. API-contract completeness has its own criterion below so
    // the same W3 source never blocks twice.
    const validationBlockerIds: string[] = [];
    const validationWarningIds: string[] = [];
    const validationEvidence: BuildPacketEvidence[] = [];
    for (const slot of requiredSlots) {
        const state = artifactBySlot.get(slot);
        const evaluation = evaluationFor(slot);
        const disposition = state?.validation;
        const blockers: ArtifactValidationBlocker[] = disposition?.blockers ?? [];
        const unresolved = disposition?.effectiveStatus === 'needs_review'
            || (evaluation?.status === 'needs_review' && disposition?.effectiveStatus !== 'accepted_issue');
        if (unresolved) {
            const detail = blockers.length > 0
                ? blockers.map(item => item.message).join(' ')
                : 'The generated output failed blocking validation.';
            validationBlockerIds.push(addBlocker(collector, 'validation_clear', 'needs_review', slot, {
                title: `${titleFor(slot)} failed blocking validation`,
                consequence: `${truncate(detail, 160)} An output in this state is not a trustworthy implementation input.`,
                remedy: `Open ${titleFor(slot)} and regenerate it, or record why the issue is acceptable.`,
                evidenceQuality: 'direct',
                actionTarget: slotTarget(slot),
            }));
            validationEvidence.push(makeEvidence(
                'validation_clear', 'incomplete', `${titleFor(slot)}: ${truncate(detail, 160)}`,
                'validation', slot, state?.versionId,
            ));
            continue;
        }
        if (disposition?.effectiveStatus === 'accepted_issue' && disposition.accepted) {
            validationWarningIds.push(addWarning(collector, 'validation_clear', 'accepted_issue', slot, {
                title: `${titleFor(slot)} ships with an accepted validation issue`,
                owner: 'user',
                impact: blockers.length > 0
                    ? `The build inherits a known defect in this output: ${truncate(blockers.map(item => item.message).join(' '), 160)}`
                    : 'The build inherits a known validation defect in this output.',
                rationale: disposition.accepted.rationale,
                actionTarget: slotTarget(slot),
            }));
            validationEvidence.push(makeEvidence(
                'validation_clear', 'direct',
                `${titleFor(slot)}: issue accepted by the user — ${truncate(disposition.accepted.rationale, 140)}`,
                'validation', slot, state?.versionId,
            ));
            continue;
        }
        if (state?.versionId || evaluation) {
            validationEvidence.push(makeEvidence(
                'validation_clear', 'direct', `${titleFor(slot)} has no unresolved blocking validation issue.`,
                'validation', slot, state?.versionId,
            ));
        }
    }
    criteria.push({
        id: 'validation_clear',
        label: BUILD_PACKET_CRITERION_LABELS.validation_clear,
        status: validationBlockerIds.length > 0
            ? 'attention'
            : validationEvidence.length === 0 ? 'not_started' : 'met',
        blocking: validationBlockerIds.length > 0,
        explanation: validationBlockerIds.length === 0
            ? validationWarningIds.length > 0
                ? 'No unresolved blocking validation issue remains; some issues were explicitly accepted by the user.'
                : 'No output carries an unresolved blocking validation issue.'
            : `${plural(validationBlockerIds.length, 'output')} ${validationBlockerIds.length === 1 ? 'has' : 'have'} an unresolved blocking validation issue.`,
        evidence: validationEvidence,
        actionTarget: slotTarget('data_model'),
        blockerIds: validationBlockerIds,
        warningIds: validationWarningIds,
    });

    // ── 4. Every in-scope requirement maps to a task and a criterion ───────
    // Source: W1 requirement identity + coverage over the plan adapter's
    // milestones/tasks. In-scope = tier 'mvp' OR priority 'must', with a
    // feature declaring neither counted in scope (see
    // `resolveInScopeRequirements`).
    const features = input.prd?.features ?? [];
    const scope = resolveInScopeRequirements(features);
    const requirementIndex = buildRequirementIndex({ features });
    const projection = projectPlan(input.plan);
    const tracedByRequirement = traceCriteria(requirementIndex, projection);
    const coverageBlockerIds: string[] = [];
    const coverageWarningIds: string[] = [];
    const coverageEvidence: BuildPacketEvidence[] = [];
    const inScopeCoverage = scope.inScope.map(feature =>
        coverRequirement(feature, projection, tracedByRequirement));

    if (features.length === 0) {
        coverageBlockerIds.push(addBlocker(collector, 'requirement_coverage', 'no_features', 'prd', {
            title: 'The plan declares no features',
            consequence: 'With no requirements there is nothing for the packet to trace to, so coverage cannot be claimed.',
            remedy: 'Define the feature scope in the PRD, then re-check the packet.',
            evidenceQuality: 'incomplete',
            actionTarget: { kind: 'feature' },
        }));
    } else if (projection.milestones.length === 0) {
        coverageBlockerIds.push(addBlocker(collector, 'requirement_coverage', 'no_plan', 'implementation_plan', {
            title: 'Requirement coverage cannot be verified',
            consequence: 'The Implementation Plan carries no milestones or tasks, so no requirement maps to build work.',
            remedy: 'Generate the Implementation Plan, then re-check coverage.',
            evidenceQuality: 'incomplete',
            actionTarget: slotTarget('implementation_plan', { section: 'coverage' }),
        }));
    } else {
        for (const coverage of inScopeCoverage) {
            const { feature } = coverage;
            const declaredCriteria = requirementIndex.requirements
                .find(entry => entry.id === feature.id)?.criteria ?? [];
            if (coverage.coveringTasks.length === 0) {
                coverageBlockerIds.push(addBlocker(collector, 'requirement_coverage', 'no_task', feature.id, {
                    title: `"${feature.name}" is not implemented by any task`,
                    consequence: 'An in-scope requirement with no task will not be built, and nothing in the packet reveals the omission.',
                    remedy: 'Regenerate the Implementation Plan, or narrow the scope so this requirement is not first-release.',
                    evidenceQuality: 'incomplete',
                    actionTarget: slotTarget('implementation_plan', { section: 'coverage' }),
                }));
                continue;
            }
            if (declaredCriteria.length === 0) {
                coverageBlockerIds.push(addBlocker(collector, 'requirement_coverage', 'no_criterion', feature.id, {
                    title: `"${feature.name}" declares no acceptance criterion`,
                    consequence: 'A requirement with no acceptance criterion cannot be verified as built — the task can be marked implemented with nothing to check it against.',
                    remedy: 'Add acceptance criteria to this feature in the PRD.',
                    evidenceQuality: 'incomplete',
                    actionTarget: { kind: 'feature', featureId: feature.id },
                }));
                continue;
            }
            if (coverage.verificationTexts.length === 0) {
                coverageBlockerIds.push(addBlocker(collector, 'requirement_coverage', 'no_verification', feature.id, {
                    title: `Nothing in the packet verifies "${feature.name}"`,
                    consequence: `The ${plural(coverage.coveringTasks.length, 'task')} implementing this requirement carry no definition of done, quality gate, or acceptance criterion, so "built" cannot be checked.`,
                    remedy: 'Regenerate the Implementation Plan so its milestones carry a definition of done and quality gates.',
                    evidenceQuality: 'incomplete',
                    actionTarget: slotTarget('implementation_plan', {
                        section: 'coverage',
                        milestoneId: coverage.coveringMilestones[0]?.milestone.id,
                    }),
                }));
                continue;
            }
            if (coverage.tracedCriterionIds.length === 0) {
                coverageWarningIds.push(addWarning(collector, 'requirement_coverage', 'untraced_criteria', feature.id, {
                    title: `"${feature.name}" acceptance criteria are not traced into the packet`,
                    owner: 'synapse',
                    impact: `The ${plural(declaredCriteria.length, 'PRD criterion', 'PRD criteria')} for this requirement could not be matched to any definition of done, quality gate, or prompt-pack criterion, so criterion-level traceability is estimated rather than shown.`,
                    rationale: 'The generator is asked for milestone-level acceptance criteria, not for verbatim restatements of PRD criteria, so an unmatched criterion is a traceability gap — not proof the requirement is unverified. Reported as derived, never auto-rewritten.',
                    actionTarget: slotTarget('implementation_plan', {
                        section: 'coverage',
                        milestoneId: coverage.coveringMilestones[0]?.milestone.id,
                    }),
                }));
            }
            coverageEvidence.push(makeEvidence(
                'requirement_coverage',
                coverage.confidence === 'explicit' ? 'direct' : 'inferred',
                `"${feature.name}" → ${plural(coverage.coveringTasks.length, 'task')} (${coverage.confidence === 'explicit' ? 'linked by the plan' : 'matched by name — derived'}), ${plural(coverage.verificationTexts.length, 'verification check')}, ${plural(coverage.tracedCriterionIds.length, 'traced criterion', 'traced criteria')}.`,
                'plan', feature.id,
            ));
        }
        for (const feature of scope.outOfScope) {
            const coverage = coverRequirement(feature, projection, tracedByRequirement);
            if (coverage.coveringTasks.length > 0) continue;
            coverageWarningIds.push(addWarning(collector, 'requirement_coverage', 'out_of_scope', feature.id, {
                title: `"${feature.name}" is not implemented by any task`,
                owner: 'user',
                impact: 'This requirement will not be built in the first release.',
                rationale: `It is out of the blocking scope (${feature.tier ? `tier ${feature.tier}` : ''}${feature.tier && feature.priority ? ', ' : ''}${feature.priority ? `priority ${feature.priority}` : ''}), so coverage is reported rather than required.`,
                actionTarget: { kind: 'feature', featureId: feature.id },
            }));
        }
    }
    if (scope.usedAllFeaturesFallback) {
        coverageEvidence.push(makeEvidence(
            'requirement_coverage', 'inferred',
            'No feature declares an MVP tier or a "must" priority, so every feature is treated as in scope — the same fallback the planning scope criterion applies.',
            'prd', 'scope:fallback',
        ));
    }
    criteria.push({
        id: 'requirement_coverage',
        label: BUILD_PACKET_CRITERION_LABELS.requirement_coverage,
        status: coverageBlockerIds.length > 0
            ? (projection.milestones.length === 0 || features.length === 0 ? 'not_started' : 'attention')
            : 'met',
        blocking: coverageBlockerIds.length > 0,
        explanation: coverageBlockerIds.length === 0
            ? `All ${plural(scope.inScope.length, 'in-scope requirement')} map to a task and to a verification check.`
            : `${plural(coverageBlockerIds.length, 'in-scope requirement')} ${coverageBlockerIds.length === 1 ? 'is' : 'are'} not fully covered by the packet.`,
        evidence: coverageEvidence,
        actionTarget: slotTarget('implementation_plan', { section: 'coverage' }),
        blockerIds: coverageBlockerIds,
        warningIds: coverageWarningIds,
    });

    // ── 5. Every endpoint reachable from the first slice has a contract ────
    // Source: W3 `evaluateEndpointContract` (the field set is NOT re-derived
    // here) + the first milestone from the plan adapter.
    const endpoints: readonly ApiEndpointLike[] =
        input.apiEndpoints ?? input.dataModel?.apiEndpoints ?? [];
    const firstSlice = projection.milestones[0];
    const firstSliceRequirementIds = new Set<RequirementId>(
        firstSlice
            ? features
                .filter(feature => firstSlice.tasks.some(entry => (
                    entry.featureRefs.some(ref => refDenotesFeature(ref, feature))
                    || textDenotesFeature(entry.text, feature)
                )))
                .map(feature => feature.id)
            : [],
    );
    const apiBlockerIds: string[] = [];
    const apiWarningIds: string[] = [];
    const apiEvidence: BuildPacketEvidence[] = [];
    const dataModelPresent = !!input.dataModel || (input.apiEndpoints?.length ?? 0) > 0;
    if (!firstSlice) {
        apiBlockerIds.push(addBlocker(collector, 'api_contract', 'no_first_slice', 'implementation_plan', {
            title: 'First-slice API contracts cannot be verified',
            consequence: 'Without a first milestone there is no way to tell which endpoints the first slice needs, so their contracts cannot be checked.',
            remedy: 'Generate the Implementation Plan, then re-check the API contracts.',
            evidenceQuality: 'incomplete',
            actionTarget: slotTarget('implementation_plan', { section: 'first_milestone' }),
        }));
    } else if (endpoints.length === 0 && dataModelPresent) {
        apiBlockerIds.push(addBlocker(collector, 'api_contract', 'no_endpoints', 'data_model', {
            title: 'The data model declares no API endpoints',
            consequence: 'The first slice has to talk to something; with no endpoint contract the API surface is invented during implementation.',
            remedy: 'Regenerate the Data Model so it emits an API surface.',
            evidenceQuality: 'incomplete',
            actionTarget: slotTarget('data_model', { section: 'api_contract' }),
        }));
    } else {
        const scored = endpoints.map(endpoint => ({
            endpoint,
            completeness: evaluateEndpointContract(endpoint),
            reachable: endpointReachableFromFirstSlice(endpoint, firstSlice, firstSliceRequirementIds),
        }));
        const reachable = scored.filter(item => item.reachable);
        for (const item of reachable) {
            if (item.completeness.missingCoreFields.length > 0) {
                apiBlockerIds.push(addBlocker(collector, 'api_contract', 'incomplete', item.completeness.key, {
                    title: `${item.completeness.key} has an incomplete contract`,
                    consequence: `The first slice calls this endpoint, but its contract is missing ${fieldLabels(item.completeness.missingCoreFields)} — an implementer has to guess.`,
                    remedy: 'Regenerate the Data Model so this endpoint carries auth, request/response shapes, and error cases.',
                    evidenceQuality: item.completeness.status === 'stub' ? 'incomplete' : 'direct',
                    actionTarget: slotTarget('data_model', { section: 'api_contract' }),
                }));
                continue;
            }
            if (item.completeness.missingFields.length > 0) {
                apiWarningIds.push(addWarning(collector, 'api_contract', 'supplementary', item.completeness.key, {
                    title: `${item.completeness.key} omits ${fieldLabels(item.completeness.missingFields)}`,
                    owner: 'user',
                    impact: 'The endpoint is implementable, but pagination/idempotency/limit/test detail is left to the implementer.',
                    rationale: 'Only the implementability fields (auth, request, response, errors) block; the rest are supplementary by the W3 completeness contract.',
                    actionTarget: slotTarget('data_model', { section: 'api_contract' }),
                }));
            }
            apiEvidence.push(makeEvidence(
                'api_contract', 'direct',
                `${item.completeness.key}: contract ${item.completeness.status} for the first slice.`,
                'data_model', item.completeness.key,
            ));
        }
        const unreachableIncomplete = scored.filter(item =>
            !item.reachable && item.completeness.missingCoreFields.length > 0);
        if (reachable.length === 0 && endpoints.length > 0) {
            apiWarningIds.push(addWarning(collector, 'api_contract', 'no_reachable', 'first_slice', {
                title: 'No endpoint could be tied to the first slice',
                owner: 'synapse',
                impact: `Endpoint contracts were NOT gated for this packet, so ${plural(endpoints.length, 'endpoint')} could be incomplete without blocking.`,
                rationale: `The first milestone ("${firstSlice.milestone.name}") names no requirement, entity, or path that matches an endpoint, so reachability is unknown — the gate reports that rather than blocking endpoints it cannot tie to the slice.`,
                actionTarget: slotTarget('data_model', { section: 'api_contract' }),
            }));
        }
        for (const item of unreachableIncomplete) {
            apiWarningIds.push(addWarning(collector, 'api_contract', 'later_slice', item.completeness.key, {
                title: `${item.completeness.key} has an incomplete contract`,
                owner: 'user',
                impact: `Missing ${fieldLabels(item.completeness.missingCoreFields)}; a later milestone will need this filled in before it can be built.`,
                rationale: 'This endpoint is not reachable from the first slice, so it is reported rather than blocking (only the first slice must be implementable now).',
                actionTarget: slotTarget('data_model', { section: 'api_contract' }),
            }));
        }
    }
    criteria.push({
        id: 'api_contract',
        label: BUILD_PACKET_CRITERION_LABELS.api_contract,
        status: apiBlockerIds.length > 0
            ? (firstSlice ? 'attention' : 'not_started')
            : endpoints.length === 0 ? 'not_started' : 'met',
        blocking: apiBlockerIds.length > 0,
        explanation: apiBlockerIds.length > 0
            ? `${plural(apiBlockerIds.length, 'first-slice endpoint')} ${apiBlockerIds.length === 1 ? 'is' : 'are'} not implementable as written.`
            : endpoints.length === 0
                ? 'No API endpoint is declared, and no data model is present to declare one.'
                : 'Every endpoint the first slice reaches carries auth, request/response shapes, and error cases.',
        evidence: apiEvidence.length > 0 ? apiEvidence : [makeEvidence(
            'api_contract', 'inferred',
            endpoints.length === 0
                ? 'No endpoint contract was available to score.'
                : `${plural(endpoints.length, 'endpoint')} scored; none is reachable from the first slice.`,
            'data_model', 'endpoints:none',
        )],
        actionTarget: slotTarget('data_model', { section: 'api_contract' }),
        blockerIds: apiBlockerIds,
        warningIds: apiWarningIds,
    });

    // ── 6. Conditional security/privacy + measurement obligations ──────────
    // Source: W5 `deriveCrossCuttingObligations` — `report.unresolved` IS the
    // blocking set. The generator's prompt states the same trigger conditions,
    // so the gate and the generator cannot disagree about when a section is owed.
    const obligations: CrossCuttingObligationsReport = deriveCrossCuttingObligations({
        prd: input.prd,
        safety: input.safety,
        dataModel: input.dataModel,
        plan: input.plan
            ? {
                securityPrivacy: input.plan.securityPrivacy,
                measurement: input.plan.measurement,
                milestones: input.plan.milestones,
            }
            : null,
    });
    const crossCuttingBlockerIds: string[] = [];
    const crossCuttingWarningIds: string[] = [];
    for (const section of obligations.unresolved) {
        crossCuttingBlockerIds.push(addBlocker(collector, 'cross_cutting', 'unresolved', section.key, {
            title: `${section.label} not discharged`,
            consequence: `${section.reason} ${truncate(section.missing.join(' '), 220)}`,
            remedy: section.absent
                ? 'Regenerate the Implementation Plan so it carries this section.'
                : 'Close the named gaps in the plan section, or regenerate the plan.',
            evidenceQuality: 'incomplete',
            actionTarget: slotTarget('implementation_plan'),
        }));
    }
    for (const section of [obligations.securityPrivacy, obligations.measurement]) {
        if (!section.required || !section.satisfied) continue;
        for (const advisory of section.advisories) {
            crossCuttingWarningIds.push(addWarning(collector, 'cross_cutting', 'advisory', `${section.key}:${advisory}`, {
                title: `${section.label}: ${truncate(advisory, 120)}`,
                owner: 'user',
                impact: 'The obligation is discharged, but this item leaves detail an implementer will have to decide.',
                rationale: 'The W5 contract treats this field as advisory — blocking on it would fail well-formed plans (plan §7).',
                actionTarget: slotTarget('implementation_plan'),
            }));
        }
    }
    const requiredSections = [obligations.securityPrivacy, obligations.measurement].filter(item => item.required);
    criteria.push({
        id: 'cross_cutting',
        label: BUILD_PACKET_CRITERION_LABELS.cross_cutting,
        status: crossCuttingBlockerIds.length > 0
            ? 'attention'
            : requiredSections.length === 0 ? 'not_started' : 'met',
        blocking: crossCuttingBlockerIds.length > 0,
        explanation: crossCuttingBlockerIds.length > 0
            ? `${plural(crossCuttingBlockerIds.length, 'required cross-cutting section')} ${crossCuttingBlockerIds.length === 1 ? 'is' : 'are'} unresolved.`
            : requiredSections.length === 0
                ? 'This project triggers neither a security/privacy nor a measurement obligation.'
                : `${plural(requiredSections.length, 'required section')} ${requiredSections.length === 1 ? 'is' : 'are'} discharged with linked requirements, tasks, and checks.`,
        evidence: [obligations.securityPrivacy, obligations.measurement].map(section => makeEvidence(
            'cross_cutting',
            section.required ? (section.satisfied ? 'direct' : 'incomplete') : 'inferred',
            `${section.label}: ${section.reason}`,
            'plan', section.key,
        )),
        actionTarget: slotTarget('implementation_plan'),
        blockerIds: crossCuttingBlockerIds,
        warningIds: crossCuttingWarningIds,
    });

    // ── 7. First milestone is an executable vertical slice ─────────────────
    // Source: the plan adapter's milestone shape. "Executable" is read as: it
    // exists, has concrete tasks, nothing it depends on is unresolved, and it
    // carries a way to tell when it is done. Whether it is *vertical* (spans UI
    // and data) is a WARNING, not a blocker: a well-formed generated first
    // milestone is frequently a scaffold, and blocking that would fail every
    // project (plan §7).
    const sliceBlockerIds: string[] = [];
    const sliceWarningIds: string[] = [];
    const sliceEvidence: BuildPacketEvidence[] = [];
    if (!firstSlice) {
        sliceBlockerIds.push(addBlocker(collector, 'first_slice', 'missing', 'implementation_plan', {
            title: 'The packet has no first implementation slice',
            consequence: 'There is no milestone to start from, so the packet cannot be handed to a build.',
            remedy: 'Generate the Implementation Plan.',
            evidenceQuality: 'incomplete',
            actionTarget: slotTarget('implementation_plan', { section: 'first_milestone' }),
        }));
    } else {
        const milestone = firstSlice.milestone;
        const sliceTarget = slotTarget('implementation_plan', {
            section: 'first_milestone',
            milestoneId: milestone.id,
        });
        if (firstSlice.tasks.length === 0) {
            sliceBlockerIds.push(addBlocker(collector, 'first_slice', 'no_tasks', milestone.id, {
                title: `"${milestone.name}" contains no tasks`,
                consequence: 'The first slice names an objective but no executable work, so nothing can actually be started.',
                remedy: 'Regenerate the Implementation Plan so the first milestone carries atomic tasks.',
                evidenceQuality: 'incomplete',
                actionTarget: sliceTarget,
            }));
        }
        const milestoneDeps = textItems(milestone.dependencies);
        if (milestoneDeps.length > 0) {
            const known = milestoneDeps.filter(id => projection.milestoneIds.has(id));
            const dangling = milestoneDeps.filter(id => !projection.milestoneIds.has(id));
            sliceBlockerIds.push(addBlocker(collector, 'first_slice', 'milestone_dependency', milestone.id, {
                title: `"${milestone.name}" cannot start yet`,
                consequence: dangling.length > 0
                    ? `The first milestone depends on ${list(dangling)}, which ${dangling.length === 1 ? 'is' : 'are'} not in this plan — the dependency is unresolvable.`
                    : `The first milestone depends on ${list(known)}, which has not been built, so it is not the slice to start with.`,
                remedy: 'Regenerate the Implementation Plan so the first milestone has no unmet dependency, or reorder the milestones.',
                evidenceQuality: 'direct',
                actionTarget: sliceTarget,
            }));
        }
        const firstSliceTaskIds = new Set(
            firstSlice.tasks.map(entry => entry.task?.id).filter(hasText).map(id => id.trim()),
        );
        const outsideDeps = firstSlice.tasks.flatMap(entry => textItems(entry.task?.dependencies)
            .filter(dependency => !firstSliceTaskIds.has(dependency))
            .map(dependency => ({ taskTitle: entry.task?.title ?? entry.task?.id ?? 'a task', dependency })));
        if (outsideDeps.length > 0) {
            sliceBlockerIds.push(addBlocker(collector, 'first_slice', 'task_dependency', milestone.id, {
                title: `"${milestone.name}" has tasks that depend on work outside the slice`,
                consequence: `${list(outsideDeps.map(item => `${item.taskTitle} → ${item.dependency}`))} — the slice cannot be completed on its own.`,
                remedy: 'Regenerate the Implementation Plan so first-milestone tasks depend only on each other.',
                evidenceQuality: 'direct',
                actionTarget: sliceTarget,
            }));
        }
        const verification = [
            ...firstSlice.verificationTexts,
            ...textItems(milestone.validationCommands),
        ];
        if (verification.length === 0) {
            sliceBlockerIds.push(addBlocker(collector, 'first_slice', 'no_verification', milestone.id, {
                title: `"${milestone.name}" has no way to tell when it is done`,
                consequence: 'The first slice carries no definition of done, quality gate, acceptance criterion, or validation command, so "executable" cannot be verified.',
                remedy: 'Regenerate the Implementation Plan so the first milestone carries a definition of done and quality gates.',
                evidenceQuality: 'incomplete',
                actionTarget: sliceTarget,
            }));
        }
        const linksScreens = textItems(milestone.linkedArtifacts?.screens).length > 0
            || firstSlice.tasks.some(entry => textItems(entry.task?.linkedArtifacts?.mockups).length > 0);
        const linksData = firstSlice.dataModelNames.length > 0;
        if (!linksScreens || !linksData) {
            sliceWarningIds.push(addWarning(collector, 'first_slice', 'not_vertical', milestone.id, {
                title: `"${milestone.name}" may not be a user-visible slice`,
                owner: 'user',
                impact: `It links ${linksScreens ? 'screens but no data entities' : linksData ? 'data entities but no screens' : 'neither screens nor data entities'}, so finishing it may produce nothing a user can see end to end.`,
                rationale: 'A first milestone that is scaffolding is a legitimate plan shape, so verticality is reported rather than required — blocking it would fail well-formed generated plans.',
                actionTarget: sliceTarget,
            }));
        }
        sliceEvidence.push(makeEvidence(
            'first_slice',
            sliceBlockerIds.length === 0 ? 'direct' : 'incomplete',
            `"${milestone.name}": ${plural(firstSlice.tasks.length, 'task')}, ${plural(verification.length, 'verification check')}, ${milestoneDeps.length === 0 ? 'no milestone dependency' : `${plural(milestoneDeps.length, 'milestone dependency', 'milestone dependencies')}`}.`,
            'plan', milestone.id,
        ));
    }
    criteria.push({
        id: 'first_slice',
        label: BUILD_PACKET_CRITERION_LABELS.first_slice,
        status: sliceBlockerIds.length > 0 ? (firstSlice ? 'attention' : 'not_started') : 'met',
        blocking: sliceBlockerIds.length > 0,
        explanation: !firstSlice
            ? 'No first milestone exists to start from.'
            : sliceBlockerIds.length === 0
                ? `"${firstSlice.milestone.name}" can be started now and carries its own completion checks.`
                : `"${firstSlice.milestone.name}" is not executable as written.`,
        evidence: sliceEvidence,
        actionTarget: slotTarget('implementation_plan', {
            section: 'first_milestone',
            milestoneId: firstSlice?.milestone.id,
        }),
        blockerIds: sliceBlockerIds,
        warningIds: sliceWarningIds,
    });

    // ── 8. Product reasoning is COMMITTED, not merely projected ────────────
    // Source: the CURRENT COMMITTED `ReadinessReview` (the caller's
    // `commitmentRemainsCurrent(...) && activeCommit` filter). The live
    // `isReadyToBuild` projection is never evidence that a commitment happened
    // — at most it informs whether a commit action is currently on offer.
    // Fails CLOSED on the `isCommitmentUnverifiable` case.
    const committedBlockerIds: string[] = [];
    const committedWarningIds: string[] = [];
    const committedEvidence: BuildPacketEvidence[] = [];
    const commitment = input.committedReadiness ?? undefined;
    if (input.commitmentUnverifiable) {
        committedBlockerIds.push(addBlocker(collector, 'reasoning_committed', 'unverifiable', 'commitment', {
            title: 'The readiness commitment cannot be verified',
            consequence: 'This plan claims to be committed, but no current, integrity-valid commitment can be verified — so nothing here proves the reasoning behind the packet was ever approved.',
            remedy: 'Reopen the plan and run Review readiness again to record a verifiable commitment.',
            evidenceQuality: 'incomplete',
            actionTarget: { kind: 'readiness_commitment' },
        }));
        committedEvidence.push(makeEvidence(
            'reasoning_committed', 'incomplete',
            'Readiness provenance exists for this spine but no current commitment could be verified.',
            'commitment', 'unverifiable',
        ));
    } else if (!commitment) {
        committedBlockerIds.push(addBlocker(collector, 'reasoning_committed', 'not_committed', 'commitment', {
            title: 'The product reasoning has not been committed',
            consequence: 'The packet would be built on reasoning nobody has approved. A readiness projection recomputed on render is not an approval.',
            remedy: input.planningProjectionReadyToBuild
                ? 'Open Review readiness — the current plan is ready to commit.'
                : 'Resolve the remaining planning items, then commit the plan from Review readiness.',
            evidenceQuality: 'incomplete',
            actionTarget: { kind: 'readiness_commitment' },
        }));
        committedEvidence.push(makeEvidence(
            'reasoning_committed', 'incomplete',
            input.planningProjectionReadyToBuild
                ? 'No current committed readiness review. The live planning projection reads ready, which only means a commit action can be offered — never that one happened.'
                : 'No current committed readiness review.',
            'commitment', 'none',
        ));
    } else if (input.currentSpineVersionId && commitment.spineVersionId !== input.currentSpineVersionId) {
        committedBlockerIds.push(addBlocker(collector, 'reasoning_committed', 'spine_mismatch', commitment.reviewId, {
            title: 'The commitment belongs to a different plan version',
            consequence: 'The recorded commitment approved another PRD version, so it says nothing about the reasoning behind this packet.',
            remedy: 'Run Review readiness against the current plan version and commit it.',
            evidenceQuality: 'incomplete',
            actionTarget: { kind: 'readiness_commitment' },
        }));
        committedEvidence.push(makeEvidence(
            'reasoning_committed', 'incomplete',
            `The current commitment binds to spine ${commitment.spineVersionId}, not ${input.currentSpineVersionId}.`,
            'commitment', commitment.reviewId, commitment.spineVersionId,
        ));
    } else if (commitment.conclusion === 'not_ready') {
        if (hasText(commitment.acceptedRiskRationale)) {
            committedWarningIds.push(addWarning(collector, 'reasoning_committed', 'accepted_risk', commitment.reviewId, {
                title: 'Committed with accepted risk',
                owner: 'user',
                impact: 'The packet rests on reasoning the readiness review judged not ready; the concerns the user accepted are still open.',
                rationale: commitment.acceptedRiskRationale!,
                actionTarget: { kind: 'readiness_commitment' },
            }));
            committedEvidence.push(makeEvidence(
                'reasoning_committed', 'direct',
                `Commitment recorded with accepted risk — ${truncate(commitment.acceptedRiskRationale!, 140)}`,
                'commitment', commitment.reviewId, commitment.spineVersionId,
            ));
        } else {
            committedBlockerIds.push(addBlocker(collector, 'reasoning_committed', 'risk_without_rationale', commitment.reviewId, {
                title: 'Committed with accepted risk, with no recorded rationale',
                consequence: 'The commitment authorized a not-ready readiness review, but no rationale was recorded — so the accepted risk cannot be reported as a considered decision.',
                remedy: 'Reopen the plan and re-commit, recording why the open concerns are acceptable.',
                evidenceQuality: 'incomplete',
                actionTarget: { kind: 'readiness_commitment' },
            }));
        }
    } else {
        committedEvidence.push(makeEvidence(
            'reasoning_committed', 'direct',
            `Readiness review ${commitment.reviewId} is committed and remains current for this plan version.`,
            'commitment', commitment.reviewId, commitment.spineVersionId,
        ));
    }
    criteria.push({
        id: 'reasoning_committed',
        label: BUILD_PACKET_CRITERION_LABELS.reasoning_committed,
        status: committedBlockerIds.length > 0 ? (commitment ? 'attention' : 'not_started') : 'met',
        blocking: committedBlockerIds.length > 0,
        explanation: committedBlockerIds.length > 0
            ? 'The reasoning behind this packet is not backed by a current committed readiness review.'
            : committedWarningIds.length > 0
                ? 'The plan is committed, with risk the user explicitly accepted.'
                : 'A current committed readiness review stands behind this packet.',
        evidence: committedEvidence,
        actionTarget: { kind: 'readiness_commitment' },
        blockerIds: committedBlockerIds,
        warningIds: committedWarningIds,
    });

    // ── Roll up ────────────────────────────────────────────────────────────
    const order = new Map(BUILD_PACKET_CRITERION_ORDER.map((id, index) => [id, index]));
    const blockers = [...collector.blockers].sort((a, b) => (
        (order.get(a.criterionId) ?? 0) - (order.get(b.criterionId) ?? 0)
    ));
    const warnings = [...collector.warnings].sort((a, b) => (
        (order.get(a.criterionId) ?? 0) - (order.get(b.criterionId) ?? 0)
    ));
    const isPacketComplete = criteria.every(criterion => !criterion.blocking);
    // Every criterion is reportable: when it had nothing concrete to cite, its
    // own explanation stands in as clearly-labelled `inferred` evidence rather
    // than an empty list.
    const reportable = criteria.map(item => (item.evidence.length > 0 ? item : {
        ...item,
        evidence: [makeEvidence(
            item.id, 'inferred', item.explanation,
            CRITERION_EVIDENCE_SOURCE[item.id], `${item.id}:summary`,
        )],
    }));
    return {
        isPacketComplete,
        status: isPacketComplete ? 'complete' : 'incomplete',
        headline: isPacketComplete
            ? 'Implementation packet complete'
            : 'Implementation packet incomplete',
        summary: isPacketComplete
            ? 'Every required output exists, is current, validates, covers the in-scope requirements, and traces to a committed plan.'
            : `${plural(blockers.length, 'blocker')} must be resolved before this packet can be handed to a build.`,
        criteria: reportable.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)),
        blockers,
        warnings,
        nextBlocker: blockers[0],
        evaluatedAt,
    };
}
