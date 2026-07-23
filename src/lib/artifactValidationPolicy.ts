import type {
    ArtifactValidationAcceptance,
    ArtifactValidationBlocker,
    ArtifactValidationBlockerCode,
    ArtifactValidationDisposition,
    ArtifactValidationOverridePolicy,
    ArtifactVersion,
} from '../types';
import { hashReviewValue } from './review/hash';

const CODES = new Set<ArtifactValidationBlockerCode>([
    'output_truncated',
    'output_unparseable',
    'output_structure_incomplete',
    'data_model_api_surface_missing',
    'user_flows_error_paths_missing',
    'prd_traceability_unverified',
    'legacy_unclassified',
]);

const POLICY: Record<ArtifactValidationBlockerCode, ArtifactValidationOverridePolicy> = {
    output_truncated: 'non_overridable',
    output_unparseable: 'non_overridable',
    output_structure_incomplete: 'non_overridable',
    data_model_api_surface_missing: 'rationale_required',
    user_flows_error_paths_missing: 'rationale_required',
    prd_traceability_unverified: 'rationale_required',
    legacy_unclassified: 'non_overridable',
};

export const artifactValidationOverridePolicyFor = (
    code: ArtifactValidationBlockerCode,
): ArtifactValidationOverridePolicy => POLICY[code];

export function readArtifactValidationBlockers(
    metadata: Record<string, unknown> | undefined,
): ArtifactValidationBlocker[] {
    const raw = metadata?.validationBlockers;
    if (raw === null || raw === undefined) return [];
    const items = Array.isArray(raw) ? raw : [raw];

    return items.flatMap((item): ArtifactValidationBlocker[] => {
        if (typeof item === 'string' && item.trim()) {
            return [{ code: 'legacy_unclassified', message: item.trim() }];
        }
        // Nullish and blank-string entries carry no claimed blocker. Every
        // other malformed entry fails closed: silently dropping an unknown
        // object/code can turn a mixed blocker set into an overrideable one,
        // or even make the version appear clear.
        if (item === null || item === undefined || (typeof item === 'string' && !item.trim())) {
            return [];
        }
        if (typeof item !== 'object' || Array.isArray(item)) {
            return [{
                code: 'legacy_unclassified',
                message: 'Unrecognized validation blocker metadata.',
            }];
        }
        const value = item as Record<string, unknown>;
        if (
            typeof value.code !== 'string'
            || !CODES.has(value.code as ArtifactValidationBlockerCode)
            || typeof value.message !== 'string'
            || !value.message.trim()
        ) {
            return [{
                code: 'legacy_unclassified',
                message: typeof value.message === 'string' && value.message.trim()
                    ? value.message.trim()
                    : 'Unrecognized validation blocker metadata.',
            }];
        }
        return [{
            code: value.code as ArtifactValidationBlockerCode,
            message: value.message.trim(),
        }];
    });
}

export const artifactValidationBlockerSetFingerprint = (
    blockers: readonly ArtifactValidationBlocker[],
): string => hashReviewValue(
    blockers
        .map(({ code, message }) => ({ code, message: message.trim() }))
        .sort((a, b) => a.code.localeCompare(b.code) || a.message.localeCompare(b.message)),
);

function readAcceptance(raw: unknown): ArtifactValidationAcceptance | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const value = raw as Record<string, unknown>;
    if (
        value.schemaVersion !== 1
        || value.actor !== 'user'
        || typeof value.acceptedAt !== 'number'
        || !Number.isFinite(value.acceptedAt)
        || typeof value.rationale !== 'string'
        || !value.rationale.trim()
        || typeof value.blockerFingerprint !== 'string'
        || !value.blockerFingerprint
    ) {
        return undefined;
    }
    return {
        schemaVersion: 1,
        actor: 'user',
        acceptedAt: value.acceptedAt,
        rationale: value.rationale.trim(),
        blockerFingerprint: value.blockerFingerprint,
    };
}

export function readArtifactValidationDisposition(
    metadata: Record<string, unknown> | undefined,
): ArtifactValidationDisposition {
    const blockers = readArtifactValidationBlockers(metadata);
    if (blockers.length === 0) {
        return { blockers, effectiveStatus: 'clear' };
    }

    const overridePolicy = blockers.every(
        blocker => POLICY[blocker.code] === 'rationale_required',
    )
        ? 'rationale_required'
        : 'non_overridable';
    const candidate = readAcceptance(metadata?.validationAcceptance);
    const accepted = overridePolicy === 'rationale_required'
        && candidate?.blockerFingerprint === artifactValidationBlockerSetFingerprint(blockers)
        ? candidate
        : undefined;

    return {
        blockers,
        ...(accepted ? { accepted } : {}),
        effectiveStatus: accepted ? 'accepted_issue' : 'needs_review',
        overridePolicy,
    };
}

export const isArtifactVersionEligibleAsGenerationContext = (
    version: ArtifactVersion | undefined,
): boolean => Boolean(version)
    && readArtifactValidationDisposition(version?.metadata).effectiveStatus !== 'needs_review';

export function withoutArtifactValidationAcceptance(
    metadata: Record<string, unknown>,
): Record<string, unknown> {
    const { validationAcceptance: ignored, ...rest } = metadata;
    void ignored;
    return rest;
}
