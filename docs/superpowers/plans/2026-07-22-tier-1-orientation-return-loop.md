# Tier 1 Orientation and Return Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show one useful next action on every project stage and let users capture screen or artifact concerns as deduplicated planning records while returning to the exact review context.

**Architecture:** Extend the existing URL-only `PlanningDestination` contract with bounded screen and stage return targets, then render one pure `planningAttention` strip below the stage rail and remove the duplicate Plan primary action/count. Add one guarded Zustand action that atomically rechecks the exact preferred artifact version, reuses an open record with the same stable source key, or creates one normal user-owned `PlanningRecord`.

**Tech Stack:** React 19, TypeScript 5.9, React Router 7, Zustand 5, Tailwind CSS, Vitest 4, Testing Library, lucide-react.

---

## Scope guard

Implement only Slice 1 from
`docs/superpowers/specs/2026-07-22-tier-1-workflow-simplification-design.md`:

- global next-action strip on Plan, Challenge, Build, and History;
- Plan echo reduction;
- exact screen/tab return targets with safe fallback;
- screen-note and meaningful generated-artifact **Flag to plan** actions;
- dedupe, stale-version refusal, demo/read-only hiding, and accessibility.

Do not add workflow stages, persisted navigation, a flag collection, batch
verdicts, validation acceptance, checkpoint summaries, export changes, or
cleanup work from later slices.

## File map

**Create**

- `src/lib/planning/flagToPlan.ts` — source keys, materiality, input/result
  types, record-input projection.
- `src/components/planning/GlobalNextActionStrip.tsx` — pure global strip.
- `src/components/planning/ArtifactFlagToPlanControl.tsx` — compact accessible
  artifact concern form and success state.
- `src/store/__tests__/flagPlanningConcern.test.ts`
- `src/components/__tests__/GlobalNextActionStrip.test.tsx`
- `src/components/__tests__/ScreenReviewNotesFlagToPlan.test.tsx`
- `src/components/__tests__/ArtifactFlagToPlanControl.test.tsx`
- `src/components/__tests__/ProjectWorkspaceOrientation.test.ts`

**Modify**

- `src/lib/planning/planningNavigation.ts:19-203`
- `src/lib/planning/__tests__/planningNavigation.test.ts:10-79`
- `src/lib/planning/index.ts:1-18`
- `src/components/experience/ScreenDetailTabs.tsx:10-25`
- `src/store/types.ts:387-390`
- `src/store/slices/reviewSlice.ts:47-74,129-141,366-406`
- `src/lib/projectCapabilities.ts:108-132`
- `src/components/ProjectWorkspace.tsx:164-299,564-593,1118-1140,1428-1464,1697-1731`
- `src/components/planning/PlanningStateBar.tsx:1-162`
- `src/components/__tests__/PlanningStateBar.test.tsx:55-157`
- `src/components/experience/ScreenReviewNotes.tsx:18-252`
- `src/components/experience/ScreenDetailView.tsx:80-130,296-307`
- `src/components/ArtifactWorkspace.tsx:90-112,280-316,392-455,933-947,1110-1183,1287-1329,1637-1640`
- `src/components/__tests__/ScreenExperienceViews.test.tsx:313-618`
- `src/components/__tests__/Phase5aRenderedResponsive.test.ts:7-31`
- `docs/architecture/PLANNING_AND_DECISIONS.md:37-69,152-163`
- `docs/architecture/WORKSPACE_AND_ARTIFACTS.md:64-79`
- `docs/architecture/SCREENS_EXPERIENCE.md:55-112`
- `docs/architecture/UI_PATTERNS.md:83-90`
- `README.md:34-47,75-83`

No change is required to `src/types/index.ts`, persistence codecs, bundles, or
`planningAttention.ts`; their existing contracts already carry the required
authority, provenance, and projection.

### Task 1: Extend presentation navigation for exact screen returns

**Files:**

- Modify: `src/lib/planning/planningNavigation.ts:19-203`
- Modify: `src/lib/planning/__tests__/planningNavigation.test.ts:10-79`
- Modify: `src/components/experience/ScreenDetailTabs.tsx:10-25`

- [ ] **Step 1: Write failing exact-screen and fallback tests**

Add these cases and import `planningReturnTargetForSurface`:

```ts
it('round-trips a bounded exact screen return', () => {
    const intent: PlanningNavigationIntent = {
        destination: { kind: 'planning_record', recordId: 'record-1' },
        returnTo: {
            destination: {
                kind: 'screen',
                artifactId: 'artifact-screens',
                nodeId: 'screen_inventory',
                screenId: 'scr-checkout',
                tab: 'flow',
                label: 'Checkout · Flow',
            },
            label: 'Back to Checkout',
        },
    };
    expect(parsePlanningNavigationIntent(
        serializePlanningNavigationIntent(intent),
    )).toEqual(intent);
});

it('rejects unknown screen tabs and overlong labels', () => {
    expect(parsePlanningNavigationIntent(JSON.stringify({
        destination: {
            kind: 'screen', nodeId: 'screen_inventory',
            screenId: 'scr-checkout', tab: 'handoff', label: 'Checkout',
        },
    }))).toBeUndefined();
    expect(parsePlanningNavigationIntent(JSON.stringify({
        destination: {
            kind: 'screen', nodeId: 'screen_inventory',
            screenId: 'scr-checkout', label: 'x'.repeat(501),
        },
    }))).toBeUndefined();
});

it('falls back from screen to artifact, Screens, then Build', () => {
    const target = {
        kind: 'screen' as const,
        artifactId: 'artifact-screens',
        nodeId: 'screen_inventory' as const,
        screenId: 'missing',
        label: 'Missing',
    };
    expect(validatePlanningDestination(target, {
        artifactIds: new Set(['artifact-screens']),
        screenIdsByArtifactId: new Map([['artifact-screens', new Set()]]),
    })).toEqual({
        kind: 'artifact', artifactId: 'artifact-screens',
        nodeId: 'screen_inventory',
    });
    expect(validatePlanningDestination(target, {
        artifactIds: new Set(),
    })).toEqual({ kind: 'artifact', nodeId: 'screen_inventory' });
    expect(validatePlanningDestination({
        kind: 'screen', screenId: 'missing', label: 'Missing',
    }, {})).toEqual({ kind: 'workspace' });
});

it('builds return targets for every current stage', () => {
    expect(planningReturnTargetForSurface({ stage: 'prd' }).destination)
        .toEqual({ kind: 'prd' });
    expect(planningReturnTargetForSurface({ stage: 'review' }).destination)
        .toEqual({ kind: 'challenge' });
    expect(planningReturnTargetForSurface({ stage: 'workspace' }).destination)
        .toEqual({ kind: 'workspace' });
    expect(planningReturnTargetForSurface({ stage: 'history' }).destination)
        .toEqual({ kind: 'history' });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- src/lib/planning/__tests__/planningNavigation.test.ts
```

Expected: FAIL because `screen`, `workspace`, `history`,
`screenIdsByArtifactId`, and `planningReturnTargetForSurface` do not exist.

- [ ] **Step 3: Add bounded destination and validation types**

Change the type import to include `PipelineStage`, then add:

```ts
export type PlanningScreenTab = 'overview' | 'flow' | 'mockups';
export type PlanningScreenDestination = {
    kind: 'screen';
    artifactId?: string;
    nodeId?: Extract<ArtifactSlotKey, 'screen_inventory' | 'mockup'>;
    screenId: string;
    tab?: PlanningScreenTab;
    label: string;
};
export type ActivePlanningStage = 'prd' | 'review' | 'workspace' | 'history';
```

Add `PlanningScreenDestination | { kind: 'workspace' } | { kind: 'history' }`
to `PlanningDestination`. Add:

```ts
export const isPlanningScreenTab = (
    value: unknown,
): value is PlanningScreenTab =>
    value === 'overview' || value === 'flow' || value === 'mockups';

const isScreen = (
    value: Partial<PlanningScreenDestination>,
): value is PlanningScreenDestination =>
    nonEmpty(value.screenId)
    && nonEmpty(value.label)
    && optionalString(value.artifactId)
    && (value.nodeId === undefined
        || value.nodeId === 'screen_inventory'
        || value.nodeId === 'mockup')
    && (value.tab === undefined || isPlanningScreenTab(value.tab))
    && Boolean(value.artifactId || value.nodeId);
```

In `isPlanningDestination`:

```ts
if (candidate.kind === 'workspace' || candidate.kind === 'history') return true;
if (candidate.kind === 'screen') {
    return isScreen(candidate as Partial<PlanningScreenDestination>);
}
```

Extend `PlanningNavigationValidationContext`:

```ts
screenIdsByArtifactId?: ReadonlyMap<string, ReadonlySet<string>>;
```

Before artifact validation, add:

```ts
if (destination.kind === 'screen') {
    if (!destination.artifactId && !destination.nodeId) {
        return { kind: 'workspace' };
    }
    const artifactExists = !destination.artifactId
        || !context.artifactIds
        || context.artifactIds.has(destination.artifactId);
    if (!artifactExists) {
        return destination.nodeId
            ? { kind: 'artifact', nodeId: destination.nodeId }
            : { kind: 'workspace' };
    }
    const ids = destination.artifactId
        ? context.screenIdsByArtifactId?.get(destination.artifactId)
        : undefined;
    if (ids && !ids.has(destination.screenId)) {
        return {
            kind: 'artifact',
            artifactId: destination.artifactId,
            nodeId: destination.nodeId,
        };
    }
}
```

- [ ] **Step 4: Add stage/return helpers and canonicalize screen tabs**

Add:

```ts
export function planningStageForDestination(
    destination: PlanningDestination,
): ActivePlanningStage {
    if (destination.kind === 'prd' || destination.kind === 'readiness') return 'prd';
    if (
        destination.kind === 'decision_center'
        || destination.kind === 'planning_record'
        || destination.kind === 'challenge'
    ) return 'review';
    if (destination.kind === 'history') return 'history';
    return 'workspace';
}

export function planningReturnTargetForSurface(input: {
    stage: PipelineStage;
    screen?: Omit<PlanningScreenDestination, 'kind'>;
}): PlanningReturnTarget {
    if (input.stage === 'workspace' && input.screen) {
        return {
            destination: { kind: 'screen', ...input.screen },
            label: `Back to ${input.screen.label}`,
        };
    }
    if (input.stage === 'review') {
        return { destination: { kind: 'challenge' }, label: 'Back to Challenge' };
    }
    if (input.stage === 'workspace' || input.stage === 'mockups'
        || input.stage === 'artifacts') {
        return { destination: { kind: 'workspace' }, label: 'Back to Build' };
    }
    if (input.stage === 'history') {
        return { destination: { kind: 'history' }, label: 'Back to History' };
    }
    return { destination: { kind: 'prd' }, label: 'Back to Plan' };
}
```

Replace `ScreenDetailTabs.tsx`’s local union with:

```ts
import type { PlanningScreenTab } from '../../lib/planning/planningNavigation';
export type ScreenDetailTab = PlanningScreenTab;
```

- [ ] **Step 5: Run tests/build and commit**

Run:

```bash
npm test -- src/lib/planning/__tests__/planningNavigation.test.ts
npm run build
```

Expected: PASS.

```bash
git add src/lib/planning/planningNavigation.ts src/lib/planning/__tests__/planningNavigation.test.ts src/components/experience/ScreenDetailTabs.tsx
git commit -m "feat: add exact screen planning return targets"
```

### Task 2: Add atomic create-or-reuse planning authority

**Files:**

- Create: `src/lib/planning/flagToPlan.ts`
- Create: `src/store/__tests__/flagPlanningConcern.test.ts`
- Modify: `src/lib/planning/index.ts:1-18`
- Modify: `src/store/types.ts:387-390`
- Modify: `src/store/slices/reviewSlice.ts:47-74,129-141,366-406`
- Modify: `src/lib/projectCapabilities.ts:108-132`

- [ ] **Step 1: Write failing store tests**

Seed a project with latest spine `spine-2`, artifact `artifact-screens`, and
preferred/current version `artifact-version-2`, then add:

```ts
it('creates one user record and reuses the same open source', () => {
    const input: FlagPlanningConcernInput = {
        sourceKey: 'screen-note:artifact-screens:artifact-version-2:scr-home:note-1',
        artifactId: 'artifact-screens',
        artifactVersionId: 'artifact-version-2',
        artifactSubtype: 'screen_inventory',
        artifactSlot: 'screen_inventory',
        spineVersionId: 'spine-2',
        title: 'Recovery path is missing',
        statement: 'The error state cannot return to checkout.',
        materiality: 'blocking',
        locator: {
            entityType: 'screen_review_note',
            entityId: 'scr-home:note-1',
        },
    };
    const first = useProjectStore.getState()
        .flagPlanningConcern('project-1', input);
    const second = useProjectStore.getState()
        .flagPlanningConcern('project-1', input);
    expect(first.status).toBe('created');
    expect(second).toEqual({
        status: 'existing',
        planningRecordId: first.status === 'created'
            ? first.planningRecordId
            : '',
    });
    expect(useProjectStore.getState().planningRecords['project-1'])
        .toHaveLength(1);
    expect(useProjectStore.getState().planningRecords['project-1'][0])
        .toMatchObject({
            status: 'open',
            createdBy: 'user',
            affectedArtifactSlots: ['screen_inventory'],
            events: [expect.objectContaining({
                type: 'created', actor: 'user',
            })],
        });
});

it('refuses a changed preferred version without mutation', () => {
    useProjectStore.setState(state => ({
        artifacts: {
            ...state.artifacts,
            'project-1': state.artifacts['project-1'].map(artifact => ({
                ...artifact, currentVersionId: 'artifact-version-3',
            })),
        },
    }));
    expect(useProjectStore.getState()
        .flagPlanningConcern('project-1', input))
        .toEqual({ status: 'rejected', reason: 'source_changed' });
    expect(useProjectStore.getState().planningRecords['project-1'])
        .toBeUndefined();
});

it('keeps demo writes guarded at the store boundary', () => {
    expect(() => useProjectStore.getState()
        .flagPlanningConcern(DEMO_PROJECT_ID, input))
        .toThrow(ProjectCapabilityError);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- src/store/__tests__/flagPlanningConcern.test.ts
```

Expected: FAIL because `flagToPlan.ts` and `flagPlanningConcern` do not exist.

- [ ] **Step 3: Create flag types, stable keys, and record projection**

Create `src/lib/planning/flagToPlan.ts`:

```ts
import type {
    ArtifactSlotKey, CoreArtifactSubtype, PlanningRecord,
} from '../../types';
import { planningContentHash } from './planningHash';

export type FlagPlanningConcernInput = {
    sourceKey: string;
    artifactId: string;
    artifactVersionId: string;
    artifactSubtype?: CoreArtifactSubtype;
    artifactSlot: ArtifactSlotKey;
    spineVersionId: string;
    title: string;
    statement: string;
    materiality: NonNullable<PlanningRecord['materiality']>;
    locator: {
        entityType: 'screen_review_note' | 'artifact';
        entityId: string;
    };
};
export type FlagPlanningConcernResult =
    | { status: 'created' | 'existing'; planningRecordId: string }
    | { status: 'rejected'; reason:
        'source_not_found' | 'source_changed' | 'spine_not_found' };

export const screenNotePlanningSourceKey = (input: {
    artifactId: string; artifactVersionId: string;
    screenId: string; noteId: string;
}): string => [
    'screen-note', input.artifactId, input.artifactVersionId,
    input.screenId, input.noteId,
].join(':');

export const artifactConcernPlanningSourceKey = (input: {
    artifactId: string; artifactVersionId: string;
    title: string; statement: string;
}): string => `artifact-concern:${input.artifactId}:${
    input.artifactVersionId
}:${planningContentHash({
    title: input.title.trim().toLowerCase(),
    statement: input.statement.trim().toLowerCase(),
})}`;

export const screenIssueMateriality = (
    severity: 'blocking' | 'review' | 'info',
): NonNullable<PlanningRecord['materiality']> =>
    severity === 'blocking' ? 'blocking'
        : severity === 'info' ? 'low' : 'normal';

export const buildFlagPlanningRecordInput = (
    input: FlagPlanningConcernInput,
): Omit<PlanningRecord, 'id' | 'projectId' | 'createdAt' | 'updatedAt'> => ({
    type: 'open_question',
    status: 'open',
    title: input.title.trim(),
    statement: input.statement.trim(),
    evidence: [{
        id: `evidence:${input.sourceKey}`,
        sourceType: 'artifact',
        sourceId: input.artifactId,
        sourceVersionId: input.artifactVersionId,
        artifactSubtype: input.artifactSubtype,
        locator: input.locator,
        excerpt: input.statement.trim(),
        verified: true,
    }],
    sourceFindingIds: [],
    createdBy: 'user',
    sources: [{
        key: input.sourceKey,
        sourceType: 'artifact',
        sourceId: input.artifactId,
        sourceVersionId: input.artifactVersionId,
        artifactSubtype: input.artifactSubtype,
        locator: input.locator,
    }, {
        key: `prd:${input.spineVersionId}`,
        sourceType: 'prd',
        sourceId: 'prd',
        sourceVersionId: input.spineVersionId,
    }],
    materiality: input.materiality,
    affectedArtifactSlots: [input.artifactSlot],
    sourceState: 'current',
});
```

Export `./flagToPlan` from `src/lib/planning/index.ts`.

- [ ] **Step 4: Add the guarded atomic store action**

Add to `ProjectState`:

```ts
flagPlanningConcern: (
    projectId: string,
    input: import('../lib/planning/flagToPlan').FlagPlanningConcernInput,
) => import('../lib/planning/flagToPlan').FlagPlanningConcernResult;
```

In `reviewSlice.ts`, extract the current `createPlanningRecord` object-building
body into `createPlanningRecordValue(projectId, input, now = Date.now())`, and
use it from both creation actions. Add:

```ts
flagPlanningConcern: (projectId, input) => {
    let outcome: FlagPlanningConcernResult = {
        status: 'rejected', reason: 'source_not_found',
    };
    set(state => {
        const records = state.planningRecords[projectId] ?? [];
        const existing = records.find(record => {
            const status = projectDecision(normalizePlanningRecord(record)).status;
            return (status === 'open' || status === 'proposed')
                && record.sources?.some(source => source.key === input.sourceKey);
        });
        if (existing) {
            outcome = { status: 'existing', planningRecordId: existing.id };
            return state;
        }
        const artifact = (state.artifacts[projectId] ?? [])
            .find(item => item.id === input.artifactId);
        const version = (state.artifactVersions[projectId] ?? [])
            .find(item => item.id === input.artifactVersionId
                && item.artifactId === input.artifactId);
        if (!artifact || !version) return state;
        if (artifact.currentVersionId !== version.id || !version.isPreferred) {
            outcome = { status: 'rejected', reason: 'source_changed' };
            return state;
        }
        if (!(state.spineVersions[projectId] ?? [])
            .some(spine => spine.id === input.spineVersionId)) {
            outcome = { status: 'rejected', reason: 'spine_not_found' };
            return state;
        }
        const record = createPlanningRecordValue(
            projectId, buildFlagPlanningRecordInput(input),
        );
        outcome = { status: 'created', planningRecordId: record.id };
        return {
            planningRecords: {
                ...state.planningRecords,
                [projectId]: [...records, record],
            },
        };
    });
    return outcome;
},
```

Add `'flagPlanningConcern'` to `ReviewSlice` and beside
`'createPlanningRecord'` in `PERSISTENT_STORE_ACTIONS`. Keep the existing
`createPlanningRecord` tests passing after the constructor extraction.

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
npm test -- src/store/__tests__/flagPlanningConcern.test.ts src/store/__tests__/reviewSlice.test.ts
```

Expected: PASS.

```bash
git add src/lib/planning/flagToPlan.ts src/lib/planning/index.ts src/store/types.ts src/store/slices/reviewSlice.ts src/lib/projectCapabilities.ts src/store/__tests__/flagPlanningConcern.test.ts
git commit -m "feat: add guarded flag-to-plan records"
```

### Task 3: Add the global strip and remove the Plan echo

**Files:**

- Create: `src/components/planning/GlobalNextActionStrip.tsx`
- Create: `src/components/__tests__/GlobalNextActionStrip.test.tsx`
- Create: `src/components/__tests__/ProjectWorkspaceOrientation.test.ts`
- Modify: `src/components/ProjectWorkspace.tsx:164-299,1118-1140,1428-1464,1697-1731`
- Modify: `src/components/planning/PlanningStateBar.tsx:1-162`
- Modify: `src/components/__tests__/PlanningStateBar.test.tsx:55-157`

- [ ] **Step 1: Write failing strip and placement tests**

Test the standalone component:

```tsx
render(<GlobalNextActionStrip attention={attention} onOpen={onOpen} />);
expect(screen.getByRole('region', { name: 'Project next action' }))
    .toBeInTheDocument();
expect(screen.getByLabelText('3 open planning items'))
    .toHaveTextContent('3 open');
const action = screen.getByRole('button', { name: 'Make this decision' });
expect(action).toHaveClass('min-h-11', 'w-full', 'sm:w-auto');
fireEvent.click(action);
expect(onOpen).toHaveBeenCalledWith({
    kind: 'planning_record', recordId: 'record-1',
});
```

Create `ProjectWorkspaceOrientation.test.ts`:

```ts
const workspace = readFileSync(
    resolve(process.cwd(), 'src/components/ProjectWorkspace.tsx'), 'utf8',
);
it('places one global strip after the rail and before stage content', () => {
    const rail = workspace.indexOf('<PipelineStageBar');
    const strip = workspace.indexOf('<GlobalNextActionStrip');
    const main = workspace.indexOf('{/* Main Workspace Area');
    expect(strip).toBeGreaterThan(rail);
    expect(strip).toBeLessThan(main);
    expect(workspace.match(/<GlobalNextActionStrip/g)).toHaveLength(1);
});
it('does not pass global primary props into PlanningStateBar', () => {
    const start = workspace.indexOf('<PlanningStateBar');
    const props = workspace.slice(start, workspace.indexOf('/>', start));
    expect(props).not.toContain('attention=');
    expect(props).not.toContain('onOpenAttention=');
    expect(props).not.toContain('onNextAction=');
});
```

Update `PlanningStateBar.test.tsx` to expect no “Make this decision”, “2
unresolved”, “1 conflict”, “Start here”, or “Other items needing attention”,
while retaining the singular/plural Sharpen and readiness-details tests.

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npm test -- src/components/__tests__/GlobalNextActionStrip.test.tsx src/components/__tests__/ProjectWorkspaceOrientation.test.ts src/components/__tests__/PlanningStateBar.test.tsx
```

Expected: FAIL because the strip is missing and Plan still repeats the primary
action/count.

- [ ] **Step 3: Implement the pure strip**

Create:

```tsx
import { ArrowRight, Compass } from 'lucide-react';
import type {
    PlanningAttentionSummary, PlanningDestination,
} from '../../lib/planning';

export function GlobalNextActionStrip(props: {
    attention: PlanningAttentionSummary;
    onOpen: (destination: PlanningDestination) => void;
}) {
    const primary = props.attention.primary;
    if (!primary) return null;
    const count = props.attention.totalCount;
    return (
        <section
            aria-label="Project next action"
            className="shrink-0 border-b border-indigo-100 bg-indigo-50/80 px-4 py-3"
        >
            <div className="mx-auto flex max-w-screen-2xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-3">
                    <Compass size={18} aria-hidden="true"
                        className="mt-0.5 shrink-0 text-indigo-600" />
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-indigo-950">
                                {primary.title}
                            </p>
                            <span
                                aria-label={`${count} open planning ${
                                    count === 1 ? 'item' : 'items'
                                }`}
                                className="rounded-full border border-indigo-200 bg-white px-2 py-0.5 text-xs font-semibold text-indigo-700"
                            >
                                {count} open
                            </span>
                        </div>
                        <p className="mt-0.5 text-xs text-indigo-800">
                            Open items guide the next pass and do not block progress.
                        </p>
                    </div>
                </div>
                <button type="button"
                    onClick={() => props.onOpen(primary.destination)}
                    className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white sm:w-auto">
                    {primary.actionLabel}<ArrowRight size={15} aria-hidden="true" />
                </button>
            </div>
        </section>
    );
}
```

- [ ] **Step 4: Resolve active surfaces and mount the strip**

In `ProjectWorkspace`, parse current preferred `screen_inventory` versions with
`parseScreenInventory` into:

```ts
const navigationScreens = useMemo(() => {
    const idsByArtifactId = new Map<string, ReadonlySet<string>>();
    const labels = new Map<string, string>();
    for (const artifact of navigationArtifacts) {
        if (artifact.subtype !== 'screen_inventory') continue;
        const versions = getArtifactVersions(projectId, artifact.id);
        const version = versions.find(item =>
            item.id === artifact.currentVersionId)
            ?? versions.find(item => item.isPreferred);
        const inventory = version ? parseScreenInventory(version.content) : null;
        if (!inventory) continue;
        const screens = inventory.sections.flatMap(section => section.screens);
        idsByArtifactId.set(
            artifact.id,
            new Set(screens.flatMap(screen => screen.id ? [screen.id] : [])),
        );
        screens.forEach(screen => {
            if (screen.id) labels.set(`${artifact.id}:${screen.id}`, screen.name);
        });
    }
    return { idsByArtifactId, labels };
}, [getArtifactVersions, navigationArtifacts, projectId]);
```

Pass `screenIdsByArtifactId` into `validatePlanningDestination`. Extend
`writePlanningIntent` so `destination.kind === 'screen'` sets `screen` and the
bounded non-overview `screenTab`; all other destinations delete those two
presentation parameters after `returnTo` has been serialized.

Add resolver branches:

```ts
if (destination.kind === 'history') {
    setProjectStage(projectId, 'history');
    return;
}
if (destination.kind === 'workspace') {
    setProjectStage(projectId, 'workspace');
    return;
}
if (destination.kind === 'screen') {
    setWorkspaceInitialNode(destination.nodeId ?? 'screen_inventory');
    setWorkspaceInitialArtifactId(destination.artifactId);
    setSearchParams(current => {
        const next = new URLSearchParams(current);
        next.set('screen', destination.screenId);
        if (destination.tab && destination.tab !== 'overview') {
            next.set('screenTab', destination.tab);
        } else next.delete('screenTab');
        return next;
    }, { replace: true });
    setProjectStage(projectId, 'workspace');
    return;
}
```

Derive `activeSurfaceReturnTarget` with
`planningReturnTargetForSurface({stage: pipelineStage, screen})`; include exact
screen artifact/id/tab/label when current query state resolves. Replace the old
Plan-only global handler with:

```ts
const openPlanningAttention = (destination: PlanningDestination) => {
    const leavesSurface = planningStageForDestination(destination)
        !== planningStageForDestination(activeSurfaceReturnTarget.destination);
    writePlanningIntent({
        destination,
        ...(leavesSurface ? { returnTo: activeSurfaceReturnTarget } : {}),
    });
};
```

Immediately after `PipelineStageBar`, outside every stage branch:

```tsx
<GlobalNextActionStrip
    attention={planningAttention}
    onOpen={openPlanningAttention}
/>
```

- [ ] **Step 5: Remove the Plan duplicate, run, and commit**

Delete `PlanningStateBar`’s `onNextAction`, `attention`, and
`onOpenAttention` props; delete its unresolved/conflict badges, `Start here`,
secondary attention list, and non-Sharpen primary button. Keep commitment,
readiness summary/criteria, downstream alignment, planning tools, and:

```tsx
{calm && onStartSharpen && answerableCount > 0 && (
    <button type="button" onClick={onStartSharpen}
        className="inline-flex min-h-11 items-center justify-center rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white">
        {answerableCount === 1
            ? 'Answer 1 quick question'
            : `Sharpen my plan (${answerableCount} questions)`}
    </button>
)}
```

Run:

```bash
npm test -- src/components/__tests__/GlobalNextActionStrip.test.tsx src/components/__tests__/ProjectWorkspaceOrientation.test.ts src/components/__tests__/PlanningStateBar.test.tsx src/lib/planning/__tests__/planningNavigation.test.ts
```

Expected: PASS.

```bash
git add src/components/planning/GlobalNextActionStrip.tsx src/components/ProjectWorkspace.tsx src/components/planning/PlanningStateBar.tsx src/components/__tests__/GlobalNextActionStrip.test.tsx src/components/__tests__/ProjectWorkspaceOrientation.test.ts src/components/__tests__/PlanningStateBar.test.tsx
git commit -m "feat: show one next action across project stages"
```

### Task 4: Flag screen review notes and return exactly

**Files:**

- Create: `src/components/__tests__/ScreenReviewNotesFlagToPlan.test.tsx`
- Modify: `src/components/experience/ScreenReviewNotes.tsx:18-252`
- Modify: `src/components/experience/ScreenDetailView.tsx:80-130,296-307`
- Modify: `src/components/ArtifactWorkspace.tsx:280-316,933-947,1287-1329`
- Modify: `src/components/__tests__/ScreenExperienceViews.test.tsx:313-618`

- [ ] **Step 1: Write failing note behavior tests**

Render `ScreenReviewNotes` with one blocking issue and assert:

```tsx
fireEvent.click(screen.getByRole('button', { name: /Review notes/ }));
const note = screen.getByText('Recovery path is missing').closest('li')!;
const trigger = within(note).getByRole('button', { name: 'Flag to plan' });
fireEvent.click(trigger);
expect(onFlagToPlan).toHaveBeenCalledWith({
    noteId: 'note-1',
    title: 'Recovery path is missing',
    statement: 'The error state cannot return to checkout.',
    materiality: 'blocking',
});
expect(within(note).getByRole('status')).toHaveTextContent('Added to the plan');
fireEvent.click(within(note).getByRole('button', { name: 'Keep reviewing' }));
expect(trigger).toHaveFocus();
```

Add cases where `existing` renders “Already in the plan”, `source_changed`
renders `role="alert"` without Review now, and `readOnly` renders no Flag button.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- src/components/__tests__/ScreenReviewNotesFlagToPlan.test.tsx
```

Expected: FAIL because the callbacks and action do not exist.

- [ ] **Step 3: Add the optional note action and accessible confirmation**

Export:

```ts
export type ScreenNotePlanningRequest = {
    noteId: string;
    title: string;
    statement: string;
    materiality: 'blocking' | 'high' | 'normal' | 'low';
};
```

Add optional props:

```ts
onFlagToPlan?: (
    request: ScreenNotePlanningRequest,
) => FlagPlanningConcernResult;
onReviewPlanningRecord?: (recordId: string) => void;
```

For each visible issue, add a `min-h-11` **Flag to plan** button only when
`!readOnly && onFlagToPlan`. Call it with the issue ID/title/description and
`screenIssueMateriality(issue.severity)`. Store the trigger in a
`Map<string, HTMLButtonElement>` ref and store the discriminated result in local
state.

On success render:

```tsx
<div role="status" aria-live="polite"
    className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-2">
    <p>{result.status === 'created'
        ? 'Added to the plan' : 'Already in the plan'}</p>
    <button type="button" className="min-h-11"
        onClick={() => {
            setFlagResult(undefined);
            requestAnimationFrame(() => triggerRefs.current.get(issue.id)?.focus());
        }}>
        Keep reviewing
    </button>
    <button type="button" className="min-h-11"
        onClick={() => onReviewPlanningRecord?.(result.planningRecordId)}>
        Review now
    </button>
</div>
```

On rejection render `role="alert"` with “The screen source changed…” for
`source_changed`, otherwise “This screen source is no longer available.”

Thread both optional callbacks through `ScreenDetailView` into
`ScreenReviewNotes`; existing callers remain valid.

- [ ] **Step 4: Create the exact record and return target in ArtifactWorkspace**

Add:

```ts
const flagScreenNote = (
    screenId: string,
    request: ScreenNotePlanningRequest,
): FlagPlanningConcernResult => {
    if (!invArtifact || !invPreferred) {
        return { status: 'rejected', reason: 'source_not_found' };
    }
    return useProjectStore.getState().flagPlanningConcern(projectId, {
        sourceKey: screenNotePlanningSourceKey({
            artifactId: invArtifact.id,
            artifactVersionId: invPreferred.id,
            screenId,
            noteId: request.noteId,
        }),
        artifactId: invArtifact.id,
        artifactVersionId: invPreferred.id,
        artifactSubtype: 'screen_inventory',
        artifactSlot: 'screen_inventory',
        spineVersionId,
        title: request.title,
        statement: request.statement,
        materiality: request.materiality,
        locator: {
            entityType: 'screen_review_note',
            entityId: `${screenId}:${request.noteId}`,
        },
    });
};
```

Pass creation only when
`capabilities.canPersistWorkflowState && invArtifact && invPreferred`. Pass
Review now as:

```tsx
onReviewPlanningRecord={recordId => onOpenPlanningRecord?.(recordId, {
    destination: {
        kind: 'screen',
        artifactId: invArtifact!.id,
        nodeId: 'screen_inventory',
        screenId: detailItem.id,
        tab: screenTab,
        label: `${detailItem.screen.name} · ${
            screenTab === 'flow' ? 'Flow'
                : screenTab === 'mockups' ? 'Mockups' : 'Overview'
        }`,
    },
    label: `Back to ${detailItem.screen.name}`,
})}
```

Creation leaves the current query untouched; only Review now navigates.

- [ ] **Step 5: Run focused tests and commit**

Run:

```bash
npm test -- src/components/__tests__/ScreenReviewNotesFlagToPlan.test.tsx src/components/__tests__/ScreenExperienceViews.test.tsx src/store/__tests__/flagPlanningConcern.test.ts src/lib/planning/__tests__/planningNavigation.test.ts
```

Expected: PASS.

```bash
git add src/components/experience/ScreenReviewNotes.tsx src/components/experience/ScreenDetailView.tsx src/components/ArtifactWorkspace.tsx src/components/__tests__/ScreenReviewNotesFlagToPlan.test.tsx src/components/__tests__/ScreenExperienceViews.test.tsx
git commit -m "feat: flag screen notes to the plan"
```

### Task 5: Flag meaningful artifact details with an accessible compact form

**Files:**

- Create: `src/components/planning/ArtifactFlagToPlanControl.tsx`
- Create: `src/components/__tests__/ArtifactFlagToPlanControl.test.tsx`
- Modify: `src/components/ArtifactWorkspace.tsx:1110-1183,1460-1640`
- Modify: `src/components/__tests__/Phase5aRenderedResponsive.test.ts:16-31`

- [ ] **Step 1: Write failing form and keyboard tests**

Test:

```tsx
fireEvent.click(screen.getByRole('button', {
    name: 'Flag Data Model to plan',
}));
expect(screen.getByLabelText('Concern title')).toHaveFocus();
expect(screen.getByRole('button', { name: 'Add to plan' })).toBeDisabled();
fireEvent.change(screen.getByLabelText('Concern title'), {
    target: { value: '  Ownership is unclear  ' },
});
fireEvent.change(screen.getByLabelText('What should the plan address?'), {
    target: { value: '  The owner relationship has no deletion rule.  ' },
});
fireEvent.click(screen.getByRole('button', { name: 'Add to plan' }));
expect(onCreate).toHaveBeenCalledWith({
    title: 'Ownership is unclear',
    statement: 'The owner relationship has no deletion rule.',
});
```

Add tests for `existing` + Review now, `source_changed` preserving form values,
Tab containment, Escape close, trigger focus restoration, `aria-modal`, and
`min-h-11` controls.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npm test -- src/components/__tests__/ArtifactFlagToPlanControl.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the compact control**

Use this public contract:

```ts
interface ArtifactFlagToPlanControlProps {
    artifactTitle: string;
    onCreate: (input: {
        title: string;
        statement: string;
    }) => FlagPlanningConcernResult;
    onReviewNow: (recordId: string) => void;
}
```

The component owns `open`, `title`, `statement`, and `result`. Its trigger is
`aria-label={\`Flag ${artifactTitle} to plan\`}`. When open, render a responsive
bottom-sheet/centered card with:

```tsx
<div ref={dialogRef} role="dialog" aria-modal="true"
    aria-labelledby={headingId}
    className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl">
    <h2 id={headingId}>Flag {artifactTitle} to plan</h2>
    <label htmlFor={titleId}>Concern title</label>
    <input ref={titleRef} id={titleId} value={title}
        onChange={event => setTitle(event.target.value)}
        className="min-h-11 w-full" />
    <label htmlFor={statementId}>What should the plan address?</label>
    <textarea id={statementId} value={statement}
        onChange={event => setStatement(event.target.value)} rows={4} />
    <button type="button" className="min-h-11"
        disabled={!title.trim() || !statement.trim()}
        onClick={() => setResult(onCreate({
            title: title.trim(), statement: statement.trim(),
        }))}>
        Add to plan
    </button>
</div>
```

On `created`/`existing`, replace the form body with `role="status"`, honest
Added/Already copy, **Keep reviewing**, and **Review now**. On rejection, keep
the form and render `role="alert"`. In an `open` effect, focus `titleRef`, close
on Escape, cycle Tab/Shift+Tab over enabled controls inside `dialogRef`, remove
the listener on cleanup, and restore `triggerRef` focus. Every button is
`min-h-11`; mobile actions use `w-full sm:w-auto`.

- [ ] **Step 4: Mount only on meaningful writable generated details**

Change `renderVersionControls`’s `preferred` parameter to the existing
`ArtifactVersion` type. Resolve:

```ts
const artifact = getArtifact(projectId, artifactId);
const artifactSlot = artifact?.type === 'mockup'
    ? 'mockup'
    : artifact?.type === 'core_artifact'
        ? artifact.subtype
        : undefined;
```

Beside Version history:

```tsx
{artifact && artifactSlot && capabilities.canPersistWorkflowState && (
    <ArtifactFlagToPlanControl
        artifactTitle={artifact.title}
        onCreate={({ title, statement }) =>
            useProjectStore.getState().flagPlanningConcern(projectId, {
                sourceKey: artifactConcernPlanningSourceKey({
                    artifactId: artifact.id,
                    artifactVersionId: preferred.id,
                    title,
                    statement,
                }),
                artifactId: artifact.id,
                artifactVersionId: preferred.id,
                artifactSubtype: artifact.type === 'core_artifact'
                    ? artifact.subtype : undefined,
                artifactSlot,
                spineVersionId,
                title,
                statement,
                materiality: 'normal',
                locator: {
                    entityType: 'artifact',
                    entityId: artifact.id,
                },
            })}
        onReviewNow={recordId => onOpenPlanningRecord?.(recordId, {
            destination: {
                kind: 'artifact',
                artifactId: artifact.id,
                nodeId: artifactSlot,
            },
            label: `Back to ${artifact.title}`,
        })}
    />
)}
```

This naturally excludes PRD, empty/queued/error slots, hidden artifacts without
a detail view, and demo/read-only projects.

- [ ] **Step 5: Run tests and commit**

Add a responsive source assertion for `min-h-11`, `aria-modal`, mobile stacking,
and `capabilities.canPersistWorkflowState`, then run:

```bash
npm test -- src/components/__tests__/ArtifactFlagToPlanControl.test.tsx src/components/__tests__/Phase5aRenderedResponsive.test.ts src/store/__tests__/flagPlanningConcern.test.ts
```

Expected: PASS.

```bash
git add src/components/planning/ArtifactFlagToPlanControl.tsx src/components/ArtifactWorkspace.tsx src/components/__tests__/ArtifactFlagToPlanControl.test.tsx src/components/__tests__/Phase5aRenderedResponsive.test.ts
git commit -m "feat: flag artifact concerns to the plan"
```

### Task 6: Document Slice 1 behavior

**Files:**

- Modify: `docs/architecture/PLANNING_AND_DECISIONS.md:37-69,152-163`
- Modify: `docs/architecture/WORKSPACE_AND_ARTIFACTS.md:64-79`
- Modify: `docs/architecture/SCREENS_EXPERIENCE.md:55-112`
- Modify: `docs/architecture/UI_PATTERNS.md:83-90`
- Modify: `README.md:34-47,75-83`

- [ ] **Step 1: Update architecture contracts**

Document these exact rules:

```markdown
- `GlobalNextActionStrip` is the one project-wide orientation surface. It
  renders immediately below `PipelineStageBar`, reads
  `derivePlanningAttention().primary`, owns the only global raw attention
  count, and never writes planning authority.
- `PlanningStateBar` retains Plan commitment/readiness context, criteria,
  planning tools, and Sharpen. It does not repeat the strip's primary action,
  title, or aggregate count.
- `flagPlanningConcern` rechecks one exact preferred artifact version inside
  the store updater and reuses an open/proposed record with the same stable
  source key before creating one user-owned open record.
- `screen`, `workspace`, and `history` navigation destinations are URL-only.
  Missing screen targets degrade to their owning artifact/Screens, then Build.
```

In Screens docs, record the source-key format
`screen-note:<artifact>:<version>:<screen>:<note>`, stay-on-screen creation,
exact-tab Review-now return, and read-only hiding. In workspace docs, record the
title/statement artifact form and version check. In UI patterns, record the
labeled region, mobile stack, one primary button, focus restoration, and 44px
touch targets.

- [ ] **Step 2: Update README journey copy**

Add this feature row:

```markdown
| 🧭 | **Always know the next useful step** | A calm project-wide strip keeps one highest-value action visible across Plan, Challenge, Build, and History. Open items guide the next pass without blocking exploration or generation. |
```

After the asset journey step add:

```markdown
While reviewing a generated screen or artifact, **Flag to plan** captures the
exact concern as a planning record; you can keep reviewing or open it now and
return to the same screen and tab.
```

No tour asset update is required: Slice 1 does not change the tour’s staged
teaching flow or invalidate its existing claims.

- [ ] **Step 3: Verify docs and commit**

Run:

```bash
rg -n "GlobalNextActionStrip|Flag to plan|screen-note:" docs/architecture README.md
git diff --check
```

Expected: results describe the global strip, dedupe, and exact return; diff
check prints nothing.

```bash
git add docs/architecture/PLANNING_AND_DECISIONS.md docs/architecture/WORKSPACE_AND_ARTIFACTS.md docs/architecture/SCREENS_EXPERIENCE.md docs/architecture/UI_PATTERNS.md README.md
git commit -m "docs: explain the orientation and return loop"
```

### Task 7: Run Slice 1 regression gates

**Files:**

- Verify all files from Tasks 1–6

- [ ] **Step 1: Run the focused Slice 1 suite**

```bash
npm test -- src/lib/planning/__tests__/planningNavigation.test.ts src/store/__tests__/flagPlanningConcern.test.ts src/components/__tests__/GlobalNextActionStrip.test.tsx src/components/__tests__/ProjectWorkspaceOrientation.test.ts src/components/__tests__/PlanningStateBar.test.tsx src/components/__tests__/ScreenReviewNotesFlagToPlan.test.tsx src/components/__tests__/ScreenExperienceViews.test.tsx src/components/__tests__/ArtifactFlagToPlanControl.test.tsx src/components/__tests__/Phase5aRenderedResponsive.test.ts
```

Expected: PASS with no unhandled errors.

- [ ] **Step 2: Run repository gates**

```bash
npm test
npm run build
npm run lint
git diff --check
```

Expected: all PASS; `git diff --check` prints nothing.

- [ ] **Step 3: Inspect persistence and scope**

```bash
git diff HEAD~6 -- src/types/index.ts src/store/projectStore.ts src/store/persistCodec.ts
git status --short
```

Expected: the persistence/type diff prints nothing and the worktree is clean
after six implementation/documentation commits.

- [ ] **Step 4: Perform the focused manual check**

Run:

```bash
npm run dev
```

Expected: Vite reports a local URL. At that URL verify:

1. each current stage has one strip below the rail;
2. Plan has no repeated primary action/count and Sharpen still works;
3. screen-note creation stays on the current screen/tab;
4. Review now and Back round-trip to that exact screen/tab;
5. a deleted screen falls back to Screens/Build;
6. a repeated flag reuses the current open record;
7. a stale preferred version writes nothing and explains the refresh;
8. demo/read-only projects show no mutation controls;
9. mobile controls stack and remain at least 44px;
10. Keep reviewing and Escape restore focus.

Do not run visual e2e automatically; repository policy requires an explicit
viewport and scope.

- [ ] **Step 5: Commit a verification correction only when needed**

If manual verification finds a focused defect, add only the affected source and
its focused test, rerun Step 1, and commit:

```bash
git commit -m "fix: close orientation return loop regression"
```

If verification passes unchanged, do not create an empty commit.
