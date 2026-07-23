# Tier 1 Batch Decisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add guarded batch acceptance for valid Decision Center recommendations and an exact-arrival assumption card with Accept defaults, Review each, and recorded Later actions while preserving one user verdict event per record.

**Architecture:** A pure planning module snapshots semantic batch targets and validates recommendation identity. The existing per-record `appendPlanningDecisionEvent` action gains an optional currentness guard; a reusable coordinator invokes it independently for each record and reports partial results. Decision Center and Plan-stage arrival UI remain orchestration only: no aggregate authority event, persisted card state, eager-cap increase, or batch PRD write.

**Tech Stack:** TypeScript, React 19, Zustand, Vitest, Testing Library, Tailwind CSS

---

## Current-main seams and file map

- Authority: `src/types/index.ts:1501-1565`, `src/store/types.ts:408-418`,
  `src/store/slices/reviewSlice.ts:481-523`.
- Option membership is already checked by
  `src/lib/planning/decisionProjection.ts:194-220`.
- Single-record verdict then impact behavior:
  `src/components/review/useDecisionImpactActions.ts:36-79`.
- One-click recommendation default:
  `src/components/review/DecisionCenter.tsx:425-562`.
- Keep the eager recommendation cap unchanged:
  `src/components/review/ReviewWorkspaceContainer.tsx:35-37,72-89`.
- Assumption import is stable-id/idempotent but returns counts only:
  `src/lib/planning/assumptionImport.ts:26-40,121-221`,
  `src/store/slices/reviewSlice.ts:507-523`.
- Exact Sharpen scoping already uses frozen IDs:
  `src/components/ProjectWorkspace.tsx:1698-1710`.
- Demo/read-only store enforcement is centralized:
  `src/lib/projectCapabilities.ts:108-151`.

Create:

- `src/lib/planning/batchVerdicts.ts`
- `src/lib/planning/__tests__/batchVerdicts.test.ts`
- `src/components/review/useBatchVerdictCoordinator.ts`
- `src/components/__tests__/useBatchVerdictCoordinator.test.tsx`
- `src/lib/planning/assumptionArrival.ts`
- `src/lib/planning/__tests__/assumptionArrival.test.ts`
- `src/components/planning/AssumptionArrivalCard.tsx`
- `src/components/__tests__/AssumptionArrivalCard.test.tsx`

Modify:

- `src/lib/planning/index.ts`
- `src/store/types.ts`
- `src/store/slices/reviewSlice.ts`
- `src/store/__tests__/planningRecords.test.ts`
- `src/store/__tests__/demoReadOnlyMutations.test.ts`
- `src/components/review/planningRecordViews.ts`
- `src/components/review/DecisionCenter.tsx`
- `src/components/review/ReviewWorkspace.tsx`
- `src/components/review/ReviewWorkspaceContainer.tsx`
- `src/components/ProjectWorkspace.tsx`
- focused component tests listed below
- `docs/architecture/PLANNING_AND_DECISIONS.md`
- `docs/architecture/UI_PATTERNS.md`
- `README.md`

### Task 1: Define eligibility, identity, and candidate snapshots

**Files:**

- Create: `src/lib/planning/batchVerdicts.ts`
- Create: `src/lib/planning/__tests__/batchVerdicts.test.ts`
- Modify: `src/lib/planning/index.ts:1-18`

- [ ] **Step 1: Write the failing pure tests**

Create `src/lib/planning/__tests__/batchVerdicts.test.ts` with this fixture and
the four assertions below:

```ts
import { describe, expect, it } from 'vitest';
import type { PlanningRecord } from '../../../types';
import {
  assumptionDefaultBatchCandidate, batchVerdictTargetHash,
  deferBatchCandidate, recommendationBatchCandidate,
  recommendationIdentity, revalidateBatchVerdictCandidate,
} from '../batchVerdicts';

const record = (patch: Partial<PlanningRecord> = {}): PlanningRecord => ({
  id: 'd1', projectId: 'p1', type: 'decision', status: 'open',
  title: 'Account model', statement: 'Choose an account model',
  decisionOptions: [{ id: 'guest', label: 'Guest session' }, { id: 'account', label: 'Account first' }],
  recommendationDetail: { optionId: 'guest', summary: 'Guest session', rationale: 'Lower friction', confidence: 'medium' },
  decisionOptionsProvenance: { authoredBy: 'synapse', model: 'strong', generatedAt: 10 },
  evidence: [], sourceFindingIds: [], createdBy: 'specialist_review',
  createdAt: 1, updatedAt: 10,
  events: [{ id: 'created', planningRecordId: 'd1', type: 'created', actor: 'synapse', at: 1 }],
  ...patch,
});

describe('batch verdict candidates', () => {
  it('requires an unresolved machine recommendation bound to a real option', () => {
    expect(recommendationBatchCandidate(record())).toMatchObject({
      action: 'accept_recommendation', optionId: 'guest',
      answer: 'Guest session', expectedRecommendationIdentity: expect.any(String),
    });
    expect(recommendationBatchCandidate(record({ decisionOptionsProvenance: undefined }))).toBeUndefined();
    expect(recommendationBatchCandidate(record({
      recommendationDetail: { optionId: 'missing', summary: 'Missing' },
    }))).toBeUndefined();
  });

  it('changes identity when meaning changes under the same option id', () => {
    const changed = record({ recommendationDetail: {
      ...record().recommendationDetail!, summary: 'Temporary guest only',
    }});
    expect(recommendationIdentity(changed)).not.toBe(recommendationIdentity(record()));
    expect(batchVerdictTargetHash(changed, 'accept_recommendation'))
      .not.toBe(batchVerdictTargetHash(record(), 'accept_recommendation'));
  });

  it('snapshots the presented assumption default and recorded Later', () => {
    const assumption = record({
      id: 'a1', type: 'assumption', createdBy: 'migration',
      statement: 'Users accept email verification',
      decisionOptions: undefined, recommendationDetail: undefined,
      decisionOptionsProvenance: undefined,
    });
    expect(assumptionDefaultBatchCandidate(assumption)).toMatchObject({
      action: 'accept_default', answer: 'Users accept email verification',
    });
    expect(deferBatchCandidate(assumption)).toMatchObject({ action: 'defer' });
  });

  it('rejects a changed snapshot without treating it as a failure', () => {
    const candidate = recommendationBatchCandidate(record())!;
    const changed = record({ decisionOptionsProvenance: {
      ...record().decisionOptionsProvenance!, generatedAt: 11,
    }});
    expect(revalidateBatchVerdictCandidate(changed, candidate)).toEqual({
      ok: false, reason: 'The recommendation changed before it could be accepted.',
    });
  });
});
```

- [ ] **Step 2: Verify RED**

Run:

```bash
npm test -- src/lib/planning/__tests__/batchVerdicts.test.ts
```

Expected: FAIL with `Cannot find module '../batchVerdicts'`.

- [ ] **Step 3: Implement the pure domain module**

Create `src/lib/planning/batchVerdicts.ts`:

```ts
import type { PlanningRecord } from '../../types';
import { projectDecision } from './decisionProjection';
import { planningContentHash } from './planningHash';

export type BatchVerdictAction = 'accept_recommendation' | 'accept_default' | 'defer';
export type OpenPlanningStatus = 'open' | 'proposed';
export type BatchVerdictGuard = {
  action: BatchVerdictAction;
  expectedStatus: OpenPlanningStatus;
  expectedTargetHash: string;
  expectedSpineVersionId?: string;
};
type Base = BatchVerdictGuard & { recordId: string };
export type BatchVerdictCandidate =
  | (Base & { action: 'accept_recommendation'; optionId: string; answer: string; expectedRecommendationIdentity: string })
  | (Base & { action: 'accept_default'; answer: string })
  | (Base & { action: 'defer' });
export type BatchVerdictItemResult = { recordId: string; reason: string };
export type BatchVerdictResult = {
  succeeded: string[];
  skipped: BatchVerdictItemResult[];
  failed: BatchVerdictItemResult[];
};

const openStatus = (record: PlanningRecord): OpenPlanningStatus | undefined => {
  const status = projectDecision(record).status;
  return status === 'open' || status === 'proposed' ? status : undefined;
};
const presentedDefault = (record: PlanningRecord) =>
  record.statement.trim() || record.title.trim();

export function recommendationIdentity(record: PlanningRecord): string | undefined {
  if (record.type !== 'decision' && record.type !== 'open_question') return;
  const provenance = record.decisionOptionsProvenance;
  const recommendation = record.recommendationDetail;
  const option = record.decisionOptions?.find(item => item.id === recommendation?.optionId);
  if (provenance?.authoredBy !== 'synapse' || !recommendation?.optionId || !option) return;
  return planningContentHash({ provenance, recommendation, option });
}

export function batchVerdictTargetHash(record: PlanningRecord, action: BatchVerdictAction): string {
  const base = {
    id: record.id, type: record.type, status: projectDecision(record).status,
    statement: record.statement, currentSourceStatement: record.currentSourceStatement,
    sourceState: record.sourceState,
  };
  if (action === 'accept_recommendation') {
    return planningContentHash({ ...base, recommendationIdentity: recommendationIdentity(record) });
  }
  if (action === 'accept_default') {
    return planningContentHash({ ...base, answer: presentedDefault(record) });
  }
  return planningContentHash(base);
}

export function recommendationBatchCandidate(
  record: PlanningRecord,
  currentSpineVersionId?: string,
): BatchVerdictCandidate | undefined {
  const expectedStatus = openStatus(record);
  const expectedRecommendationIdentity = recommendationIdentity(record);
  const option = record.decisionOptions?.find(item => item.id === record.recommendationDetail?.optionId);
  if (currentSpineVersionId
    && record.decisionOptionsProvenance?.sourceSpineVersionId !== currentSpineVersionId) return;
  if (!expectedStatus || !expectedRecommendationIdentity || !option) return;
  return {
    recordId: record.id, action: 'accept_recommendation', expectedStatus,
    expectedTargetHash: batchVerdictTargetHash(record, 'accept_recommendation'),
    expectedSpineVersionId: currentSpineVersionId,
    expectedRecommendationIdentity, optionId: option.id, answer: option.label,
  };
}

export function assumptionDefaultBatchCandidate(record: PlanningRecord): BatchVerdictCandidate | undefined {
  const expectedStatus = openStatus(record);
  const answer = presentedDefault(record);
  if (record.type !== 'assumption' || !expectedStatus || !answer) return;
  return {
    recordId: record.id, action: 'accept_default', expectedStatus, answer,
    expectedTargetHash: batchVerdictTargetHash(record, 'accept_default'),
  };
}

export function deferBatchCandidate(record: PlanningRecord): BatchVerdictCandidate | undefined {
  const expectedStatus = openStatus(record);
  if (!expectedStatus) return;
  return {
    recordId: record.id, action: 'defer', expectedStatus,
    expectedTargetHash: batchVerdictTargetHash(record, 'defer'),
  };
}

export function revalidateBatchVerdictCandidate(
  record: PlanningRecord | undefined,
  candidate: BatchVerdictCandidate,
): { ok: true } | { ok: false; reason: string } {
  if (!record) return { ok: false, reason: 'The planning record is no longer available.' };
  if (record.id !== candidate.recordId || openStatus(record) !== candidate.expectedStatus) {
    return { ok: false, reason: 'The planning record was already answered or changed.' };
  }
  if (batchVerdictTargetHash(record, candidate.action) !== candidate.expectedTargetHash) {
    return { ok: false, reason: candidate.action === 'accept_recommendation'
      ? 'The recommendation changed before it could be accepted.'
      : 'The planning record changed before the batch action completed.' };
  }
  return { ok: true };
}
```

Export it from `src/lib/planning/index.ts`:

```ts
export * from './batchVerdicts';
```

- [ ] **Step 4: Verify GREEN and commit**

```bash
npm test -- src/lib/planning/__tests__/batchVerdicts.test.ts
git add src/lib/planning/batchVerdicts.ts src/lib/planning/__tests__/batchVerdicts.test.ts src/lib/planning/index.ts
git commit -m "feat: define guarded batch verdict candidates"
```

Expected: 4 tests PASS, then one commit.

### Task 2: Guard the existing per-record store action

**Files:**

- Modify: `src/store/types.ts:408-418`
- Modify: `src/store/slices/reviewSlice.ts:18-36,481-505`
- Modify: `src/store/__tests__/planningRecords.test.ts:27-59`
- Modify: `src/store/__tests__/demoReadOnlyMutations.test.ts:1-120`

- [ ] **Step 1: Write failing store tests**

Seed a recommended `PlanningRecord`, derive `candidate =
recommendationBatchCandidate(record)`, and add:

```ts
it('writes one guarded event and skips a changed recommendation', () => {
  useProjectStore.setState({ planningRecords: { p1: [recommendedDecision()] } });
  const snapshot = useProjectStore.getState().planningRecords.p1[0];
  const candidate = recommendationBatchCandidate(snapshot)!;
  const saved = useProjectStore.getState().appendPlanningDecisionEvent('p1', snapshot.id, {
    id: 'answer', planningRecordId: snapshot.id, type: 'option_selected',
    actor: 'user', optionId: candidate.optionId, answer: candidate.answer, at: 100,
  }, candidate);
  expect(saved).toEqual({ ok: true, duplicate: false });

  const reopened = { ...snapshot, recommendationDetail: {
    ...snapshot.recommendationDetail!, summary: 'Changed recommendation',
  }};
  useProjectStore.setState({ planningRecords: { p1: [reopened] } });
  const before = useProjectStore.getState().planningRecords.p1;
  expect(useProjectStore.getState().appendPlanningDecisionEvent('p1', snapshot.id, {
    id: 'stale', planningRecordId: snapshot.id, type: 'option_selected',
    actor: 'user', optionId: candidate.optionId, answer: candidate.answer, at: 101,
  }, candidate)).toEqual({
    ok: false, code: 'stale_target',
    reason: 'The planning record changed before this verdict could be recorded.',
  });
  expect(useProjectStore.getState().planningRecords.p1).toBe(before);
});
```

In `demoReadOnlyMutations.test.ts`, seed one demo record and assert the guarded
form still throws:

```ts
expect(() => useProjectStore.getState().appendPlanningDecisionEvent(
  DEMO_PROJECT_ID, 'demo-decision',
  { id: 'unsafe', planningRecordId: 'demo-decision', type: 'custom_answered',
    actor: 'user', answer: 'Unsafe', at: 1 },
  { action: 'accept_default', expectedStatus: 'open', expectedTargetHash: 'x' },
)).toThrow('read-only');
```

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/store/__tests__/planningRecords.test.ts src/store/__tests__/demoReadOnlyMutations.test.ts
```

Expected: FAIL because the action accepts only 3 arguments.

- [ ] **Step 3: Extend the action type and updater**

In `src/store/types.ts`:

```ts
appendPlanningDecisionEvent: (
  projectId: string,
  planningRecordId: string,
  event: DecisionEvent,
  guard?: import('../lib/planning/batchVerdicts').BatchVerdictGuard,
) => { ok: true; duplicate: boolean }
  | { ok: false; reason: string; code?: 'stale_target' };
```

Import `batchVerdictTargetHash` in `reviewSlice.ts`, then replace the action
body with the existing append logic plus this check inside `set`, before
`appendDecisionEvent`:

```ts
const normalized = normalizePlanningRecord(record);
if (guard && (
  projectDecision(normalized).status !== guard.expectedStatus
  || batchVerdictTargetHash(normalized, guard.action) !== guard.expectedTargetHash
  || (guard.expectedSpineVersionId
    && (state.spineVersions[projectId] ?? []).find(spine => spine.isLatest)?.id
      !== guard.expectedSpineVersionId)
)) {
  outcome = {
    ok: false, code: 'stale_target',
    reason: 'The planning record changed before this verdict could be recorded.',
  };
  return state;
}
const result = appendDecisionEvent(normalized, event);
```

When `record` is missing and a guard was supplied, return the same
`stale_target` result. Preserve existing unguarded result shapes and the
existing one-record Zustand transaction.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npm test -- src/store/__tests__/planningRecords.test.ts src/store/__tests__/demoReadOnlyMutations.test.ts
git add src/store/types.ts src/store/slices/reviewSlice.ts src/store/__tests__/planningRecords.test.ts src/store/__tests__/demoReadOnlyMutations.test.ts
git commit -m "feat: guard planning verdicts against stale targets"
```

Expected: both suites PASS; no new persistent action is added.

### Task 3: Implement the shared partial-result coordinator

**Files:**

- Create: `src/components/review/useBatchVerdictCoordinator.ts`
- Create: `src/components/__tests__/useBatchVerdictCoordinator.test.tsx`

- [ ] **Step 1: Write failing hook tests**

Using `renderHook`, two eligible records, and the real project store, cover:

```tsx
it('keeps independent successes and prepares impact only after answered writes', async () => {
  const prepareImpact = vi.fn((id: string) => {
    if (id === 'one') changeRecommendationInStore('two');
  });
  const { result } = renderHook(() => useBatchVerdictCoordinator({
    projectId: 'p1', canWrite: true, prepareImpact,
  }));
  await act(async () => {
    await result.current.runBatch([candidate('one'), candidate('two')]);
  });
  expect(result.current.result).toEqual({
    succeeded: ['one'],
    skipped: [{ recordId: 'two', reason: 'The recommendation changed before it could be accepted.' }],
    failed: [],
  });
  expect(prepareImpact).toHaveBeenCalledOnlyWith('one');
  expect(userEvents('one')).toHaveLength(1);
  expect(userEvents('two')).toHaveLength(0);
});

it('records Later per record, blocks repeat submission, and does nothing read-only', async () => {
  // Hold prepareImpact with a Promise, call runBatch twice, and expect the
  // second call to resolve undefined. Run defer candidates and expect one
  // deferred user event per record with zero prepareImpact calls. Mount again
  // with canWrite:false and expect runBatch to resolve undefined.
});
```

Implement the helper functions in the test file as real store reads/writes; do
not mock `appendPlanningDecisionEvent`.

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/components/__tests__/useBatchVerdictCoordinator.test.tsx
```

Expected: FAIL because the hook module does not exist.

- [ ] **Step 3: Implement the coordinator**

Create `src/components/review/useBatchVerdictCoordinator.ts`:

```ts
import { useCallback, useRef, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { DecisionEvent } from '../../types';
import {
  revalidateBatchVerdictCandidate, type BatchVerdictCandidate,
  type BatchVerdictResult,
} from '../../lib/planning';
import { useProjectStore } from '../../store/projectStore';

const eventFor = (candidate: BatchVerdictCandidate): DecisionEvent => {
  const base = { id: uuidv4(), planningRecordId: candidate.recordId,
    actor: 'user' as const, at: Date.now() };
  if (candidate.action === 'accept_recommendation') return {
    ...base, type: 'option_selected', optionId: candidate.optionId, answer: candidate.answer,
  };
  if (candidate.action === 'accept_default') return {
    ...base, type: 'custom_answered', answer: candidate.answer,
  };
  return { ...base, type: 'deferred' };
};

export function useBatchVerdictCoordinator(input: {
  projectId: string;
  canWrite: boolean;
  prepareImpact: (recordId: string) => void | Promise<void>;
}) {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BatchVerdictResult>();
  const runBatch = useCallback(async (candidates: BatchVerdictCandidate[]) => {
    if (!input.canWrite || inFlight.current || !candidates.length) return;
    inFlight.current = true; setBusy(true); setResult(undefined);
    const next: BatchVerdictResult = { succeeded: [], skipped: [], failed: [] };
    try {
      for (const candidate of candidates) {
        const record = useProjectStore.getState().planningRecords[input.projectId]
          ?.find(item => item.id === candidate.recordId);
        const valid = revalidateBatchVerdictCandidate(record, candidate);
        if (!valid.ok) {
          next.skipped.push({ recordId: candidate.recordId, reason: valid.reason });
          continue;
        }
        try {
          const saved = useProjectStore.getState().appendPlanningDecisionEvent(
            input.projectId, candidate.recordId, eventFor(candidate), candidate);
          if (!saved.ok) {
            (saved.code === 'stale_target' ? next.skipped : next.failed)
              .push({ recordId: candidate.recordId, reason: saved.reason });
            continue;
          }
          next.succeeded.push(candidate.recordId);
          if (candidate.action !== 'defer') await input.prepareImpact(candidate.recordId);
        } catch (error) {
          next.failed.push({ recordId: candidate.recordId,
            reason: error instanceof Error ? error.message : String(error) });
        }
      }
      setResult(next); return next;
    } finally {
      inFlight.current = false; setBusy(false);
    }
  }, [input.canWrite, input.prepareImpact, input.projectId]);
  return { busy, result, runBatch, clearResult: () => setResult(undefined) };
}
```

- [ ] **Step 4: Verify GREEN and commit**

```bash
npm test -- src/components/__tests__/useBatchVerdictCoordinator.test.tsx
git add src/components/review/useBatchVerdictCoordinator.ts src/components/__tests__/useBatchVerdictCoordinator.test.tsx
git commit -m "feat: coordinate partial batch verdict results"
```

Expected: coordinator tests PASS; each successful record owns one user event.

### Task 4: Add Decision Center batch acceptance

**Files:**

- Modify: `src/components/review/planningRecordViews.ts:18-88`
- Modify: `src/components/review/DecisionCenter.tsx:62-131,174-342`
- Modify: `src/components/review/ReviewWorkspace.tsx:115-180,915-943`
- Modify: `src/components/review/ReviewWorkspaceContainer.tsx:98-190`
- Modify: `src/components/__tests__/DecisionCenter.test.tsx:458-620`
- Modify: `src/components/__tests__/ReviewWorkspaceContainerSelectors.test.tsx:7-95`

- [ ] **Step 1: Write failing component tests**

Add `batchRecommendation?: BatchVerdictCandidate` fixtures and tests:

```tsx
it('shows Accept N only for two valid visible candidates', () => {
  const onAccept = vi.fn();
  const { rerender } = render(<DecisionCenter records={[eligible('one')]}
    {...callbacks()} onAcceptRecommendations={onAccept} />);
  expect(screen.queryByRole('button', { name: 'Accept 1 recommendation' })).toBeNull();
  rerender(<DecisionCenter records={[eligible('one'), eligible('two')]}
    {...callbacks()} onAcceptRecommendations={onAccept} />);
  const button = screen.getByRole('button', { name: 'Accept 2 recommendations' });
  expect(button).toHaveClass('min-h-11');
  fireEvent.click(button);
  expect(onAccept).toHaveBeenCalledWith([
    eligible('one').batchRecommendation, eligible('two').batchRecommendation,
  ]);
});

it('disables busy, announces partial results, links skipped records, and hides read-only mutation', () => {
  // Rerender the same two fixtures with recommendationBatchBusy and expect a
  // disabled "Accepting 2 recommendations" button. Rerender with a result of
  // one succeeded/one skipped and assert role=status, aria-live=polite, counts,
  // and a direct skipped-record button. Rerender readOnly and expect no Accept N.
});
```

Update the `ReviewWorkspace` mock in
`ReviewWorkspaceContainerSelectors.test.tsx` to expose
`data-batch-handler={typeof onAcceptRecommendations}` and assert `function`.

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/components/__tests__/DecisionCenter.test.tsx src/components/__tests__/ReviewWorkspaceContainerSelectors.test.tsx
```

Expected: FAIL because batch view fields and props do not exist.

- [ ] **Step 3: Project eligibility and add the UI**

In `planningRecordViews.ts`, add:

```ts
batchRecommendation: recommendationBatchCandidate(record, latestSpine?.id),
```

Add `batchRecommendation?: BatchVerdictCandidate` to
`DecisionCenterRecordView`, and these props:

```ts
recommendationBatchBusy?: boolean;
recommendationBatchResult?: BatchVerdictResult;
onAcceptRecommendations?: (candidates: BatchVerdictCandidate[]) => void;
```

Derive only current Needs-attention candidates:

```ts
const eligibleRecommendations = useMemo(() => view === 'needs_review'
  ? visible.flatMap(item => item.batchRecommendation ? [item.batchRecommendation] : [])
  : [], [view, visible]);
```

Render below the header copy:

```tsx
{!readOnly && eligibleRecommendations.length >= 2 && onAcceptRecommendations && (
  <button type="button" disabled={recommendationBatchBusy}
    aria-label={recommendationBatchBusy
      ? `Accepting ${eligibleRecommendations.length} recommendations`
      : `Accept ${eligibleRecommendations.length} recommendations`}
    onClick={() => onAcceptRecommendations(eligibleRecommendations)}
    className="mt-3 min-h-11 w-full rounded-xl bg-indigo-600 px-4 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto">
    {recommendationBatchBusy ? 'Accepting' : 'Accept'} {eligibleRecommendations.length} recommendations
  </button>
)}
{recommendationBatchResult && (
  <div role="status" aria-live="polite" aria-label="Batch decision result"
    className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm">
    {recommendationBatchResult.succeeded.length} accepted ·{' '}
    {recommendationBatchResult.skipped.length} skipped ·{' '}
    {recommendationBatchResult.failed.length} failed
    {[...recommendationBatchResult.skipped, ...recommendationBatchResult.failed]
      .map(item => {
        const target = records.find(record => record.id === item.recordId);
        return target && <button key={item.recordId} type="button"
          onClick={() => openBatchResultRecord(target)}
          aria-label={`Review skipped decision ${target.title}: ${item.reason}`}
          className="block min-h-11 text-left text-indigo-700 underline">
          {target.title}: {item.reason}
        </button>;
      })}
  </div>
)}
```

Implement `openBatchResultRecord` to switch to Needs attention or History from
the target’s current status, select it, open mobile detail, and clear local
answer fields.

- [ ] **Step 4: Wire through ReviewWorkspace and the container**

Add/pass the three props above in `ReviewWorkspaceProps` and its
`<DecisionCenter>`. In `ReviewWorkspaceContainer`:

```ts
const recommendationBatch = useBatchVerdictCoordinator({
  projectId, canWrite, prepareImpact: handlePreviewImpact,
});
```

Pass:

```tsx
recommendationBatchBusy={recommendationBatch.busy}
recommendationBatchResult={recommendationBatch.result}
onAcceptRecommendations={candidates => void recommendationBatch.runBatch(candidates)}
```

Do not alter `MAX_EAGER_OPTION_PREPARATIONS` or option-generation effects.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npm test -- src/components/__tests__/DecisionCenter.test.tsx src/components/__tests__/ReviewWorkspaceContainerSelectors.test.tsx src/components/__tests__/useBatchVerdictCoordinator.test.tsx
git add src/components/review/planningRecordViews.ts src/components/review/DecisionCenter.tsx src/components/review/ReviewWorkspace.tsx src/components/review/ReviewWorkspaceContainer.tsx src/components/__tests__/DecisionCenter.test.tsx src/components/__tests__/ReviewWorkspaceContainerSelectors.test.tsx
git commit -m "feat: accept eligible recommendations in batches"
```

Expected: all focused suites PASS.

### Task 5: Return exact arrival IDs and derive the active assumption batch

**Files:**

- Modify: `src/store/types.ts:413-418`
- Modify: `src/store/slices/reviewSlice.ts:507-523`
- Modify: `src/store/__tests__/planningRecords.test.ts:27-47`
- Create: `src/lib/planning/assumptionArrival.ts`
- Create: `src/lib/planning/__tests__/assumptionArrival.test.ts`
- Modify: `src/lib/planning/index.ts`

- [ ] **Step 1: Write failing import and projection tests**

Change store expectations:

```ts
expect(first).toEqual({
  imported: 1, existing: 0,
  importedAssumptionIds: [useProjectStore.getState().planningRecords.p1[0].id],
});
expect(second).toEqual({ imported: 0, existing: 1, importedAssumptionIds: [] });
```

Create `assumptionArrival.test.ts`:

```ts
it('uses exact ids, orders two highlights by materiality, and settles idempotently', () => {
  const records = [
    assumption('historical', 'blocking'), assumption('normal', 'normal'),
    assumption('high', 'high'), assumption('blocking', 'blocking'),
  ];
  const summary = deriveAssumptionArrival(records, ['normal', 'high', 'blocking']);
  expect(summary?.arrivalRecordIds).toEqual(['normal', 'high', 'blocking']);
  expect(summary?.highlights.map(item => item.id)).toEqual(['blocking', 'high']);
  expect(summary?.pendingRecords.map(item => item.id)).not.toContain('historical');
  expect(deriveAssumptionArrival([
    assumption('normal', 'normal', 'confirmed'),
    assumption('high', 'high', 'deferred'),
  ], ['normal', 'high'])?.pendingRecords).toEqual([]);
});
```

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/store/__tests__/planningRecords.test.ts src/lib/planning/__tests__/assumptionArrival.test.ts
```

Expected: FAIL because the result IDs and projection module do not exist.

- [ ] **Step 3: Return exact assumption IDs**

Change `importPlanningAssumptions` result to:

```ts
{ imported: number; existing: number; importedAssumptionIds: string[] }
```

Inside the existing updater set:

```ts
outcome = {
  imported: result.imported.length,
  existing: result.existing.length,
  importedAssumptionIds: result.imported
    .filter(record => record.type === 'assumption')
    .map(record => record.id),
};
```

Keep counts backward-compatible; exclude imported `open_question` records from
the assumption card IDs.

- [ ] **Step 4: Implement the pure arrival projection**

Create `src/lib/planning/assumptionArrival.ts`:

```ts
import type { PlanningRecord } from '../../types';
import { projectDecision } from './decisionProjection';

export type AssumptionArrivalSummary = {
  arrivalRecordIds: string[];
  totalImported: number;
  pendingRecords: PlanningRecord[];
  highlights: PlanningRecord[];
  materialityCounts: Record<'blocking' | 'high' | 'normal' | 'low', number>;
};
const rank = { blocking: 0, high: 1, normal: 2, low: 3 } as const;

export function deriveAssumptionArrival(
  planningRecords: PlanningRecord[], arrivalIds: string[],
): AssumptionArrivalSummary | undefined {
  const ids = [...new Set(arrivalIds)];
  const byId = new Map(planningRecords.map(record => [record.id, record]));
  const arrival = ids.flatMap(id => {
    const record = byId.get(id);
    return record?.type === 'assumption' ? [record] : [];
  });
  if (!arrival.length) return;
  const pendingRecords = arrival.filter(record =>
    ['open', 'proposed'].includes(projectDecision(record).status));
  const materialityCounts = { blocking: 0, high: 0, normal: 0, low: 0 };
  pendingRecords.forEach(record => { materialityCounts[record.materiality ?? 'normal'] += 1; });
  const order = new Map(ids.map((id, index) => [id, index]));
  const highlights = [...pendingRecords].sort((a, b) =>
    rank[a.materiality ?? 'normal'] - rank[b.materiality ?? 'normal']
    || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)).slice(0, 2);
  return {
    arrivalRecordIds: arrival.map(record => record.id),
    totalImported: arrival.length, pendingRecords, highlights, materialityCounts,
  };
}
```

Export `./assumptionArrival` from `src/lib/planning/index.ts`.

- [ ] **Step 5: Verify GREEN and commit**

```bash
npm test -- src/store/__tests__/planningRecords.test.ts src/lib/planning/__tests__/assumptionArrival.test.ts
git add src/store/types.ts src/store/slices/reviewSlice.ts src/store/__tests__/planningRecords.test.ts src/lib/planning/assumptionArrival.ts src/lib/planning/__tests__/assumptionArrival.test.ts src/lib/planning/index.ts
git commit -m "feat: report exact assumption arrival batches"
```

Expected: exact IDs appear only on the first import; tests PASS.

### Task 6: Build and integrate the assumption-arrival card

**Files:**

- Create: `src/components/planning/AssumptionArrivalCard.tsx`
- Create: `src/components/__tests__/AssumptionArrivalCard.test.tsx`
- Modify: `src/components/ProjectWorkspace.tsx:102-130,150-173,588-594,1696-1730`
- Modify: `src/components/__tests__/SharpenPlanFlow.test.tsx:25-90`

- [ ] **Step 1: Write failing card and exact-scope tests**

Test:

```tsx
it('shows two material highlights and emits only exact pending ids', () => {
  render(<AssumptionArrivalCard summary={summary}
    onAcceptDefaults={accept} onReviewEach={review} onLater={later} />);
  expect(screen.getByText('Blocking assumption')).toBeInTheDocument();
  expect(screen.getByText('High assumption')).toBeInTheDocument();
  expect(screen.queryByText('Historical assumption')).toBeNull();
  const acceptButton = screen.getByRole('button', {
    name: 'Accept defaults for 3 imported assumptions',
  });
  expect(acceptButton).toHaveClass('min-h-11');
  fireEvent.click(acceptButton);
  fireEvent.click(screen.getByRole('button', {
    name: 'Review each of 3 imported assumptions',
  }));
  fireEvent.click(screen.getByRole('button', {
    name: 'Review 3 imported assumptions later',
  }));
  expect(accept).toHaveBeenCalledWith(['normal', 'blocking', 'high']);
  expect(review).toHaveBeenCalledWith(['normal', 'blocking', 'high']);
  expect(later).toHaveBeenCalledWith(['normal', 'blocking', 'high']);
});

it('announces partial results, disables busy controls, and hides read-only mutation', () => {
  // Assert role=status + aria-live=polite with succeeded/skipped/failed counts;
  // rerender busy and assert all buttons disabled; rerender readOnly and assert
  // no region named "New assumptions".
});
```

Add a Sharpen test rendering only `[records[1]]`; assert `Question 1 of 1`,
record 1 is absent, and Sounds right calls `onDecide` only for record 2.

- [ ] **Step 2: Verify RED**

```bash
npm test -- src/components/__tests__/AssumptionArrivalCard.test.tsx src/components/__tests__/SharpenPlanFlow.test.tsx
```

Expected: card suite FAILS because the component is absent; scoped Sharpen test
PASSES as a baseline.

- [ ] **Step 3: Implement the card**

Create `AssumptionArrivalCard.tsx` with this contract:

```ts
interface Props {
  summary: AssumptionArrivalSummary;
  busy?: boolean;
  readOnly?: boolean;
  batchResult?: BatchVerdictResult;
  onAcceptDefaults: (recordIds: string[]) => void;
  onReviewEach: (recordIds: string[]) => void;
  onLater: (recordIds: string[]) => void;
}
```

Render nothing when read-only or no pending records. Render:

```tsx
<section aria-label="New assumptions"
  className="mb-5 rounded-2xl border border-indigo-200 bg-indigo-50/60 p-4 sm:p-5">
  <h2 className="font-bold">
    {summary.totalImported} new assumptions arrived with this plan
  </h2>
  <p>Accepting a default records your planning call; it does not validate evidence.</p>
  <ul>{summary.highlights.map(record =>
    <li key={record.id}>{record.statement || record.title}</li>)}</ul>
  {batchResult && <div role="status" aria-live="polite"
    aria-label="Assumption batch result">
    {batchResult.succeeded.length} recorded · {batchResult.skipped.length} skipped ·{' '}
    {batchResult.failed.length} failed
  </div>}
  <div className="grid gap-2 sm:grid-cols-3">
    <button className="min-h-11" disabled={busy}
      aria-label={`Accept defaults for ${count} imported assumptions`}
      onClick={() => onAcceptDefaults(ids)}>Accept defaults</button>
    <button className="min-h-11" disabled={busy}
      aria-label={`Review each of ${count} imported assumptions`}
      onClick={() => onReviewEach(ids)}>Review each</button>
    <button className="min-h-11" disabled={busy}
      aria-label={`Review ${count} imported assumptions later`}
      onClick={() => onLater(ids)}>Later</button>
  </div>
</section>
```

Define `ids = summary.pendingRecords.map(...)`, `count = ids.length`, show the
materiality counts, and use Lucide icons with `aria-hidden`.

- [ ] **Step 4: Capture arrival IDs and wire exact actions in ProjectWorkspace**

Destructure `handlePreviewImpact` with `handleSharpenDecision`, instantiate
`useBatchVerdictCoordinator`, and add session-only state:

```ts
const [assumptionArrival, setAssumptionArrival] = useState<{
  projectId: string; spineVersionId: string; recordIds: string[];
} | null>(null);
```

Replace the import effect body:

```ts
const imported = useProjectStore.getState().importPlanningAssumptions(
  projectId, planningSourceSpine.id, planningSourceSpine.structuredPRD,
  planningSourceSpine.preflightSession);
if (imported.importedAssumptionIds.length) {
  setAssumptionArrival({
    projectId, spineVersionId: planningSourceSpine.id,
    recordIds: imported.importedAssumptionIds,
  });
}
```

Never clear a captured non-empty arrival because a Strict Mode repeat returned
an empty list. Derive only when `assumptionArrival.projectId === projectId`.
Add:

```ts
const recordsForIds = (ids: string[]) => {
  const requested = new Set(ids);
  return planningRecords.filter(record => requested.has(record.id));
};
const acceptArrivalDefaults = (ids: string[]) => void assumptionBatch.runBatch(
  recordsForIds(ids).flatMap(record => {
    const item = assumptionDefaultBatchCandidate(record); return item ? [item] : [];
  }));
const reviewArrivalEach = (ids: string[]) =>
  setSharpenQueueIds(recordsForIds(ids).map(record => record.id));
const deferArrival = (ids: string[]) => void assumptionBatch.runBatch(
  recordsForIds(ids).flatMap(record => {
    const item = deferBatchCandidate(record); return item ? [item] : [];
  }));
```

Render the card immediately before the existing Sharpen/PlanningStateBar branch
when no Sharpen flow is open and `pendingRecords.length > 0`. Pass coordinator
busy/result. Do not persist arrival state. Accept writes `custom_answered`;
Later writes one `deferred` event per exact record; Review each passes exact
pending IDs to existing Sharpen.

- [ ] **Step 5: Verify GREEN, build, and commit**

```bash
npm test -- src/components/__tests__/AssumptionArrivalCard.test.tsx src/components/__tests__/SharpenPlanFlow.test.tsx src/components/__tests__/useBatchVerdictCoordinator.test.tsx src/store/__tests__/planningRecords.test.ts
npm run build
git add src/components/planning/AssumptionArrivalCard.tsx src/components/__tests__/AssumptionArrivalCard.test.tsx src/components/ProjectWorkspace.tsx src/components/__tests__/SharpenPlanFlow.test.tsx
git commit -m "feat: add assumption arrival batch actions"
```

Expected: focused tests and build PASS; no persisted card/dismissal field exists.

### Task 7: Document Slice 2 behavior

**Files:**

- Modify: `docs/architecture/PLANNING_AND_DECISIONS.md:90-148`
- Modify: `docs/architecture/UI_PATTERNS.md:264-270`
- Modify: `README.md:39,76-78`

- [ ] **Step 1: Document authority and exact-arrival semantics**

Add to `PLANNING_AND_DECISIONS.md`:

```md
#### Batch verdict orchestration

Batch controls orchestrate the existing per-record decision-event boundary.
Eligibility requires an open/proposed record and, for recommendation batches, a
Synapse-authored recommendation bound to an option that still exists. The UI
snapshots semantic identity; the store rechecks it inside each record update.
Every success appends one user verdict and starts that record's existing impact
preview. Stale records are skipped independently; successes are never rolled
back and no aggregate verdict or combined PRD write exists.

Assumption-arrival UI is session-only and contains exactly the newly imported
assumption IDs returned by the import transaction. Accept defaults records the
presented statement as a user planning call, not evidence validation. Review
each scopes Sharpen to those IDs. Later appends one user defer event per record
and relies on existing resurfacing rules. No dismissal state is persisted.
```

- [ ] **Step 2: Document accessible UI and update product copy**

Add to `UI_PATTERNS.md`:

```md
- Batch controls include the exact affected count in their accessible names,
  retain 44px touch targets, and disable while running.
- Partial results use a polite `aria-live` region and direct links to skipped or
  failed records. Demo/read-only surfaces expose no mutation control.
- Arrival cards show at most the two most material exact-arrival assumptions;
  they never sweep the historical backlog.
```

Update README Decision Center/Plan prose to state that currently eligible
recommendations can be accepted together with separate guarded verdicts, and
newly imported assumptions offer Accept defaults / Review each / Later. State
that changed records are skipped; do not claim atomic completion.

- [ ] **Step 3: Check and commit docs**

```bash
git diff --check
git add docs/architecture/PLANNING_AND_DECISIONS.md docs/architecture/UI_PATTERNS.md README.md
git commit -m "docs: explain batch decision authority"
```

Expected: `git diff --check` prints nothing; documentation commit succeeds.

### Task 8: Run Slice 2 regression gates

**Files:**

- Verify only

- [ ] **Step 1: Run all focused suites**

```bash
npm test -- src/lib/planning/__tests__/batchVerdicts.test.ts src/lib/planning/__tests__/assumptionArrival.test.ts src/store/__tests__/planningRecords.test.ts src/store/__tests__/demoReadOnlyMutations.test.ts src/components/__tests__/useBatchVerdictCoordinator.test.tsx src/components/__tests__/DecisionCenter.test.tsx src/components/__tests__/ReviewWorkspaceContainerSelectors.test.tsx src/components/__tests__/AssumptionArrivalCard.test.tsx src/components/__tests__/SharpenPlanFlow.test.tsx
```

Expected: all listed suites PASS.

- [ ] **Step 2: Run repository gates**

```bash
npm test
npm run build
npm run lint
git diff --check
git status --short
```

Expected: tests, build, and lint PASS; `git diff --check` has no output;
`git status --short` is empty after the planned commits. The diff contains no
aggregate verdict event, persisted arrival/card collection, eager-cap increase,
critique-gate change, or batch PRD application.
