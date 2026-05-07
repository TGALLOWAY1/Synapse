// Helpers that resolve a project's preferred design tokens out of the
// Zustand project store. Lives in this module (not the store itself) so
// the design-tokens domain stays self-contained — callers from any layer
// (mockup services, mockup image store, mockup viewer, staleness slice)
// can import these without spreading store-shape knowledge across the
// codebase.

import type { Artifact, ArtifactVersion, DesignTokens } from '../../types';
import { normalizeDesignTokens } from './normalize';

interface MinimalArtifactState {
    artifacts: Record<string, Artifact[]>;
    artifactVersions: Record<string, ArtifactVersion[]>;
}

/**
 * Resolve the preferred Design System artifact + its tokens for a given
 * project. Returns `null` when there is no design_system artifact, no
 * preferred version, or the version doesn't carry tokens (legacy data).
 */
export function selectPreferredDesignSystem(
    state: MinimalArtifactState,
    projectId: string,
): {
    artifactId: string;
    versionId: string;
    tokens: DesignTokens;
    tokensHash: string;
} | null {
    const artifacts = state.artifacts[projectId] ?? [];
    const designSystem = artifacts.find(
        a => a.type === 'core_artifact' && a.subtype === 'design_system' && a.status !== 'archived',
    );
    if (!designSystem || !designSystem.currentVersionId) return null;

    const versions = state.artifactVersions[projectId] ?? [];
    const preferred = versions.find(v => v.id === designSystem.currentVersionId);
    if (!preferred) return null;

    const rawTokens = preferred.metadata?.tokens;
    const rawHash = preferred.metadata?.tokensHash;
    if (!rawTokens || typeof rawTokens !== 'object') return null;
    const tokens = normalizeDesignTokens(rawTokens);
    const tokensHash = typeof rawHash === 'string' ? rawHash : '';
    return {
        artifactId: designSystem.id,
        versionId: preferred.id,
        tokens,
        tokensHash,
    };
}

/**
 * Convenience: returns just the DesignTokens for a project (or undefined
 * if no tokens are available). Suitable for cheap consumer code that
 * doesn't need the artifact id / hash.
 */
export function selectPreferredDesignTokens(
    state: MinimalArtifactState,
    projectId: string,
): DesignTokens | undefined {
    return selectPreferredDesignSystem(state, projectId)?.tokens;
}
