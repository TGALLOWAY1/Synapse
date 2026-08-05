// Shared priority-chip styling for screen surfaces (Screen Inventory cards,
// Experience workspace list rows and detail header). Lives in its own module
// (not in ScreenInventoryRenderer.tsx) so component files keep exporting only
// components — the react-refresh/only-export-components rule.

import type { ScreenPriority } from '../../types';

export const PRIORITY_STYLES: Record<ScreenPriority, string> = {
    P0: 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200',
    P1: 'bg-sky-100 text-sky-700 ring-1 ring-sky-200',
    P2: 'bg-neutral-100 text-neutral-600 ring-1 ring-neutral-200',
    P3: 'bg-neutral-50 text-muted ring-1 ring-neutral-100',
};

/** Plain-language definition per priority, surfaced as the chip tooltip so a
 * first-time PM never has to decode "P0" from context. */
export const PRIORITY_DEFINITIONS: Record<ScreenPriority, string> = {
    P0: 'P0 — must-have: the product does not work without this screen',
    P1: 'P1 — important: build soon after the must-haves',
    P2: 'P2 — nice-to-have: schedule when capacity allows',
    P3: 'P3 — optional polish: fine to defer',
};

/** Coerce a possibly-legacy priority value to one that has a style entry. */
export const stylablePriority = (priority: string): ScreenPriority =>
    (priority in PRIORITY_STYLES ? priority : 'P1') as ScreenPriority;
