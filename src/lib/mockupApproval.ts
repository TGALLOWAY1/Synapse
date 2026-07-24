// Flow-approval gate for mockup image generation.
//
// Mockup *specs* (the per-screen list) are derived deterministically from the
// upstream inventory the moment a spine settles, but the costly visual step —
// OpenAI image generation — no longer fires automatically. Instead the user
// first reviews the user flows and approves which screens should have mockups
// rendered. That approval is recorded as a per-version overlay in the mockup
// ArtifactVersion's `metadata` (the same overlay pattern as screenEdits /
// extraScreens — it travels with the artifact through sync + snapshots, so no
// new persisted collection is introduced).
//
// This module is a pure read/derive layer: it reads the overlay, decides
// whether a version is approved, and computes the per-screen recommendation
// that seeds the approval checklist. Nothing here mutates state or renders.

import type { MockupPayload, MockupScreen, ScreenPriority } from '../types';

/** Per-version approval overlay, stored under `metadata.mockupApproval`. */
export interface MockupApprovalOverlay {
    /** Epoch ms the user approved this version's flows + screen selection. */
    approvedAt: number;
    /** MockupScreen.id values the user approved for image generation. */
    approvedScreenIds: string[];
    /** The user checked "I've reviewed the user flows" before approving. */
    flowsReviewed: boolean;
}

const isStringArray = (v: unknown): v is string[] =>
    Array.isArray(v) && v.every(x => typeof x === 'string');

/**
 * Read the approval overlay from a mockup version's metadata. Returns null when
 * absent or malformed (legacy versions, hand-edited state) so callers can treat
 * "no readable approval" uniformly.
 */
export function readMockupApproval(
    metadata?: Record<string, unknown>,
): MockupApprovalOverlay | null {
    const raw = metadata?.mockupApproval;
    if (!raw || typeof raw !== 'object') return null;
    const obj = raw as Record<string, unknown>;
    if (typeof obj.approvedAt !== 'number') return null;
    if (!isStringArray(obj.approvedScreenIds)) return null;
    return {
        approvedAt: obj.approvedAt,
        approvedScreenIds: obj.approvedScreenIds,
        flowsReviewed: obj.flowsReviewed === true,
    };
}

/** True once the user has recorded a flow-approval for this mockup version. */
export function isMockupApproved(metadata?: Record<string, unknown>): boolean {
    return readMockupApproval(metadata) !== null;
}

export interface MockupScreenRecommendation {
    screen: MockupScreen;
    /** Whether this screen is pre-checked in the approval checklist. */
    recommended: boolean;
    /** Short human label explaining the recommendation (e.g. "P0 · core screen"). */
    reason: string;
}

// P2/P3 screens are supporting surfaces — the payload rarely contains them (the
// key_workflow scope curates to P0/P1), but when a broader scope does, they are
// offered unchecked so the user opts in rather than out. Everything else —
// P0, P1, or an unlabelled/placeholder screen — is recommended by default.
const recommendationFor = (
    priority: ScreenPriority | undefined,
): { recommended: boolean; reason: string } => {
    switch (priority) {
        case 'P0':
            return { recommended: true, reason: 'P0 · core screen' };
        case 'P1':
            return { recommended: true, reason: 'P1 · key workflow' };
        case 'P2':
            return { recommended: false, reason: 'P2 · supporting' };
        case 'P3':
            return { recommended: false, reason: 'P3 · supporting' };
        default:
            return { recommended: true, reason: 'Recommended' };
    }
};

/**
 * Compute the per-screen recommendation that seeds the approval checklist.
 * Mirrors the existing priority-first selection the mockup spec already uses,
 * surfaced so the user sees *why* each screen is pre-checked and can toggle it.
 */
export function buildMockupScreenRecommendations(
    payload: MockupPayload,
): MockupScreenRecommendation[] {
    return payload.screens.map(screen => ({
        screen,
        ...recommendationFor(screen.priority),
    }));
}

/** The screen ids recommended (pre-checked) by default. */
export function recommendedScreenIds(payload: MockupPayload): string[] {
    return buildMockupScreenRecommendations(payload)
        .filter(r => r.recommended)
        .map(r => r.screen.id);
}
