// Pure gating logic for the setup-stage design selection step. Kept out of
// ProjectWorkspace so the setup-flow state transitions are unit-testable.

import type { Project, SpineVersion } from '../types';
import { DEMO_PROJECT_ID } from '../data/demoProject';

/**
 * Whether the workspace should render the design-selection setup step for
 * this project/spine instead of the PRD view.
 *
 * The step shows only for projects created through the new-project flow
 * (`needsDesignSetup`) that haven't chosen a preset yet, once clarification
 * (preflight) is out of the way — i.e. exactly while PRD generation runs in
 * the background, and until the user picks or skips even if the PRD finishes
 * first. It never shows for legacy projects (no flag → finalize-edge gate
 * keeps its original behavior), the demo, blocked spines, or a spine whose
 * generation failed — fully (generationError) or partially (persisted
 * generationMeta.failedSections) — because the error card / incomplete-PRD
 * banner and their Try Again / Run again affordances must stay reachable.
 */
export function shouldShowDesignSetup(
    project: Project | undefined,
    spine: SpineVersion | undefined,
): boolean {
    if (!project || !spine) return false;
    if (project.id === DEMO_PROJECT_ID) return false;
    if (!project.needsDesignSetup) return false;
    if (project.designSystemPreset) return false;
    if (spine.safetyReview?.status === 'blocked') return false;
    if (spine.generationError) return false;
    // A partial-failure run settles WITHOUT a generationError: the pipeline
    // returns a partial PRD and records the failed section ids instead. The
    // PRD view owns the recovery UI for that state (the amber incomplete-PRD
    // banner with per-section "Run again"), so the setup step must yield —
    // otherwise it would claim the PRD is ready and hide recovery until the
    // user makes an unrelated design choice.
    if (spine.generationMeta?.failedSections?.length) return false;
    // Clarification questions come first; the design step takes over the
    // moment the preflight session completes (PRD generation kicks off then).
    const preflight = spine.preflightSession;
    if (preflight && !preflight.completed && !spine.structuredPRD) return false;
    return true;
}
