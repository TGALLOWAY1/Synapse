// Dependency sufficiency gate for artifact generation. A dependent artifact
// must not silently generate from missing/errored required upstream artifacts
// (which produced degraded output with a soft "Not generated yet." placeholder
// in the prompt). This gate blocks generation when a REQUIRED dependency is
// unavailable, unless the caller explicitly allows degraded generation.
//
// Pure and store-free so it is trivially unit-testable.

import type { CoreArtifactSubtype } from '../types';
import { getRequiredDependencies } from './coreArtifactPipeline';

export class DependencyInsufficiencyError extends Error {
    readonly subtype: CoreArtifactSubtype;
    readonly missing: CoreArtifactSubtype[];
    constructor(subtype: CoreArtifactSubtype, missing: CoreArtifactSubtype[]) {
        super(
            `Cannot generate ${subtype}: required upstream ${missing.length > 1 ? 'dependencies are' : 'dependency is'} ` +
            `missing or empty (${missing.join(', ')}). Generate ${missing.length > 1 ? 'them' : 'it'} first, ` +
            `or retry with degraded generation acknowledged.`,
        );
        this.name = 'DependencyInsufficiencyError';
        this.subtype = subtype;
        this.missing = missing;
    }
}

// A dependency is "available" when its content is a present, non-blank string.
function isAvailable(content: string | undefined | null): boolean {
    return typeof content === 'string' && content.trim().length > 0;
}

/** Required dependencies for `subtype` that are missing/empty in the map. */
export function findMissingRequiredDependencies(
    subtype: CoreArtifactSubtype,
    generatedArtifacts: Partial<Record<CoreArtifactSubtype, string>>,
): CoreArtifactSubtype[] {
    return getRequiredDependencies(subtype).filter(dep => !isAvailable(generatedArtifacts[dep]));
}

/**
 * Throw a DependencyInsufficiencyError when a required dependency is missing,
 * unless `allowMissing` (explicit acknowledgement of degraded generation).
 */
export function assertDependenciesSufficient(
    subtype: CoreArtifactSubtype,
    generatedArtifacts: Partial<Record<CoreArtifactSubtype, string>>,
    options: { allowMissing?: boolean } = {},
): void {
    const missing = findMissingRequiredDependencies(subtype, generatedArtifacts);
    if (missing.length > 0 && !options.allowMissing) {
        throw new DependencyInsufficiencyError(subtype, missing);
    }
}
