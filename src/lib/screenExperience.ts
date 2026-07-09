// Pure join layer for the screen-centric Experience workspace.
//
// The Experience view treats each Screen (from the screen_inventory artifact)
// as the canonical object and joins the other two experience artifacts onto it
// **at render time**:
//
//   - user_flows steps reference screens via the bracketed `[Screen Name]`
//     step-title convention (see parseFlow.ts / the user_flows prompt);
//   - mockup screens copy their `name` from the inventory screen they were
//     derived from (see mockupService.generateMockup).
//
// There is no persisted screen id anywhere, so the MVP join key is the same
// slug the per-screen image stores already use: `slugifyScreenName(name)`.
// Nothing here is persisted — this module is a read-side index over artifact
// contents that already live in the store. It must stay pure (no Zustand, no
// IDB, no React) so it can be unit-tested in isolation.

import type {
    MockupPayload,
    MockupScreen,
    ScreenInventoryContent,
    ScreenItem,
    ScreenPriority,
    ScreenReviewChecklist,
    ScreenReviewMeta,
    ScreenReviewSignature,
} from '../types';
import { slugifyScreenName } from './screenInventoryImageStore';
import type {
    ParsedFlow,
    ParsedStep,
} from '../components/renderers/userFlows/types';
import { inferNodeKind, stripScreenSeedPrefix } from '../components/renderers/userFlows/journeyNode';

/**
 * User edit overlay for one screen, keyed by the canonical screen id and
 * stored on the screen_inventory ArtifactVersion as `metadata.screenEdits`
 * (the same overlay pattern as prompt_pack's `metadata.promptEdits`). The
 * generated content is never rewritten: renames change only the *displayed*
 * name, while every join and image key derives from the stored generated
 * name — which is what makes renames unable to orphan relationships.
 */
export interface ScreenMetadataEdit {
    name?: string;
    purpose?: string;
    userIntent?: string;
    priority?: ScreenPriority;
    /** Free-form user notes shown on the screen's Overview tab. */
    notes?: string;
    /**
     * Explicit user-set review status (see src/lib/screenReadiness.ts).
     * Absent → the Screens view derives a status from the spec instead.
     * Optional & backward-compatible like every other overlay field.
     */
    reviewStatus?: 'draft' | 'needs_review' | 'accepted' | 'implementation_ready';
    /**
     * User-set status per mockup variant row (see buildMockupVariantRows in
     * src/lib/screenReadiness.ts), keyed by the deterministic variant row id.
     * 'accepted' = the user confirmed the variant is good; 'not_needed' =
     * the recommended variant is deliberately skipped (it stops counting as
     * a readiness gap). Absent entries stay derived.
     */
    mockupVariantStatus?: Record<string, 'accepted' | 'not_needed'>;
    /**
     * Phase 4A: supporting review record (checklist, note, override reason,
     * sign-off signature, transition timestamps). The review *status* stays in
     * `reviewStatus` above — this is the metadata around it. Optional &
     * back-compat; see ScreenReviewMeta in src/types.
     */
    review?: ScreenReviewMeta;
}

export type ScreenEditsMap = Record<string, ScreenMetadataEdit>;

const VALID_EDIT_PRIORITIES: ReadonlySet<string> = new Set(['P0', 'P1', 'P2', 'P3']);
const VALID_REVIEW_STATUSES: ReadonlySet<string> = new Set([
    'draft', 'needs_review', 'accepted', 'implementation_ready',
]);

/** Overlay keys this module understands. Anything else is preserved verbatim
 * (forward compatibility — an older build must never drop a newer build's
 * overlay fields on a read-modify-write). */
const KNOWN_EDIT_KEYS: ReadonlySet<string> = new Set([
    'name', 'purpose', 'userIntent', 'priority', 'notes', 'reviewStatus', 'mockupVariantStatus', 'review',
]);
const VALID_VARIANT_STATUSES: ReadonlySet<string> = new Set(['accepted', 'not_needed']);
const CHECKLIST_KEYS: ReadonlySet<string> = new Set([
    'purposeMatchesPrd', 'entryExitPathsReviewed', 'statesReviewed', 'risksReviewed',
    'mockupsReviewed', 'mobileReviewed', 'acceptanceCriteriaReviewed', 'developerHandoffReviewed',
]);

/** Parse the Phase 4A review metadata overlay defensively. Returns undefined
 * when nothing usable is present so an empty object never lands on the edit. */
function parseReviewMeta(raw: unknown): ScreenReviewMeta | undefined {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
    const r = raw as Record<string, unknown>;
    const meta: ScreenReviewMeta = {};
    if (r.checklist && typeof r.checklist === 'object' && !Array.isArray(r.checklist)) {
        const checklist: ScreenReviewChecklist = {};
        for (const [k, v] of Object.entries(r.checklist as Record<string, unknown>)) {
            if (CHECKLIST_KEYS.has(k) && typeof v === 'boolean') {
                (checklist as Record<string, boolean>)[k] = v;
            }
        }
        if (Object.keys(checklist).length > 0) meta.checklist = checklist;
    }
    if (typeof r.notes === 'string' && r.notes.trim()) meta.notes = r.notes;
    if (typeof r.overrideReason === 'string' && r.overrideReason.trim()) meta.overrideReason = r.overrideReason;
    if (r.signature && typeof r.signature === 'object' && !Array.isArray(r.signature)) {
        const s = r.signature as Record<string, unknown>;
        if (typeof s.screenContractHash === 'string' && s.screenContractHash) {
            const sig: ScreenReviewSignature = { screenContractHash: s.screenContractHash };
            if (typeof s.prdVersionId === 'string') sig.prdVersionId = s.prdVersionId;
            if (typeof s.screenVersionId === 'string') sig.screenVersionId = s.screenVersionId;
            if (typeof s.designSystemVersionId === 'string') sig.designSystemVersionId = s.designSystemVersionId;
            meta.signature = sig;
        }
    }
    for (const key of ['updatedAt', 'acceptedAt', 'requestedChangesAt', 'implementationReadyAt'] as const) {
        if (typeof r[key] === 'string' && r[key]) meta[key] = r[key] as string;
    }
    return Object.keys(meta).length > 0 ? meta : undefined;
}

/** Safely extract the screenEdits overlay from ArtifactVersion metadata. */
export function readScreenEdits(metadata: Record<string, unknown> | undefined): ScreenEditsMap {
    const raw = metadata?.screenEdits;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_SCREEN_EDITS;
    const out: ScreenEditsMap = {};
    for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const v = value as Record<string, unknown>;
        const edit: ScreenMetadataEdit = {};
        if (typeof v.name === 'string' && v.name.trim()) edit.name = v.name.trim();
        if (typeof v.purpose === 'string') edit.purpose = v.purpose;
        if (typeof v.userIntent === 'string') edit.userIntent = v.userIntent;
        if (typeof v.priority === 'string' && VALID_EDIT_PRIORITIES.has(v.priority)) {
            edit.priority = v.priority as ScreenPriority;
        }
        if (typeof v.notes === 'string') edit.notes = v.notes;
        if (typeof v.reviewStatus === 'string' && VALID_REVIEW_STATUSES.has(v.reviewStatus)) {
            edit.reviewStatus = v.reviewStatus as ScreenMetadataEdit['reviewStatus'];
        }
        if (v.mockupVariantStatus && typeof v.mockupVariantStatus === 'object' && !Array.isArray(v.mockupVariantStatus)) {
            const statuses: Record<string, 'accepted' | 'not_needed'> = {};
            for (const [variantId, status] of Object.entries(v.mockupVariantStatus as Record<string, unknown>)) {
                if (typeof status === 'string' && VALID_VARIANT_STATUSES.has(status)) {
                    statuses[variantId] = status as 'accepted' | 'not_needed';
                }
            }
            if (Object.keys(statuses).length > 0) edit.mockupVariantStatus = statuses;
        }
        const review = parseReviewMeta(v.review);
        if (review) edit.review = review;
        // Preserve unknown fields verbatim so a save round-trip never drops
        // overlay data written by newer code.
        for (const [key, unknownValue] of Object.entries(v)) {
            if (!KNOWN_EDIT_KEYS.has(key) && unknownValue !== undefined) {
                (edit as Record<string, unknown>)[key] = unknownValue;
            }
        }
        if (Object.keys(edit).length > 0) out[id] = edit;
    }
    return Object.keys(out).length > 0 ? out : EMPTY_SCREEN_EDITS;
}

export const EMPTY_SCREEN_EDITS: ScreenEditsMap = {};

/** Apply an edit overlay to a stored screen, producing the effective screen. */
function applyScreenEdit(base: ScreenItem, edit: ScreenMetadataEdit | undefined): ScreenItem {
    if (!edit) return base;
    const effective: ScreenItem = { ...base };
    if (edit.name) effective.name = edit.name;
    if (edit.purpose !== undefined) effective.purpose = edit.purpose;
    if (edit.userIntent !== undefined) effective.userIntent = edit.userIntent;
    if (edit.priority) effective.priority = edit.priority;
    return effective;
}

/** One flow step that references a screen (matched by slug of the step title). */
export interface ScreenFlowRef {
    flow: ParsedFlow;
    /** Index of the flow within the parsed user_flows document. */
    flowIndex: number;
    step: ParsedStep;
    /** `step.index` hoisted for convenience (StepCard anchors key off it). */
    stepIndex: number;
}

/** A canonical screen plus everything the other artifacts say about it. */
export interface ScreenExperienceItem {
    /**
     * Stable canonical screen id — the rename-safe join/selection key.
     * Normally stamped by `assignStableScreenIds` during inventory
     * normalization; derived here with the same precedence (content id →
     * unique slug) as a safety net for inventories that skipped it.
     */
    id: string;
    /** Slug of the STORED generated name — the image/flow join key. Stable
     * across display renames. */
    slug: string;
    /** Effective screen: stored content with the user's edit overlay applied.
     * Views render this. */
    screen: ScreenItem;
    /** The stored generated screen, untouched by edits. Joins and image keys
     * derive from this — pass its name to image galleries as `storageName`. */
    baseScreen: ScreenItem;
    /** True when a user edit overlay applies to this screen. */
    isEdited: boolean;
    /** The applied edit overlay (when isEdited). */
    edit?: ScreenMetadataEdit;
    /** Title of the inventory section the screen belongs to. */
    sectionTitle: string;
    relatedFlows: ScreenFlowRef[];
    /** The matching mockup screen spec, when the mockup payload covers it. */
    mockupScreen?: MockupScreen;
}

/** Inventory section grouping preserved for the Screens list view. */
export interface ScreenExperienceSection {
    title: string;
    description?: string;
    flowSummary?: string;
    items: ScreenExperienceItem[];
}

/** Two or more distinct screen names collapsing to one slug. */
export interface ScreenSlugCollision {
    slug: string;
    names: string[];
}

// --- Reference validation ----------------------------------------------------

export type ScreenReferenceIssueKind =
    /** A flow step that *looks like* a screen (journey node kind `screen`)
     * references a name no canonical screen matches. */
    | 'unmatched_flow_step'
    /** A mockup screen matched no canonical screen (renamed/regenerated
     * inventory, or drifted mockup payload). Repairable via relink. */
    | 'unmatched_mockup_screen'
    /** Two screens collapse to one slug — name-based references are
     * ambiguous between them. */
    | 'slug_collision'
    /** A mockup screen matched by name only (no stable id / explicit link) —
     * works today, but a future rename would detach it. Informational. */
    | 'legacy_name_match';

export interface ScreenReferenceIssue {
    /** Stable key for dismissal persistence. */
    key: string;
    kind: ScreenReferenceIssueKind;
    message: string;
    /** The mockup screen involved (set for mockup-related kinds) — relink target. */
    mockupScreenId?: string;
    /** The canonical screen involved, when one exists. */
    screenId?: string;
}

/**
 * Explicit mockup-screen → canonical-screen repairs, stored on the mockup
 * ArtifactVersion as `metadata.screenLinks` (mockupScreenId → screenId).
 * Highest-priority join key — survives both renames and name drift.
 */
export function readScreenLinks(metadata: Record<string, unknown> | undefined): Record<string, string> {
    const raw = metadata?.screenLinks;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return EMPTY_SCREEN_LINKS;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v === 'string' && v) out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : EMPTY_SCREEN_LINKS;
}

export const EMPTY_SCREEN_LINKS: Record<string, string> = {};

export function formatScreenLabel(screenId: string): string {
    const cleaned = screenId
        .replace(/^(scr|mod|flow|screen)[-_]/i, '')
        .replace(/[-_]+/g, ' ')
        .trim();
    if (!cleaned) return screenId;
    return cleaned.replace(/\b\w/g, c => c.toUpperCase());
}

export function buildMockupCoverage(
    items: readonly ScreenExperienceItem[],
    trueIssueCount = 0,
): MockupCoverageModel {
    const mockedScreens = items.filter(i => i.mockupScreen).length;
    const totalScreens = items.length;
    const unmockedScreens = items
        .filter(i => !i.mockupScreen)
        .map((item): UnmockedScreenCoverageItem => ({
            screenId: item.id,
            screenName: item.screen.name || formatScreenLabel(item.id),
            reason: item.screen.priority === 'P0' ? 'not_generated_yet' : 'supporting_screen',
        }));
    return {
        summary: {
            totalScreens,
            mockedScreens,
            notMockedYetScreens: unmockedScreens.length,
            trueIssues: trueIssueCount,
            coveragePercent: totalScreens > 0 ? Math.round((mockedScreens / totalScreens) * 100) : 0,
        },
        unmockedScreens,
    };
}

/**
 * Dismissed validation-issue keys, stored on the screen_inventory
 * ArtifactVersion as `metadata.dismissedScreenIssues` (the Screens view's
 * home artifact). Per-version, like every other overlay.
 */
export function readDismissedScreenIssues(metadata: Record<string, unknown> | undefined): ReadonlySet<string> {
    const raw = metadata?.dismissedScreenIssues;
    if (!Array.isArray(raw)) return EMPTY_DISMISSED_ISSUES;
    const keys = raw.filter((k): k is string => typeof k === 'string' && k.length > 0);
    return keys.length > 0 ? new Set(keys) : EMPTY_DISMISSED_ISSUES;
}

export const EMPTY_DISMISSED_ISSUES: ReadonlySet<string> = new Set();

export type MockupCoverageStatus =
    | 'mocked'
    | 'not_mocked_yet'
    | 'missing_reference'
    | 'invalid_mockup'
    | 'ambiguous_reference';

export interface UnmockedScreenCoverageItem {
    screenId: string;
    screenName: string;
    reason: 'not_prioritized' | 'supporting_screen' | 'not_generated_yet';
}

export interface MockupCoverageSummary {
    totalScreens: number;
    mockedScreens: number;
    notMockedYetScreens: number;
    trueIssues: number;
    coveragePercent: number;
}

export interface MockupCoverageModel {
    summary: MockupCoverageSummary;
    unmockedScreens: UnmockedScreenCoverageItem[];
}

export interface ScreenExperienceIndex {
    items: ScreenExperienceItem[];
    /** Canonical lookup — id is the stable, rename-safe key. */
    byId: Map<string, ScreenExperienceItem>;
    /** Name-based lookup for artifacts that only know names (flow steps,
     * legacy mockups). First screen wins on slug collision. */
    bySlug: Map<string, ScreenExperienceItem>;
    sections: ScreenExperienceSection[];
    collisions: ScreenSlugCollision[];
    /** Slugs with a canonical screen — used to gate flow-node navigation. */
    availableSlugs: ReadonlySet<string>;
    /** Expected partial mockup coverage, separated from true reference issues. */
    mockupCoverage: MockupCoverageModel;
    /** Non-blocking reference-validation findings (see kinds above). Full,
     * undismissed set — callers filter against readDismissedScreenIssues. */
    issues: ScreenReferenceIssue[];
}

// Stable empty index. Returned for every "no inventory" case so consumers
// (and any memo/selector holding the result) never see a fresh allocation
// for the same empty state — see the Selector-stability rule in CLAUDE.md.
export const EMPTY_SCREEN_EXPERIENCE_INDEX: ScreenExperienceIndex = {
    items: [],
    byId: new Map(),
    bySlug: new Map(),
    sections: [],
    collisions: [],
    availableSlugs: new Set(),
    mockupCoverage: {
        summary: { totalScreens: 0, mockedScreens: 0, notMockedYetScreens: 0, trueIssues: 0, coveragePercent: 0 },
        unmockedScreens: [],
    },
    issues: [],
};

/** Strip surrounding markdown backticks (step titles are often `` `Name` ``). */
const stripBackticks = (text: string): string => text.replace(/^`+|`+$/g, '').trim();

/**
 * Slug of the screen a parsed flow step points at, or null when the step has
 * no usable title. Guarding the empty title matters because
 * `slugifyScreenName('')` falls back to the literal `'screen'`, which could
 * otherwise false-match a real screen that slugs to the same value.
 *
 * The `scr-` screen-seed prefix is stripped (`stripScreenSeedPrefix`) so a step
 * whose bracket carries the canonical spine seed id (`[scr-infographic-library]`
 * — a form the user_flows model sometimes emits instead of the human name)
 * still joins to the `infographic-library` screen. Because this is the single
 * shared key for the flow→screen join, journey grouping, AND flow-node
 * navigation, normalizing it here keeps all three consistent.
 */
export function stepScreenSlug(step: Pick<ParsedStep, 'title'>): string | null {
    const title = step.title ? stripBackticks(step.title) : '';
    if (!title) return null;
    return stripScreenSeedPrefix(slugifyScreenName(title));
}

/**
 * Build the screen-centric index by joining the three experience artifacts.
 * All inputs are the *normalized/parsed* artifact contents:
 *   - `inventory`: `parseScreenInventory(version.content)` (never raw legacy
 *     JSON — normalization maps `groups[]`/legacy priorities upstream);
 *   - `flows`: `parseFlows(version.content)`;
 *   - `mockupPayload`: `tryParsePayload(version)`.
 * Any of them may be null/empty; the index degrades gracefully (no inventory
 * → the stable empty index; no flows/mockup → items with empty relations).
 * On slug collision the first screen in inventory order wins `bySlug`; the
 * colliding names are surfaced in `collisions` for the UI to warn about.
 * `edits` is the per-version user overlay (`readScreenEdits`) — it changes
 * only what views display; every join key stays derived from stored content.
 * `screenLinks` (`readScreenLinks`) are explicit user repairs mapping a
 * mockup screen id to a canonical screen id — the highest-priority match.
 */
export function buildScreenIndex(
    inventory: ScreenInventoryContent | null,
    flows: readonly ParsedFlow[],
    mockupPayload: MockupPayload | null,
    edits: ScreenEditsMap = EMPTY_SCREEN_EDITS,
    screenLinks: Record<string, string> = EMPTY_SCREEN_LINKS,
): ScreenExperienceIndex {
    if (!inventory || !inventory.sections || inventory.sections.length === 0) {
        return EMPTY_SCREEN_EXPERIENCE_INDEX;
    }

    const items: ScreenExperienceItem[] = [];
    const byId = new Map<string, ScreenExperienceItem>();
    const bySlug = new Map<string, ScreenExperienceItem>();
    const namesBySlug = new Map<string, string[]>();
    const sections: ScreenExperienceSection[] = [];

    for (const section of inventory.sections) {
        const sectionItems: ScreenExperienceItem[] = [];
        for (const screen of section.screens ?? []) {
            if (!screen.name) continue;
            const slug = slugifyScreenName(screen.name);
            const names = namesBySlug.get(slug) ?? [];
            names.push(screen.name);
            namesBySlug.set(slug, names);
            // Canonical id: normalization (assignStableScreenIds) stamps one;
            // derive the same way here for inventories that bypassed it, and
            // unique-ify defensively so byId never drops a screen.
            const baseId = (typeof screen.id === 'string' && screen.id.trim()) || slug;
            let id = baseId;
            let n = 2;
            while (byId.has(id)) {
                id = `${baseId}-${n}`;
                n += 1;
            }
            const edit = edits[id];
            const item: ScreenExperienceItem = {
                id,
                slug,
                screen: applyScreenEdit(screen, edit),
                baseScreen: screen,
                isEdited: Boolean(edit),
                edit,
                sectionTitle: section.title,
                relatedFlows: [],
            };
            byId.set(id, item);
            // Name-keyed lookup keeps first-wins semantics on collisions
            // (later same-name screens still exist as items, keyed by id).
            if (!bySlug.has(slug)) bySlug.set(slug, item);
            items.push(item);
            sectionItems.push(item);
        }
        if (sectionItems.length > 0) {
            sections.push({
                title: section.title,
                description: section.description,
                flowSummary: section.flowSummary,
                items: sectionItems,
            });
        }
    }

    if (items.length === 0) return EMPTY_SCREEN_EXPERIENCE_INDEX;

    const issues: ScreenReferenceIssue[] = [];

    // Join flow steps by exact slug of the parsed step title. Substring /
    // fuzzy matching is deliberately avoided: "Sign In" must not match
    // "Sign In Confirmation". (Flows are markdown and only know names.)
    // Screen-looking steps that match nothing become validation issues —
    // grouped per missing name so ten steps don't produce ten warnings.
    const unmatchedFlowSlugs = new Map<string, string>(); // slug → display name
    flows.forEach((flow, flowIndex) => {
        for (const step of flow.steps) {
            const slug = stepScreenSlug(step);
            if (!slug) continue;
            const item = bySlug.get(slug);
            if (item) {
                item.relatedFlows.push({ flow, flowIndex, step, stepIndex: step.index });
            } else if (inferNodeKind(step) === 'screen' && step.title) {
                unmatchedFlowSlugs.set(slug, step.title);
            }
        }
    });
    for (const [slug, name] of unmatchedFlowSlugs) {
        issues.push({
            key: `flowstep:${slug}`,
            kind: 'unmatched_flow_step',
            message: `Unknown screen reference: ${formatScreenLabel(name)}.`,
        });
    }

    // Join mockup screens in three priority passes so an explicit repair or
    // stable id always beats a coincidental name match by another screen:
    //   1. explicit user link (metadata.screenLinks — a persisted repair),
    //   2. stable sourceScreenId (stamped on newly generated payloads),
    //   3. slugified name (legacy fallback — flagged as such).
    // A mockup screen that matches nothing becomes a repairable issue (it
    // stays visible in the legacy mockup viewer either way).
    if (mockupPayload) {
        const unmatched: MockupScreen[] = [];
        const attach = (item: ScreenExperienceItem | undefined, mockupScreen: MockupScreen): boolean => {
            if (!item || item.mockupScreen) return false;
            item.mockupScreen = mockupScreen;
            return true;
        };
        const pending: MockupScreen[] = [];
        for (const mockupScreen of mockupPayload.screens) {
            const linked = screenLinks[mockupScreen.id];
            if (linked && attach(byId.get(linked), mockupScreen)) continue;
            pending.push(mockupScreen);
        }
        const nameFallback: MockupScreen[] = [];
        for (const mockupScreen of pending) {
            if (mockupScreen.sourceScreenId && attach(byId.get(mockupScreen.sourceScreenId), mockupScreen)) continue;
            nameFallback.push(mockupScreen);
        }
        for (const mockupScreen of nameFallback) {
            const item = mockupScreen.name ? bySlug.get(slugifyScreenName(mockupScreen.name)) : undefined;
            if (attach(item, mockupScreen)) {
                issues.push({
                    key: `legacy:${mockupScreen.id}`,
                    kind: 'legacy_name_match',
                    message: `Mockup "${mockupScreen.name}" is matched by name only — a rename would detach it. Relink to pin it to its screen.`,
                    mockupScreenId: mockupScreen.id,
                    screenId: item?.id,
                });
            } else {
                unmatched.push(mockupScreen);
            }
        }
        for (const mockupScreen of unmatched) {
            issues.push({
                key: `mockup:${mockupScreen.id}`,
                kind: 'unmatched_mockup_screen',
                message: `Mockup references missing screen: ${formatScreenLabel(mockupScreen.name)}.`,
                mockupScreenId: mockupScreen.id,
            });
        }
    }

    const collisions: ScreenSlugCollision[] = [];
    for (const [slug, names] of namesBySlug) {
        if (names.length > 1) {
            collisions.push({ slug, names });
            issues.push({
                key: `collision:${slug}`,
                kind: 'slug_collision',
                message: `"${names.join('" and "')}" share the same normalized name — name-based references are ambiguous between them.`,
                screenId: bySlug.get(slug)?.id,
            });
        }
    }

    return {
        items,
        byId,
        bySlug,
        sections,
        collisions,
        availableSlugs: new Set(bySlug.keys()),
        mockupCoverage: buildMockupCoverage(items, issues.filter(i => i.kind !== 'legacy_name_match').length),
        issues,
    };
}

/** Flow refs for one screen regrouped per flow (a screen can appear in
 * several steps of the same flow — the Flow tab renders one section per
 * flow, not per step). */
export interface ScreenFlowGroup {
    flow: ParsedFlow;
    flowIndex: number;
    steps: Array<{ step: ParsedStep; stepIndex: number }>;
}

export function groupFlowRefsByFlow(refs: readonly ScreenFlowRef[]): ScreenFlowGroup[] {
    const byFlow = new Map<number, ScreenFlowGroup>();
    for (const ref of refs) {
        let group = byFlow.get(ref.flowIndex);
        if (!group) {
            group = { flow: ref.flow, flowIndex: ref.flowIndex, steps: [] };
            byFlow.set(ref.flowIndex, group);
        }
        group.steps.push({ step: ref.step, stepIndex: ref.stepIndex });
    }
    return Array.from(byFlow.values());
}
