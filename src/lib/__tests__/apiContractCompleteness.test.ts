import { describe, it, expect } from 'vitest';
import {
    evaluateEndpointContract,
    evaluateApiContractCompleteness,
    CORE_CONTRACT_FIELDS,
    SUPPLEMENTARY_CONTRACT_FIELDS,
    type ApiEndpointLike,
} from '../apiContractCompleteness';

const fullEndpoint: ApiEndpointLike = {
    method: 'POST',
    path: '/api/snapshots',
    description: 'Create a snapshot',
    entity: 'MoodSnapshot',
    auth: { authentication: 'Bearer JWT required', authorization: 'Any authenticated user' },
    requestSchema: '{ joy_score: Float, energy_level: Float }',
    responseSchema: '{ id: UUID, joy_score: Float }',
    errors: ['401 — missing or invalid token', '422 — scores outside 0-1'],
    pagination: 'none',
    idempotency: 'not idempotent — creates a new record per call',
    rateLimit: '60/min per user',
    requirementIds: ['f1'],
    tests: ['Creates a snapshot for a valid payload', 'Rejects out-of-range scores with 422'],
};

/** The legacy pre-contract shape: method/path/description/entity only. */
const legacyEndpoint: ApiEndpointLike = {
    method: 'get',
    path: '/api/playlists/:id',
    description: 'Fetch a playlist',
    entity: 'ResonancePlaylist',
};

describe('evaluateEndpointContract', () => {
    it('scores a fully populated contract as complete with no missing fields', () => {
        const result = evaluateEndpointContract(fullEndpoint);
        expect(result.status).toBe('complete');
        expect(result.missingFields).toEqual([]);
        expect(result.missingCoreFields).toEqual([]);
        expect(result.key).toBe('POST /api/snapshots');
    });

    it('scores a legacy endpoint (no contract fields at all) as stub, naming every field', () => {
        const result = evaluateEndpointContract(legacyEndpoint);
        expect(result.status).toBe('stub');
        expect(result.missingFields).toEqual([
            ...CORE_CONTRACT_FIELDS,
            ...SUPPLEMENTARY_CONTRACT_FIELDS,
        ]);
        expect(result.missingCoreFields).toEqual([...CORE_CONTRACT_FIELDS]);
        // Key is method-uppercased for stable display.
        expect(result.key).toBe('GET /api/playlists/:id');
    });

    it('scores a partially filled contract as partial and names the exact missing fields', () => {
        const partial: ApiEndpointLike = {
            ...legacyEndpoint,
            auth: { authentication: 'Bearer JWT required' }, // authorization missing
            responseSchema: '{ id: UUID, title: String }',
            requirementIds: ['f2'],
        };
        const result = evaluateEndpointContract(partial);
        expect(result.status).toBe('partial');
        expect(result.missingFields).toEqual([
            'auth.authorization',
            'requestSchema',
            'errors',
            'pagination',
            'idempotency',
            'rateLimit',
            'tests',
        ]);
        expect(result.missingCoreFields).toEqual([
            'auth.authorization',
            'requestSchema',
            'errors',
        ]);
    });

    it('treats whitespace-only strings and empty arrays as missing', () => {
        const blank: ApiEndpointLike = {
            ...fullEndpoint,
            requestSchema: '   ',
            errors: [],
            tests: ['   '],
        };
        const result = evaluateEndpointContract(blank);
        expect(result.status).toBe('partial');
        expect(result.missingFields).toEqual(['requestSchema', 'errors', 'tests']);
        expect(result.missingCoreFields).toEqual(['requestSchema', 'errors']);
    });

    it('missing only supplementary fields is partial (never stub), with an empty core-missing set', () => {
        const supplementaryGap: ApiEndpointLike = {
            ...fullEndpoint,
            rateLimit: undefined,
            tests: undefined,
        };
        const result = evaluateEndpointContract(supplementaryGap);
        expect(result.status).toBe('partial');
        expect(result.missingFields).toEqual(['rateLimit', 'tests']);
        expect(result.missingCoreFields).toEqual([]);
    });
});

describe('evaluateApiContractCompleteness', () => {
    it('returns empty status for no endpoints', () => {
        const summary = evaluateApiContractCompleteness([]);
        expect(summary.status).toBe('empty');
        expect(summary.endpoints).toEqual([]);
        expect(summary.completeCount).toBe(0);
        expect(summary.partialCount).toBe(0);
        expect(summary.stubCount).toBe(0);
    });

    it('rolls up complete when every endpoint is complete', () => {
        const summary = evaluateApiContractCompleteness([fullEndpoint, { ...fullEndpoint, path: '/api/other' }]);
        expect(summary.status).toBe('complete');
        expect(summary.completeCount).toBe(2);
    });

    it('rolls up stub when every endpoint is a legacy stub (whole-document legacy case)', () => {
        const summary = evaluateApiContractCompleteness([legacyEndpoint, { ...legacyEndpoint, path: '/api/users' }]);
        expect(summary.status).toBe('stub');
        expect(summary.stubCount).toBe(2);
    });

    it('rolls up partial for any mixed population', () => {
        const summary = evaluateApiContractCompleteness([fullEndpoint, legacyEndpoint]);
        expect(summary.status).toBe('partial');
        expect(summary.completeCount).toBe(1);
        expect(summary.stubCount).toBe(1);
        expect(summary.partialCount).toBe(0);
    });
});
