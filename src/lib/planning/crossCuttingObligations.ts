// Cross-cutting obligations — the shared generator/gate contract for the
// Implementation Plan's two CONDITIONAL sections (plan §W5):
//
//   • Security & Privacy obligations — owed when the project carries safety
//     restrictions, privacy/security/compliance requirements or risks, or a
//     data model with privacy-classified fields.
//   • Measurement — owed when the PRD declares success metrics.
//
// This module answers exactly one question per section: *is the plan required
// to carry it, and does what it carries actually discharge the obligation?*
// The plan prompt (`PLAN_CONDITIONAL_SECTIONS_SPEC`) states the same trigger
// conditions and the same per-item link requirements, so the generator and the
// build-packet readiness gate (plan §W6, which consumes this module rather
// than re-deriving anything) can never disagree about when a section is owed.
//
// Rules this module holds to (cross-cutting rules 3, 10, 13):
//  - PURE and DERIVED ON READ. No store, no LLM, no persistence, no side
//    effects. Nothing here is written to an artifact or a collection.
//  - Absence is reported honestly. A required-but-missing section is an
//    UNRESOLVED OBLIGATION with named gaps — never an empty section, never a
//    silent omission, and never auto-filled.
//  - No composite scores. `satisfied` is a boolean with an itemised `missing`
//    list; there is no percentage, weight, or confidence number.
//  - Legacy-safe. Every input is optional; a legacy plan with neither section
//    and a PRD with neither trigger yields two `required: false` sections and
//    renders nothing.

import type {
    DataModelContent,
    PlanMeasurementMetric,
    PlanMeasurementSection,
    PlanSecurityControl,
    PlanSecurityPrivacySection,
    SafetyClassification,
    StructuredPRD,
} from '../../types';
import { PRIVACY_SIGNAL_RE } from '../canonicalPrdSpine';

// --- Public shape -------------------------------------------------------------

export type CrossCuttingObligationKey = 'security_privacy' | 'measurement';

/** Where a requirement came from. Every trigger is reported, never summed. */
export type CrossCuttingTriggerSource =
    | 'safety_review'
    | 'prd_privacy_requirement'
    | 'prd_privacy_risk'
    | 'data_model_privacy_fields'
    | 'data_model_privacy_rules'
    | 'prd_success_metrics';

export interface CrossCuttingObligationTrigger {
    source: CrossCuttingTriggerSource;
    /** Plain-language evidence, quoting the input that fired the trigger. */
    detail: string;
}

export interface CrossCuttingObligationStatus {
    key: CrossCuttingObligationKey;
    /** Section label used by the UI and by gate copy. */
    label: string;
    /** True when this project's inputs oblige the plan to carry the section. */
    required: boolean;
    /** Why it is (or is not) required, in plain language. */
    reason: string;
    /** The individual signals that fired. Empty when not required. */
    triggers: CrossCuttingObligationTrigger[];
    /** True only when required AND every gap is closed. Never true when not required. */
    satisfied: boolean;
    /** True when the section is required and the plan carries nothing for it. */
    absent: boolean;
    /** Named gaps that keep the obligation unresolved. Empty when satisfied. */
    missing: string[];
    /** Non-blocking review notes (present content that is merely thin). */
    advisories: string[];
    /** Controls / metrics the plan carries for this section. */
    itemCount: number;
}

export interface CrossCuttingObligationsReport {
    securityPrivacy: CrossCuttingObligationStatus;
    measurement: CrossCuttingObligationStatus;
    /** Required sections that are not satisfied — what §W6 blocks on. */
    unresolved: CrossCuttingObligationStatus[];
    /** Convenience: `unresolved.length > 0`. */
    hasUnresolvedObligations: boolean;
}

/**
 * Safety context, structurally compatible with both `SpineSafetyReview`
 * (`detectedConcerns`) and the canonical spine's `SpineSafetyRestrictions`
 * (`boundaries`), so either can be passed without conversion.
 */
export interface CrossCuttingSafetyContext {
    classification?: SafetyClassification;
    status?: 'generated' | 'restricted' | 'blocked';
    detectedConcerns?: string[];
    boundaries?: string[];
}

/**
 * The plan's conditional sections, as carried by a structured plan. Declared
 * structurally (not as `StructuredImplementationPlan`) so both that shape and
 * the render-time `ConsolidatedImplementationPlan` can be passed unchanged.
 * `milestones` is optional and used only to verify that a linked task id
 * actually exists in the plan — when it is absent, the check is skipped rather
 * than guessed at.
 */
export interface CrossCuttingPlanSections {
    securityPrivacy?: PlanSecurityPrivacySection;
    measurement?: PlanMeasurementSection;
    milestones?: readonly { tasks?: readonly { id: string }[] }[];
}

export interface CrossCuttingObligationsInput {
    /** The PRD: source of privacy requirements/risks and declared success metrics. */
    prd?: StructuredPRD | null;
    /** The spine's safety verdict / restrictions, when the project has one. */
    safety?: CrossCuttingSafetyContext | null;
    /** The resolved Data Model artifact content, when one exists. */
    dataModel?: DataModelContent | null;
    /** The plan's conditional sections, when the plan carries them. */
    plan?: CrossCuttingPlanSections | null;
}

export const CROSS_CUTTING_OBLIGATION_LABELS: Record<CrossCuttingObligationKey, string> = {
    security_privacy: 'Security & Privacy obligations',
    measurement: 'Measurement',
};

/**
 * Per-control links the plan prompt demands. A control that names no
 * requirement, no task, or no verification is not an implementable obligation.
 * These entries ARE the check (`evaluateSecurityPrivacy` iterates them), so the
 * list and the logic cannot drift apart.
 */
export const SECURITY_CONTROL_LINK_FIELDS = [
    { field: 'requirementIds', gap: 'no linked requirement ids' },
    { field: 'taskIds', gap: 'no linked plan tasks' },
    { field: 'tests', gap: 'no verification checks' },
] as const satisfies readonly { field: keyof PlanSecurityControl; gap: string }[];

/**
 * Per-metric fields the plan prompt demands and this module treats as blocking
 * (again, iterated directly by the evaluator). `properties` and `taskIds` are
 * prompted for too but stay ADVISORY: a simple counter event can legitimately
 * carry no properties, and blocking on them would fail well-formed plans
 * (plan §7 — a gate stricter than the generator makes every project
 * un-buildable).
 */
export const MEASUREMENT_METRIC_CORE_FIELDS = [
    { field: 'eventName', gap: 'no event name' },
    { field: 'trigger', gap: 'no trigger' },
    { field: 'validation', gap: 'no validation' },
] as const satisfies readonly { field: keyof PlanMeasurementMetric; gap: string }[];

// --- Helpers ------------------------------------------------------------------

const hasText = (value: string | undefined | null): boolean =>
    typeof value === 'string' && value.trim().length > 0;

const textItems = (values: readonly (string | undefined)[] | undefined): string[] =>
    (values ?? []).filter((v): v is string => hasText(v)).map(v => v.trim());

const truncate = (value: string, max = 90): string =>
    value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

/** Normalize a metric/label for matching: casefold, strip punctuation. */
const normalizeLabel = (value: string): string =>
    value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const PRIVACY_FIELD_GROUP = 'Privacy / Safety';

/**
 * Task ids declared anywhere in the plan, or `null` when the caller passed no
 * milestones (then a link cannot be checked and must not be reported as broken).
 */
function planTaskIds(plan: CrossCuttingPlanSections | null | undefined): Set<string> | null {
    if (!plan?.milestones) return null;
    const ids = new Set<string>();
    for (const milestone of plan.milestones) {
        for (const task of milestone?.tasks ?? []) {
            if (hasText(task?.id)) ids.add(task.id.trim());
        }
    }
    return ids;
}

/** Linked task ids that do not resolve to a task in this plan. */
function danglingTaskIds(ids: string[] | undefined, known: Set<string> | null): string[] {
    if (!known) return [];
    return textItems(ids).filter(id => !known.has(id));
}

// --- Requirement half (the triggers) -----------------------------------------

export interface CrossCuttingRequirement {
    key: CrossCuttingObligationKey;
    label: string;
    required: boolean;
    reason: string;
    triggers: CrossCuttingObligationTrigger[];
}

export interface CrossCuttingRequirements {
    securityPrivacy: CrossCuttingRequirement;
    measurement: CrossCuttingRequirement;
}

function securityPrivacyTriggers(
    input: CrossCuttingObligationsInput,
): CrossCuttingObligationTrigger[] {
    const triggers: CrossCuttingObligationTrigger[] = [];
    const { prd, safety, dataModel } = input;

    // 1. Safety context on the spine. `restricted` status or a non-`allowed`
    //    classification means restrictions must survive into the build; any
    //    detected concern / boundary does too, even on an `allowed` spine.
    if (safety) {
        const concerns = [...textItems(safety.detectedConcerns), ...textItems(safety.boundaries)];
        const restricted = safety.status === 'restricted'
            || safety.status === 'blocked'
            || (safety.classification !== undefined && safety.classification !== 'allowed');
        if (restricted) {
            triggers.push({
                source: 'safety_review',
                detail: concerns.length > 0
                    ? `Safety review returned "${safety.classification ?? safety.status}" with boundaries to honor: ${truncate(concerns.join('; '), 140)}`
                    : `Safety review returned "${safety.classification ?? safety.status}" — its restrictions must survive into the build.`,
            });
        } else if (concerns.length > 0) {
            triggers.push({
                source: 'safety_review',
                detail: `Safety review recorded content boundaries to honor: ${truncate(concerns.join('; '), 140)}`,
            });
        }
    }

    // 2. PRD privacy/security/compliance requirements (same vocabulary the
    //    canonical spine uses to build `constraints.privacySecurityCompliance`).
    for (const text of [...textItems(prd?.constraints), ...textItems(prd?.nonFunctionalRequirements)]) {
        if (PRIVACY_SIGNAL_RE.test(text)) {
            triggers.push({
                source: 'prd_privacy_requirement',
                detail: `PRD requirement: "${truncate(text)}"`,
            });
        }
    }

    // 3. PRD privacy/security risks (plain and detailed).
    for (const text of textItems(prd?.risks)) {
        if (PRIVACY_SIGNAL_RE.test(text)) {
            triggers.push({ source: 'prd_privacy_risk', detail: `PRD risk: "${truncate(text)}"` });
        }
    }
    for (const risk of prd?.risksDetailed ?? []) {
        const text = [risk?.risk, risk?.impact].filter(hasText).join(' — ');
        if (hasText(text) && PRIVACY_SIGNAL_RE.test(text)) {
            triggers.push({ source: 'prd_privacy_risk', detail: `PRD risk: "${truncate(text)}"` });
        }
    }

    // 4. Privacy-classified data-model field groups, and entity privacy rules.
    for (const entity of dataModel?.entities ?? []) {
        const privacyFields = (entity.fieldGroups ?? [])
            .filter(group => group?.name === PRIVACY_FIELD_GROUP)
            .flatMap(group => textItems(group.fieldNames));
        if (privacyFields.length > 0) {
            triggers.push({
                source: 'data_model_privacy_fields',
                detail: `Data model entity "${entity.name}" classifies ${privacyFields.length} field${privacyFields.length === 1 ? '' : 's'} as ${PRIVACY_FIELD_GROUP}: ${truncate(privacyFields.join(', '), 120)}`,
            });
        }
        const rules = textItems(entity.privacyRules);
        if (rules.length > 0) {
            triggers.push({
                source: 'data_model_privacy_rules',
                detail: `Data model entity "${entity.name}" declares ${rules.length} privacy rule${rules.length === 1 ? '' : 's'}: ${truncate(rules.join('; '), 120)}`,
            });
        }
    }

    return triggers;
}

function measurementTriggers(
    input: CrossCuttingObligationsInput,
): CrossCuttingObligationTrigger[] {
    const names = declaredMetricNames(input.prd);
    if (names.length === 0) return [];
    return [{
        source: 'prd_success_metrics',
        detail: `The PRD declares ${names.length} success metric${names.length === 1 ? '' : 's'}: ${truncate(names.join(', '), 160)}`,
    }];
}

/** Declared PRD success-metric names, in order, de-duplicated by normalized form. */
function declaredMetricNames(prd: StructuredPRD | null | undefined): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const metric of prd?.successMetrics ?? []) {
        const name = metric?.name;
        if (!hasText(name)) continue;
        const key = normalizeLabel(name);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(name.trim());
    }
    return out;
}

/**
 * The requirement half on its own: *which* sections this project owes, and
 * why. Exported so a caller that already knows the plan is missing (or that
 * wants to explain the obligation before generation) can ask without a plan.
 */
export function deriveCrossCuttingRequirements(
    input: CrossCuttingObligationsInput,
): CrossCuttingRequirements {
    const sp = securityPrivacyTriggers(input);
    const mm = measurementTriggers(input);
    return {
        securityPrivacy: {
            key: 'security_privacy',
            label: CROSS_CUTTING_OBLIGATION_LABELS.security_privacy,
            required: sp.length > 0,
            reason: sp.length > 0
                ? `Required: ${sp.length === 1 ? 'this project carries' : `this project carries ${sp.length}`} security/privacy signal${sp.length === 1 ? '' : 's'} the build must honor.`
                : 'Not required: no safety restrictions, privacy/security requirements or risks, or privacy-classified data fields were found.',
            triggers: sp,
        },
        measurement: {
            key: 'measurement',
            label: CROSS_CUTTING_OBLIGATION_LABELS.measurement,
            required: mm.length > 0,
            reason: mm.length > 0
                ? 'Required: the PRD declares success metrics, so the plan must say how each one is measured.'
                : 'Not required: the PRD declares no success metrics.',
            triggers: mm,
        },
    };
}

// --- Satisfaction half --------------------------------------------------------

function evaluateSecurityPrivacy(
    requirement: CrossCuttingRequirement,
    section: PlanSecurityPrivacySection | undefined,
    knownTaskIds: Set<string> | null,
): CrossCuttingObligationStatus {
    const controls = (section?.controls ?? []).filter(c => c && hasText(c.title));
    const openQuestions = textItems(section?.openQuestions);
    const base = {
        key: requirement.key,
        label: requirement.label,
        required: requirement.required,
        reason: requirement.reason,
        triggers: requirement.triggers,
        itemCount: controls.length,
    };

    if (!requirement.required) {
        // Not required: nothing is owed, so nothing can be missing. Content the
        // model volunteered is still reported through `itemCount`.
        return { ...base, satisfied: false, absent: false, missing: [], advisories: [] };
    }

    const hasSection = Boolean(section) && (controls.length > 0 || openQuestions.length > 0 || hasText(section?.summary));
    if (!hasSection) {
        return {
            ...base,
            satisfied: false,
            absent: true,
            missing: ['The plan carries no Security & Privacy section, so none of these obligations is assigned to any task.'],
            advisories: [],
        };
    }

    const missing: string[] = [];
    const advisories: string[] = [];
    if (controls.length === 0) {
        missing.push('The Security & Privacy section names no controls — an obligation with no control is unresolved.');
    }
    for (const control of controls) {
        const gaps: string[] = [];
        for (const { field, gap } of SECURITY_CONTROL_LINK_FIELDS) {
            if (textItems(control[field]).length === 0) gaps.push(gap);
        }
        const dangling = danglingTaskIds(control.taskIds, knownTaskIds);
        if (dangling.length > 0) {
            gaps.push(`links ${dangling.length === 1 ? 'a task' : 'tasks'} that this plan does not contain (${dangling.join(', ')})`);
        }
        if (gaps.length > 0) missing.push(`Control "${control.title}": ${gaps.join(', ')}.`);
        if (!hasText(control.implementation)) {
            advisories.push(`Control "${control.title}" does not say how it is implemented.`);
        }
    }
    for (const question of openQuestions) {
        missing.push(`Open security/privacy question, unresolved: "${truncate(question)}"`);
    }

    return { ...base, satisfied: missing.length === 0, absent: false, missing, advisories };
}

function evaluateMeasurement(
    requirement: CrossCuttingRequirement,
    section: PlanMeasurementSection | undefined,
    prd: StructuredPRD | null | undefined,
    knownTaskIds: Set<string> | null,
): CrossCuttingObligationStatus {
    const metrics = (section?.metrics ?? []).filter(m => m && hasText(m.metric));
    const openQuestions = textItems(section?.openQuestions);
    const base = {
        key: requirement.key,
        label: requirement.label,
        required: requirement.required,
        reason: requirement.reason,
        triggers: requirement.triggers,
        itemCount: metrics.length,
    };

    if (!requirement.required) {
        return { ...base, satisfied: false, absent: false, missing: [], advisories: [] };
    }

    const hasSection = Boolean(section) && (metrics.length > 0 || openQuestions.length > 0 || hasText(section?.summary));
    if (!hasSection) {
        return {
            ...base,
            satisfied: false,
            absent: true,
            missing: ['The plan carries no Measurement section, so no declared success metric has an instrumentation contract.'],
            advisories: [],
        };
    }

    const missing: string[] = [];
    const advisories: string[] = [];

    // Every declared PRD metric must be accounted for — mapped, or explicitly
    // parked as an open question. Matching is normalized-label containment in
    // either direction, so "Weekly active creators" matches a mapping written
    // as "Weekly Active Creators (WAC)".
    const mappedLabels = metrics.map(m => normalizeLabel(m.metric));
    const parkedLabels = openQuestions.map(normalizeLabel);
    for (const declared of declaredMetricNames(prd)) {
        const target = normalizeLabel(declared);
        const isMapped = mappedLabels.some(label => label === target || label.includes(target) || target.includes(label));
        if (isMapped) continue;
        const isParked = parkedLabels.some(label => label.includes(target) || target.includes(label));
        missing.push(isParked
            ? `Success metric "${declared}" is parked as an open question, not instrumented.`
            : `Success metric "${declared}" has no event mapping.`);
    }

    for (const metric of metrics) {
        const gaps: string[] = [];
        for (const { field, gap } of MEASUREMENT_METRIC_CORE_FIELDS) {
            if (!hasText(metric[field])) gaps.push(gap);
        }
        if (gaps.length > 0) missing.push(`Metric "${metric.metric}": ${gaps.join(', ')}.`);
        if (textItems(metric.properties).length === 0) {
            advisories.push(`Metric "${metric.metric}" declares no event properties.`);
        }
        if (textItems(metric.taskIds).length === 0) {
            advisories.push(`Metric "${metric.metric}" is not linked to a plan task.`);
        }
        const dangling = danglingTaskIds(metric.taskIds, knownTaskIds);
        if (dangling.length > 0) {
            missing.push(`Metric "${metric.metric}" links ${dangling.length === 1 ? 'a task' : 'tasks'} that this plan does not contain (${dangling.join(', ')}).`);
        }
    }

    return { ...base, satisfied: missing.length === 0, absent: false, missing, advisories };
}

// --- Main entry ----------------------------------------------------------------

/**
 * THE predicate. Given a project's PRD (+ safety context), its data model, and
 * the plan's conditional sections, report per section whether it is required,
 * why, whether the plan discharges it, and exactly what is missing.
 *
 * §W6 consumes this directly — `report.unresolved` is the blocking set and
 * each entry's `missing` list is the user-fixable detail. Nothing here gates
 * rendering or generation on its own.
 */
export function deriveCrossCuttingObligations(
    input: CrossCuttingObligationsInput,
): CrossCuttingObligationsReport {
    const requirements = deriveCrossCuttingRequirements(input);
    const knownTaskIds = planTaskIds(input.plan);
    const securityPrivacy = evaluateSecurityPrivacy(
        requirements.securityPrivacy,
        input.plan?.securityPrivacy,
        knownTaskIds,
    );
    const measurement = evaluateMeasurement(
        requirements.measurement,
        input.plan?.measurement,
        input.prd,
        knownTaskIds,
    );
    const unresolved = [securityPrivacy, measurement].filter(s => s.required && !s.satisfied);
    return {
        securityPrivacy,
        measurement,
        unresolved,
        hasUnresolvedObligations: unresolved.length > 0,
    };
}
