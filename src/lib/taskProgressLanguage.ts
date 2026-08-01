/**
 * The user-facing vocabulary for implementation-task progress:
 * **planned → started → implemented (self-reported)**.
 *
 * SELF-REPORTED, AND SAID OUT LOUD (plan §W8 of
 * docs/ARTIFACT_READINESS_RESOLUTION_PLAN.md). Synapse ends at the plan +
 * prompts handoff — it never runs a build, a test, or a command — so it holds
 * no evidence that any task was actually implemented. Every state below is
 * something the USER ticked. That is why the terminal state is named
 * "Implemented (self-reported)" rather than "Done" or "Complete", and why
 * `TASK_PROGRESS_SELF_REPORTED_NOTE` renders ONCE next to the checkboxes
 * instead of as a modal or a per-row badge.
 *
 * PRESENTATION ONLY. Nothing here migrates or rewrites persisted state: the
 * stored vocabulary (`TaskStatus`: todo / in_progress / done / blocked) is
 * unchanged, so older projects, exports, snapshots, and the plan markdown
 * round-trip keep working. This module is the single place those stored values
 * become words. `blocked` is import-only (structured-plan imports set it; no UI
 * writes it) and still has to render, and an unrecognized value — a
 * hand-edited or newer-build localStorage record — falls back to the
 * least-claiming state rather than rendering blank.
 *
 * NOT EVIDENCE. Build-packet readiness must never read a task's progress; see
 * the rule in `lib/planning/buildPacketReadiness.ts`'s header.
 */

import type { TaskStatus } from '../types';

export type TaskProgressCopy = {
    /** Short name, for counts and compact chips. */
    label: string;
    /** Full state name — used wherever the state is named on its own. */
    longLabel: string;
    /** What the checklist toggle does next, for its accessible name. */
    nextAction: string;
};

const TASK_PROGRESS_LANGUAGE: Record<TaskStatus, TaskProgressCopy> = {
    todo: { label: 'Planned', longLabel: 'Planned', nextAction: 'mark it started' },
    in_progress: { label: 'Started', longLabel: 'Started', nextAction: 'mark it implemented' },
    done: {
        label: 'Implemented',
        longLabel: 'Implemented (self-reported)',
        nextAction: 'reset it to planned',
    },
    blocked: { label: 'Blocked', longLabel: 'Blocked', nextAction: 'reset it to planned' },
};

// Keyed by the raw persisted string so an unknown legacy value can be detected
// without an unsafe index cast.
const BY_STORED_VALUE = new Map<string, TaskProgressCopy>(
    Object.entries(TASK_PROGRESS_LANGUAGE),
);

/**
 * Words for a stored task status. Accepts any string because persisted
 * localStorage records are not type-checked on read (cross-cutting rule 3's
 * spirit); an unrecognized value reads as "Planned", never as implemented.
 */
export function taskProgressCopy(status: TaskStatus | string | undefined | null): TaskProgressCopy {
    const entry = typeof status === 'string' ? BY_STORED_VALUE.get(status) : undefined;
    return entry ?? TASK_PROGRESS_LANGUAGE.todo;
}

/**
 * True only for the terminal state, which is a USER CLAIM. Never treat this as
 * evidence that something was built, tested, or verified.
 */
export const isSelfReportedImplemented = (
    status: TaskStatus | string | undefined | null,
): boolean => status === 'done';

/** True for the mid state — work the user says is underway. */
export const isSelfReportedStarted = (
    status: TaskStatus | string | undefined | null,
): boolean => status === 'in_progress';

/**
 * The one line that states, at the point of use, that Synapse does not verify
 * execution. Render it ONCE per progress surface — never per row.
 */
export const TASK_PROGRESS_SELF_REPORTED_NOTE =
    'Progress is self-reported — Synapse hands off the plan and prompts, and never runs or verifies your build.';
