// API-contract completeness — a pure, derived, ADVISORY read-side check.
//
// Scores each Data Model API endpoint `complete | partial | stub` against the
// contract field set introduced by the API-contract workstream
// (`ApiEndpointContract` in src/types; prompted via
// `API_ENDPOINT_CONTRACT_SPEC`), naming the SPECIFIC missing fields per
// endpoint so the review UI can say exactly what is absent.
//
// Rules (cross-cutting rules 3 & 10):
// - Derived on read, never persisted. No store access, no side effects.
// - Advisory-only at this layer: nothing here gates rendering, generation, or
//   validation. `artifactBlockingValidation.ts` is deliberately untouched —
//   blocking for endpoints reachable from the first slice arrives with the
//   build-packet readiness evaluator (plan §W6), which will consume this
//   module rather than re-deriving the field set.
// - Legacy endpoints (method/path/description/entity only) score `stub`, an
//   honest "no contract details" state — never an error.

export type ApiContractStatus = 'complete' | 'partial' | 'stub';

/**
 * Structural input — a superset-tolerant view of `ApiEndpointContract` /
 * `ParsedApiEndpoint` (only method+path are required so both shapes are
 * assignable without imports from the services layer).
 */
export interface ApiEndpointLike {
    method: string;
    path: string;
    description?: string;
    entity?: string;
    auth?: { authentication?: string; authorization?: string };
    requestSchema?: string;
    responseSchema?: string;
    errors?: string[];
    pagination?: string;
    idempotency?: string;
    rateLimit?: string;
    requirementIds?: string[];
    tests?: string[];
}

/**
 * Contract fields that define implementability. Missing any of these means
 * the endpoint cannot be built against without guessing.
 */
export const CORE_CONTRACT_FIELDS = [
    'auth.authentication',
    'auth.authorization',
    'requestSchema',
    'responseSchema',
    'errors',
] as const;

/**
 * Supplementary contract fields — required for a `complete` score but their
 * absence alone never drops an endpoint below `partial`.
 */
export const SUPPLEMENTARY_CONTRACT_FIELDS = [
    'pagination',
    'idempotency',
    'rateLimit',
    'requirementIds',
    'tests',
] as const;

export type ContractFieldName =
    | (typeof CORE_CONTRACT_FIELDS)[number]
    | (typeof SUPPLEMENTARY_CONTRACT_FIELDS)[number];

export interface ApiEndpointCompleteness {
    /** Stable display key, e.g. "GET /api/playlists/:id". */
    key: string;
    method: string;
    path: string;
    status: ApiContractStatus;
    /** Every contract field absent/empty on this endpoint, in declaration order. */
    missingFields: ContractFieldName[];
    /** The implementability subset of `missingFields`. */
    missingCoreFields: ContractFieldName[];
}

export interface ApiContractCompletenessSummary {
    endpoints: ApiEndpointCompleteness[];
    completeCount: number;
    partialCount: number;
    stubCount: number;
    /**
     * Section-level advisory status: `empty` (no endpoints at all),
     * `complete` (every endpoint complete), `stub` (every endpoint is a
     * legacy stub), else `partial`.
     */
    status: ApiContractStatus | 'empty';
}

const hasText = (value: string | undefined): boolean =>
    typeof value === 'string' && value.trim().length > 0;

const hasItems = (values: string[] | undefined): boolean =>
    Array.isArray(values) && values.some(v => hasText(v));

function fieldPresent(endpoint: ApiEndpointLike, field: ContractFieldName): boolean {
    switch (field) {
        case 'auth.authentication':
            return hasText(endpoint.auth?.authentication);
        case 'auth.authorization':
            return hasText(endpoint.auth?.authorization);
        case 'requestSchema':
            return hasText(endpoint.requestSchema);
        case 'responseSchema':
            return hasText(endpoint.responseSchema);
        case 'errors':
            return hasItems(endpoint.errors);
        case 'pagination':
            return hasText(endpoint.pagination);
        case 'idempotency':
            return hasText(endpoint.idempotency);
        case 'rateLimit':
            return hasText(endpoint.rateLimit);
        case 'requirementIds':
            return hasItems(endpoint.requirementIds);
        case 'tests':
            return hasItems(endpoint.tests);
    }
}

/** Score one endpoint, naming exactly which contract fields are missing. */
export function evaluateEndpointContract(endpoint: ApiEndpointLike): ApiEndpointCompleteness {
    const allFields: ContractFieldName[] = [...CORE_CONTRACT_FIELDS, ...SUPPLEMENTARY_CONTRACT_FIELDS];
    const missingFields = allFields.filter(f => !fieldPresent(endpoint, f));
    const missingCoreFields = missingFields.filter(f =>
        (CORE_CONTRACT_FIELDS as readonly string[]).includes(f),
    );

    let status: ApiContractStatus;
    if (missingFields.length === 0) {
        status = 'complete';
    } else if (missingFields.length === allFields.length) {
        // No contract field present at all — the legacy pre-contract shape.
        status = 'stub';
    } else {
        status = 'partial';
    }

    return {
        key: `${endpoint.method.toUpperCase()} ${endpoint.path}`,
        method: endpoint.method,
        path: endpoint.path,
        status,
        missingFields,
        missingCoreFields,
    };
}

/** Score a whole endpoint list and roll up a section-level advisory status. */
export function evaluateApiContractCompleteness(
    endpoints: ApiEndpointLike[],
): ApiContractCompletenessSummary {
    const scored = endpoints.map(evaluateEndpointContract);
    const completeCount = scored.filter(e => e.status === 'complete').length;
    const partialCount = scored.filter(e => e.status === 'partial').length;
    const stubCount = scored.filter(e => e.status === 'stub').length;

    let status: ApiContractCompletenessSummary['status'];
    if (scored.length === 0) status = 'empty';
    else if (completeCount === scored.length) status = 'complete';
    else if (stubCount === scored.length) status = 'stub';
    else status = 'partial';

    return { endpoints: scored, completeCount, partialCount, stubCount, status };
}
