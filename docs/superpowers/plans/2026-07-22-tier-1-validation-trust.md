# Tier 1 Validation Trust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow rationale-backed acceptance of overridable artifact validation issues on one exact version while preserving the failed checks, keeping truncation/structure failures non-overridable, and making only a valid accepted version eligible for downstream generation.

**Architecture:** Introduce typed blocker records and one pure policy module that normalizes legacy metadata, classifies overrideability, fingerprints blocker sets, and projects effective disposition. A guarded Zustand action atomically rechecks the preferred version and blocker fingerprint, persists `metadata.validationAcceptance`, appends audit history, and clears only transient state pinned to that version. `ArtifactWorkspace` uses an accessible banner/dialog; Slice 4 later reads the same `readArtifactValidationDisposition(metadata)` seam for generation/export summaries.

**Tech Stack:** React 19, TypeScript 5.9, Zustand 5, Vitest 4, Testing Library, Tailwind CSS, Vite.

---

## Boundaries and file map

Implement only Slice 3 from
`docs/superpowers/specs/2026-07-22-tier-1-workflow-simplification-design.md:270-306`.
Do not change stages, routes, safety/PRD gates, export availability, or add a
summary collection. Keep `ArtifactVersion.metadata` open and backward-compatible.
Existing string blockers load as `legacy_unclassified` and are non-overridable.
Never delete `validationBlockers`, call an accepted issue Passed/Validated, or
copy acceptance to a new version.

**Create**

- `src/lib/artifactValidationPolicy.ts` — types-on-read, policy, fingerprint,
  effective disposition, clone stripping, downstream eligibility.
- `src/lib/__tests__/artifactValidationPolicy.test.ts`
- `src/store/__tests__/artifactValidationAcceptanceSlice.test.ts`
- `src/lib/services/__tests__/artifactJobController.validationTrust.test.ts`
- `src/components/artifacts/ArtifactValidationBanner.tsx`
- `src/components/__tests__/ArtifactValidationBanner.test.tsx`

**Modify**

- `src/types/index.ts:1206-1270,2429-2489`
- `src/lib/artifactBlockingValidation.ts:1-130`
- `src/lib/__tests__/artifactBlockingValidation.test.ts:1-92`
- `src/lib/services/coreArtifactService.ts:38-50`
- `src/lib/services/artifactJobController.ts:158-175,267-557,602-615,751-764,999-1008`
- `src/lib/artifactTraceabilityRepair.ts`
- `src/lib/__tests__/artifactTraceabilityRepair.test.ts`
- `src/store/types.ts:288-329,587-595`
- `src/store/slices/artifactSlice.ts:8-24,94-180,183-453`
- `src/lib/projectCapabilities.ts:108-132`
- `src/store/__tests__/demoReadOnlyMutations.test.ts:69-146`
- `src/store/__tests__/artifactSlice.revert.test.ts:22-72`
- `src/components/ArtifactWorkspace.tsx:1-15,280-293,864-888,1629-1672`
- `docs/architecture/SAFETY_AND_VALIDATION.md:54-111`
- `docs/architecture/WORKSPACE_AND_ARTIFACTS.md:224-233`
- `docs/architecture/VERSIONING_AND_EXPORT.md:89-107`
- `docs/architecture/UI_PATTERNS.md`
- `README.md:80-83`

### Task 1: Typed validation policy and Slice 4 read seam

**Files:**

- Create: `src/lib/artifactValidationPolicy.ts`
- Create: `src/lib/__tests__/artifactValidationPolicy.test.ts`
- Modify: `src/types/index.ts:1206-1270`

- [ ] **Step 1: Write failing policy tests**

Create `src/lib/__tests__/artifactValidationPolicy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ArtifactValidationBlocker, ArtifactVersion } from '../../types';
import {
  artifactValidationBlockerSetFingerprint,
  artifactValidationOverridePolicyFor,
  isArtifactVersionEligibleAsGenerationContext,
  readArtifactValidationDisposition,
  withoutArtifactValidationAcceptance,
} from '../artifactValidationPolicy';

const semantic: ArtifactValidationBlocker = {
  code: 'prd_traceability_unverified', message: 'Traceability was not verified.',
};
const structural: ArtifactValidationBlocker = {
  code: 'output_structure_incomplete', message: 'No screens were produced.',
};
const version = (metadata: Record<string, unknown>): ArtifactVersion => ({
  id: 'v1', artifactId: 'a1', versionNumber: 1, parentVersionId: null,
  content: 'content', metadata, sourceRefs: [], generationPrompt: 'prompt',
  isPreferred: true, createdAt: 1,
});

describe('artifact validation policy', () => {
  it('classifies by code, not display text', () => {
    expect(artifactValidationOverridePolicyFor('prd_traceability_unverified')).toBe('rationale_required');
    expect(artifactValidationOverridePolicyFor('data_model_api_surface_missing')).toBe('rationale_required');
    expect(artifactValidationOverridePolicyFor('user_flows_error_paths_missing')).toBe('rationale_required');
    expect(artifactValidationOverridePolicyFor('output_truncated')).toBe('non_overridable');
    expect(artifactValidationOverridePolicyFor('output_unparseable')).toBe('non_overridable');
    expect(artifactValidationOverridePolicyFor('output_structure_incomplete')).toBe('non_overridable');
    expect(artifactValidationOverridePolicyFor('legacy_unclassified')).toBe('non_overridable');
  });

  it('accepts only the exact order-independent blocker fingerprint', () => {
    const fingerprint = artifactValidationBlockerSetFingerprint([semantic]);
    const metadata = { validationBlockers: [semantic], validationAcceptance: {
      schemaVersion: 1, actor: 'user', acceptedAt: 10,
      rationale: 'The canonical appendix supplies this mapping.',
      blockerFingerprint: fingerprint,
    }};
    expect(readArtifactValidationDisposition(metadata)).toMatchObject({
      blockers: [semantic], effectiveStatus: 'accepted_issue',
      overridePolicy: 'rationale_required',
      accepted: { actor: 'user', rationale: 'The canonical appendix supplies this mapping.' },
    });
    expect(isArtifactVersionEligibleAsGenerationContext(version(metadata))).toBe(true);
    expect(artifactValidationBlockerSetFingerprint([semantic, structural]))
      .toBe(artifactValidationBlockerSetFingerprint([structural, semantic]));
  });

  it('rejects stale, structural, mixed, and legacy acceptance', () => {
    expect(readArtifactValidationDisposition({
      validationBlockers: [semantic],
      validationAcceptance: { schemaVersion: 1, actor: 'user', acceptedAt: 10,
        rationale: 'Stale', blockerFingerprint: 'wrong' },
    }).effectiveStatus).toBe('needs_review');
    expect(readArtifactValidationDisposition({
      validationBlockers: [semantic, structural],
    }).overridePolicy).toBe('non_overridable');
    expect(readArtifactValidationDisposition({
      validationBlockers: ['old blocker text'],
    })).toMatchObject({
      blockers: [{ code: 'legacy_unclassified', message: 'old blocker text' }],
      effectiveStatus: 'needs_review', overridePolicy: 'non_overridable',
    });
  });

  it('strips acceptance but preserves failures and unrelated metadata', () => {
    expect(withoutArtifactValidationAcceptance({
      validationBlockers: [semantic], validationAcceptance: { actor: 'user' }, repairAttempted: true,
    })).toEqual({ validationBlockers: [semantic], repairAttempted: true });
  });
});
```

- [ ] **Step 2: Run the test and verify the red state**

Run: `npm test -- src/lib/__tests__/artifactValidationPolicy.test.ts`

Expected: FAIL with missing validation types/module.

- [ ] **Step 3: Add persisted types**

Insert after `ProjectJobState` in `src/types/index.ts`:

```ts
export type ArtifactValidationBlockerCode =
  | 'output_truncated' | 'output_unparseable' | 'output_structure_incomplete'
  | 'data_model_api_surface_missing' | 'user_flows_error_paths_missing'
  | 'prd_traceability_unverified' | 'legacy_unclassified';
export type ArtifactValidationOverridePolicy = 'non_overridable' | 'rationale_required';
export interface ArtifactValidationBlocker {
  code: ArtifactValidationBlockerCode;
  message: string;
}
export interface ArtifactValidationAcceptance {
  schemaVersion: 1;
  actor: 'user';
  acceptedAt: number;
  rationale: string;
  blockerFingerprint: string;
}
export interface ArtifactValidationDisposition {
  blockers: ArtifactValidationBlocker[];
  accepted?: ArtifactValidationAcceptance;
  effectiveStatus: 'clear' | 'needs_review' | 'accepted_issue';
  overridePolicy?: ArtifactValidationOverridePolicy;
}
export interface AcceptArtifactValidationIssueInput {
  artifactId: string;
  versionId: string;
  expectedBlockerFingerprint: string;
  rationale: string;
}
export type AcceptArtifactValidationIssueResult =
  | { status: 'accepted'; artifactId: string; versionId: string }
  | { status: 'rejected'; reason:
      | 'artifact_not_found' | 'version_not_found' | 'not_preferred'
      | 'blockers_changed' | 'rationale_required' | 'non_overridable'
      | 'already_accepted' };
```

- [ ] **Step 4: Implement the policy**

Create `src/lib/artifactValidationPolicy.ts`:

```ts
import type {
  ArtifactValidationAcceptance, ArtifactValidationBlocker,
  ArtifactValidationBlockerCode, ArtifactValidationDisposition,
  ArtifactValidationOverridePolicy, ArtifactVersion,
} from '../types';
import { hashReviewValue } from './review/hash';

const CODES = new Set<ArtifactValidationBlockerCode>([
  'output_truncated', 'output_unparseable', 'output_structure_incomplete',
  'data_model_api_surface_missing', 'user_flows_error_paths_missing',
  'prd_traceability_unverified', 'legacy_unclassified',
]);
const POLICY: Record<ArtifactValidationBlockerCode, ArtifactValidationOverridePolicy> = {
  output_truncated: 'non_overridable',
  output_unparseable: 'non_overridable',
  output_structure_incomplete: 'non_overridable',
  data_model_api_surface_missing: 'rationale_required',
  user_flows_error_paths_missing: 'rationale_required',
  prd_traceability_unverified: 'rationale_required',
  legacy_unclassified: 'non_overridable',
};
export const artifactValidationOverridePolicyFor =
  (code: ArtifactValidationBlockerCode): ArtifactValidationOverridePolicy => POLICY[code];

export function readArtifactValidationBlockers(
  metadata: Record<string, unknown> | undefined,
): ArtifactValidationBlocker[] {
  const raw = metadata?.validationBlockers;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): ArtifactValidationBlocker[] => {
    if (typeof item === 'string' && item.trim()) {
      return [{ code: 'legacy_unclassified', message: item.trim() }];
    }
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const value = item as Record<string, unknown>;
    return typeof value.code === 'string' && CODES.has(value.code as ArtifactValidationBlockerCode)
      && typeof value.message === 'string' && value.message.trim()
      ? [{ code: value.code as ArtifactValidationBlockerCode, message: value.message.trim() }]
      : [];
  });
}
export const artifactValidationBlockerSetFingerprint =
  (blockers: readonly ArtifactValidationBlocker[]): string => hashReviewValue(
    blockers.map(({ code, message }) => ({ code, message: message.trim() }))
      .sort((a, b) => a.code.localeCompare(b.code) || a.message.localeCompare(b.message)),
  );

function acceptance(raw: unknown): ArtifactValidationAcceptance | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const value = raw as Record<string, unknown>;
  return value.schemaVersion === 1 && value.actor === 'user'
    && typeof value.acceptedAt === 'number' && Number.isFinite(value.acceptedAt)
    && typeof value.rationale === 'string' && Boolean(value.rationale.trim())
    && typeof value.blockerFingerprint === 'string' && Boolean(value.blockerFingerprint)
    ? { schemaVersion: 1, actor: 'user', acceptedAt: value.acceptedAt,
        rationale: value.rationale.trim(), blockerFingerprint: value.blockerFingerprint }
    : undefined;
}
export function readArtifactValidationDisposition(
  metadata: Record<string, unknown> | undefined,
): ArtifactValidationDisposition {
  const blockers = readArtifactValidationBlockers(metadata);
  if (blockers.length === 0) return { blockers, effectiveStatus: 'clear' };
  const overridePolicy = blockers.every(
    blocker => POLICY[blocker.code] === 'rationale_required',
  ) ? 'rationale_required' : 'non_overridable';
  const candidate = acceptance(metadata?.validationAcceptance);
  const accepted = overridePolicy === 'rationale_required'
    && candidate?.blockerFingerprint === artifactValidationBlockerSetFingerprint(blockers)
    ? candidate : undefined;
  return { blockers, ...(accepted ? { accepted } : {}),
    effectiveStatus: accepted ? 'accepted_issue' : 'needs_review', overridePolicy };
}
export const isArtifactVersionEligibleAsGenerationContext =
  (version: ArtifactVersion | undefined): boolean =>
    Boolean(version) && readArtifactValidationDisposition(version!.metadata).effectiveStatus !== 'needs_review';
export function withoutArtifactValidationAcceptance(
  metadata: Record<string, unknown>,
): Record<string, unknown> {
  const { validationAcceptance: ignored, ...rest } = metadata;
  void ignored;
  return rest;
}
```

- [ ] **Step 5: Verify and commit**

Run: `npm test -- src/lib/__tests__/artifactValidationPolicy.test.ts && npm run build`

Expected: PASS.

```bash
git add src/types/index.ts src/lib/artifactValidationPolicy.ts src/lib/__tests__/artifactValidationPolicy.test.ts
git commit -m "feat: add typed artifact validation policy"
```

### Task 2: Emit typed blockers, including non-overridable structure failures

**Files:**

- Modify: `src/lib/artifactBlockingValidation.ts:1-130`
- Modify: `src/lib/__tests__/artifactBlockingValidation.test.ts:1-92`
- Modify: `src/lib/services/coreArtifactService.ts:38-50`
- Modify: `src/lib/services/artifactJobController.ts:267-415`
- Modify: `src/lib/artifactTraceabilityRepair.ts`
- Modify: `src/lib/__tests__/artifactTraceabilityRepair.test.ts`

- [ ] **Step 1: Add failing code-based detector tests**

Replace string predicates with code assertions and add:

```ts
expect(detectArtifactBlockers('screen_inventory', '{"sections":', prd))
  .toContainEqual(expect.objectContaining({ code: 'output_unparseable' }));
expect(detectArtifactBlockers(
  'screen_inventory', JSON.stringify({ sections: [{ title: 'Core', screens: [] }] }), prd,
)).toContainEqual(expect.objectContaining({ code: 'output_structure_incomplete' }));
expect(detectArtifactBlockers('data_model', '# Data Model', prd))
  .toContainEqual(expect.objectContaining({ code: 'output_unparseable' }));
expect(detectArtifactBlockers('data_model', validWithoutApi, prd))
  .toContainEqual(expect.objectContaining({ code: 'data_model_api_surface_missing' }));
expect(isTraceabilityBlocker({
  code: 'prd_traceability_unverified', message: 'Changed display text',
})).toBe(true);
```

Run: `npm test -- src/lib/__tests__/artifactBlockingValidation.test.ts`

Expected: FAIL because detectors still return strings and do not block parse failure.

- [ ] **Step 2: Convert detector output to typed records**

In `artifactBlockingValidation.ts`, use:

```ts
export const TRACEABILITY_BLOCKER: ArtifactValidationBlocker = {
  code: 'prd_traceability_unverified',
  message: 'Artifact references none of the PRD features — no traceability to the PRD.',
};
export const isTraceabilityBlocker = (blocker: ArtifactValidationBlocker): boolean =>
  blocker.code === 'prd_traceability_unverified';
```

Emit these code/message pairs:

```ts
{ code: 'data_model_api_surface_missing',
  message: 'Data model is missing an explicit API surface mapping (no API endpoints).' }
{ code: 'user_flows_error_paths_missing',
  message: 'User flows do not include any error paths.' }
{ code: 'output_unparseable',
  message: `${label} could not be parsed as generated structured output.` }
{ code: 'output_structure_incomplete',
  message: `${label} parsed but contains no ${unit}.` }
```

Check `screen_inventory`, `data_model`, and `component_inventory` with their
existing parsers. Parse failure is `output_unparseable`; a parsed empty
collection is `output_structure_incomplete`. These checks run only during new
generation, not while loading legacy artifacts.

- [ ] **Step 3: Type truncation and traceability repair**

In `coreArtifactService.ts`:

```ts
export const ARTIFACT_TRUNCATED_BLOCKER: ArtifactValidationBlocker = {
  code: 'output_truncated',
  message: 'The model response hit its output limit and was cut off — content at the end is missing. Regenerate this artifact.',
};
```

In `artifactJobController.ts`, keep `validationBlockers`,
`originalValidationBlockers`, and `postRepairValidationBlockers` typed. Reword
failed repair without changing identity:

```ts
isTraceabilityBlocker(blocker)
  ? { ...blocker, message: TRACEABILITY_UNRESOLVED_MESSAGE }
  : blocker
```

Update `artifactTraceabilityRepair` tests/helpers to compare the code, never text.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test -- src/lib/__tests__/artifactBlockingValidation.test.ts src/lib/__tests__/artifactTraceabilityRepair.test.ts src/lib/services/__tests__/artifactJobController.earlyDesign.test.ts
```

Expected: PASS.

```bash
git add src/lib/artifactBlockingValidation.ts src/lib/__tests__/artifactBlockingValidation.test.ts src/lib/services/coreArtifactService.ts src/lib/services/artifactJobController.ts src/lib/artifactTraceabilityRepair.ts src/lib/__tests__/artifactTraceabilityRepair.test.ts
git commit -m "feat: emit typed artifact validation blockers"
```

### Task 3: Add atomic version-scoped acceptance and audit provenance

**Files:**

- Create: `src/store/__tests__/artifactValidationAcceptanceSlice.test.ts`
- Modify: `src/types/index.ts:2429-2489`
- Modify: `src/store/types.ts:288-329`
- Modify: `src/store/slices/artifactSlice.ts:8-24,183-453`
- Modify: `src/lib/projectCapabilities.ts:108-132`
- Modify: `src/store/__tests__/demoReadOnlyMutations.test.ts:69-146`
- Modify: `src/store/__tests__/artifactSlice.revert.test.ts:22-72`

- [ ] **Step 1: Write failing store tests**

Seed an editable project, core artifact, preferred version, and:

```ts
const blockers: ArtifactValidationBlocker[] = [{
  code: 'prd_traceability_unverified', message: 'Traceability was not verified.',
}];
const request = {
  artifactId, versionId,
  expectedBlockerFingerprint: artifactValidationBlockerSetFingerprint(blockers),
  rationale: 'The canonical appendix supplies this mapping.',
};
expect(store.acceptArtifactValidationIssue(projectId, request))
  .toEqual({ status: 'accepted', artifactId, versionId });
expect(store.getPreferredVersion(projectId, artifactId)!.metadata).toMatchObject({
  validationBlockers: blockers,
  validationAcceptance: {
    schemaVersion: 1, actor: 'user',
    rationale: 'The canonical appendix supplies this mapping.',
    blockerFingerprint: request.expectedBlockerFingerprint,
  },
});
expect(store.getHistoryEvents(projectId)).toContainEqual(expect.objectContaining({
  type: 'ValidationIssueAccepted', artifactId, artifactVersionId: versionId,
}));
```

Add separate tests asserting no mutation for whitespace rationale
(`rationale_required`), changed fingerprint (`blockers_changed`), replaced
preferred version (`not_preferred`), structural/mixed blockers
(`non_overridable`), and a duplicate submit (`already_accepted`, one history
event). Add a test proving regeneration, revert, and mark-current retain blockers
but omit `validationAcceptance`.

Run: `npm test -- src/store/__tests__/artifactValidationAcceptanceSlice.test.ts`

Expected: FAIL because the action/history kind do not exist.

- [ ] **Step 2: Add the store contract and guard**

Add to `ProjectState`/`ArtifactSlice`:

```ts
acceptArtifactValidationIssue: (
  projectId: string, input: AcceptArtifactValidationIssueInput,
) => AcceptArtifactValidationIssueResult;
```

Add `ValidationIssueAccepted` to `HistoryEventType` and
`acceptArtifactValidationIssue` to `PERSISTENT_STORE_ACTIONS`.

- [ ] **Step 3: Implement one authoritative transaction**

In `artifactSlice.ts`, implement the action with one `set(state => ...)`
read/check/write:

```ts
acceptArtifactValidationIssue: (projectId, input) => {
  assertProjectCapability(get().projects[projectId], 'canReviewArtifacts');
  let result: AcceptArtifactValidationIssueResult =
    { status: 'rejected', reason: 'artifact_not_found' };
  set(state => {
    const reject = (
      reason: Extract<AcceptArtifactValidationIssueResult, { status: 'rejected' }>['reason'],
    ) => {
      result = { status: 'rejected', reason };
      return state;
    };
    const artifact = (state.artifacts[projectId] ?? []).find(a => a.id === input.artifactId);
    if (!artifact) return reject('artifact_not_found');
    const versions = state.artifactVersions[projectId] ?? [];
    const target = versions.find(v => v.id === input.versionId && v.artifactId === input.artifactId);
    if (!target) return reject('version_not_found');
    if (!target.isPreferred || artifact.currentVersionId !== target.id) return reject('not_preferred');
    const disposition = readArtifactValidationDisposition(target.metadata);
    const fingerprint = artifactValidationBlockerSetFingerprint(disposition.blockers);
    if (fingerprint !== input.expectedBlockerFingerprint) return reject('blockers_changed');
    if (!input.rationale.trim()) return reject('rationale_required');
    if (disposition.overridePolicy !== 'rationale_required') return reject('non_overridable');
    if (disposition.accepted) return reject('already_accepted');
    const now = Date.now();
    const validationAcceptance: ArtifactValidationAcceptance = {
      schemaVersion: 1, actor: 'user', acceptedAt: now,
      rationale: input.rationale.trim(), blockerFingerprint: fingerprint,
    };
    result = { status: 'accepted', artifactId: artifact.id, versionId: target.id };
    return {
      artifactVersions: { ...state.artifactVersions, [projectId]: versions.map(version =>
        version.id === target.id
          ? { ...version, metadata: { ...version.metadata, validationAcceptance } }
          : version,
      )},
      artifacts: { ...state.artifacts, [projectId]: (state.artifacts[projectId] ?? []).map(item =>
        item.id === artifact.id ? { ...item, updatedAt: now } : item,
      )},
      historyEvents: { ...state.historyEvents, [projectId]: [
        ...(state.historyEvents[projectId] ?? []),
        { id: uuidv4(), projectId, artifactId: artifact.id,
          artifactVersionId: target.id, type: 'ValidationIssueAccepted',
          description: `${artifact.title} v${target.versionNumber} accepted with a noted validation issue`,
          createdAt: now },
      ]},
    };
  });
  return result;
},
```

Successful branches preserve `validationBlockers` and append exactly one event.

- [ ] **Step 4: Prevent cloned-version inheritance**

In both `revertArtifactToVersion` and `markArtifactCurrentForSpine`, change:

```ts
metadata: src.metadata
```

to:

```ts
metadata: withoutArtifactValidationAcceptance(src.metadata)
```

`createArtifactVersion` already receives new generation metadata; its regression
test must assert it does not acquire the parent's acceptance.

- [ ] **Step 5: Add demo/read-only coverage**

In `demoReadOnlyMutations.test.ts`, call the action against `DEMO_PROJECT_ID`:

```ts
expect(() => store.acceptArtifactValidationIssue(projectId, request)).toThrow('read-only');
expect(store.getPreferredVersion(projectId, artifactId)!.metadata.validationAcceptance)
  .toBeUndefined();
```

- [ ] **Step 6: Verify and commit**

Run:

```bash
npm test -- src/store/__tests__/artifactValidationAcceptanceSlice.test.ts src/store/__tests__/demoReadOnlyMutations.test.ts src/store/__tests__/artifactSlice.revert.test.ts
```

Expected: PASS.

```bash
git add src/types/index.ts src/store/types.ts src/store/slices/artifactSlice.ts src/lib/projectCapabilities.ts src/store/__tests__/artifactValidationAcceptanceSlice.test.ts src/store/__tests__/demoReadOnlyMutations.test.ts src/store/__tests__/artifactSlice.revert.test.ts
git commit -m "feat: record version-scoped validation acceptance"
```

### Task 4: Pin and clear transient job state for the exact version

**Files:**

- Create: `src/lib/services/__tests__/artifactJobController.validationTrust.test.ts`
- Modify: `src/types/index.ts:1222-1229`
- Modify: `src/lib/services/artifactJobController.ts:267-557`
- Modify: `src/store/slices/artifactSlice.ts`

- [ ] **Step 1: Write failing transient tests**

Mock `generateCoreArtifact` and `detectArtifactBlockers` using the pattern in
`artifactJobController.earlyDesign.test.ts:4-43`. Generate a blocked
`data_model`, settle the run, then assert:

```ts
expect(store.getSlot(projectId, 'data_model')).toMatchObject({
  status: 'needs_review', artifactVersionId: preferred.id,
});
```

Seed matching and mismatching slots, accept the version, and assert:

```ts
expect(matchingStore.getSlot(projectId, 'data_model')).toMatchObject({
  status: 'done', artifactVersionId: versionId, error: undefined,
});
expect(mismatchingStore.getSlot(projectId, 'data_model')).toMatchObject({
  status: 'needs_review', artifactVersionId: 'newer-version',
});
```

Run:
`npm test -- src/lib/services/__tests__/artifactJobController.validationTrust.test.ts`

Expected: FAIL because slots do not carry artifact-version identity.

- [ ] **Step 2: Stamp version identity**

Add to `SlotState`:

```ts
/** Exact produced version for a settled done/needs_review slot. Transient only. */
artifactVersionId?: string;
```

Capture `createArtifactVersion(...).versionId` in both core and mockup settle
paths, then set:

```ts
writeStore.setSlotStatus(projectId, subtype, {
  status: blockers.length ? 'needs_review' : 'done',
  artifactVersionId: versionId, error: undefined, finishedAt: Date.now(),
});
```

Queued/generating transitions set `artifactVersionId: undefined`. No migration
is needed because `jobs` is excluded from persistence at
`src/store/projectStore.ts:83-99`.

- [ ] **Step 3: Clear only a matching transient slot in the acceptance transaction**

Inside the successful `set(state => ...)` branch:

```ts
const slot = artifact.subtype ? state.jobs[projectId]?.slots[artifact.subtype] : undefined;
const jobsPatch = artifact.subtype && slot?.status === 'needs_review'
  && slot.artifactVersionId === target.id
  ? { jobs: { ...state.jobs, [projectId]: {
      ...state.jobs[projectId]!, slots: { ...state.jobs[projectId]!.slots,
        [artifact.subtype]: { ...slot, status: 'done' as const, error: undefined },
      },
    }}}
  : {};
```

Spread `jobsPatch` into the same successful return. Never clear the full job or
a slot whose version id differs.

- [ ] **Step 4: Verify and commit**

Run:

```bash
npm test -- src/lib/services/__tests__/artifactJobController.validationTrust.test.ts src/store/__tests__/artifactValidationAcceptanceSlice.test.ts
```

Expected: PASS.

```bash
git add src/types/index.ts src/store/slices/artifactSlice.ts src/lib/services/artifactJobController.ts src/lib/services/__tests__/artifactJobController.validationTrust.test.ts
git commit -m "fix: pin validation job state to artifact versions"
```

### Task 5: Make accepted versions eligible at every generation-context read

**Files:**

- Modify: `src/lib/services/artifactJobController.ts:417-447,602-615,751-764,999-1008`
- Modify: `src/lib/services/__tests__/artifactJobController.validationTrust.test.ts`

- [ ] **Step 1: Add a failing accepted-dependency test**

Seed a current-spine `screen_inventory` with an overridable blocker, accept it,
then retry `user_flows`. Assert the mock's fourth argument receives it and the
upstream is not regenerated:

```ts
artifactJobController.retrySlot('user_flows', args);
await settle(projectId);
expect(generateMock.mock.calls.map(call => call[0])).not.toContain('screen_inventory');
const call = generateMock.mock.calls.find(item => item[0] === 'user_flows')!;
expect(call[3].generatedArtifacts.screen_inventory).toContain('"Home"');
```

Also assert `isArtifactVersionEligibleAsGenerationContext` returns false for an
unaccepted semantic blocker and any structural blocker.

Run:
`npm test -- src/lib/services/__tests__/artifactJobController.validationTrust.test.ts`

Expected: FAIL because current controller reads reject any raw blocker array.

- [ ] **Step 2: Replace every read-side raw-blocker gate**

Use `isArtifactVersionEligibleAsGenerationContext(preferred)` in:

1. `readPreferredArtifactForSpine`;
2. `readPreferredArtifactRef`;
3. the `executeJob` existing-artifact seed loop;
4. `isDependencyHealthy`; and
5. the `retrySlot` seed loop.

The common predicate is:

```ts
preferred.sourceRefs.some(ref =>
  ref.sourceType === 'spine' && ref.sourceArtifactVersionId === spineVersionId,
) && isArtifactVersionEligibleAsGenerationContext(preferred)
```

Do not check `validationAcceptance` directly; the central reader rejects stale,
malformed, non-overridable, and legacy acceptance.

- [ ] **Step 3: Verify all controller reads and commit**

Run:

```bash
rg -n "validationBlockers|readValidationBlockers" src/lib/services/artifactJobController.ts
npm test -- src/lib/services/__tests__/artifactJobController.validationTrust.test.ts src/lib/services/__tests__/artifactJobController.earlyDesign.test.ts src/lib/services/__tests__/artifactJobResume.test.ts
```

Expected: only the typed metadata write remains in the search; tests PASS.

```bash
git add src/lib/services/artifactJobController.ts src/lib/services/__tests__/artifactJobController.validationTrust.test.ts
git commit -m "feat: allow accepted versions as generation context"
```

### Task 6: Accessible artifact banner and rationale dialog

**Files:**

- Create: `src/components/artifacts/ArtifactValidationBanner.tsx`
- Create: `src/components/__tests__/ArtifactValidationBanner.test.tsx`
- Modify: `src/components/ArtifactWorkspace.tsx:1-15,280-293,864-888,1629-1672`

- [ ] **Step 1: Write failing component tests**

Cover these concrete assertions:

```tsx
render(<ArtifactValidationBanner disposition={needsReview} canRegenerate canAccept
  onRegenerate={onRegenerate} onAccept={onAccept} />);
expect(screen.getByText('Traceability was not verified.')).toBeInTheDocument();
fireEvent.click(screen.getByRole('button', { name: 'Accept with noted issue' }));
expect(screen.getByLabelText('Why is this output safe to use?')).toHaveFocus();
expect(screen.getByRole('button', { name: 'Record accepted issue' })).toBeDisabled();
fireEvent.change(screen.getByLabelText('Why is this output safe to use?'), {
  target: { value: '  The canonical appendix supplies this mapping.  ' },
});
fireEvent.click(screen.getByRole('button', { name: 'Record accepted issue' }));
expect(onAccept).toHaveBeenCalledWith({
  rationale: 'The canonical appendix supplies this mapping.',
  expectedBlockerFingerprint: expect.any(String),
});
```

Add tests that:

- non-overridable/mixed disposition has Regenerate but no acceptance button;
- accepted disposition shows `Accepted issue`, rationale, and original blockers,
  but no standalone `Passed`/`Validated` label;
- `canAccept={false}`/`canRegenerate={false}` shows no mutation controls;
- `blockers_changed` keeps the dialog open with `role="alert"`;
- Escape closes and restores focus to the trigger; and
- buttons carry `min-h-11`/`min-w-11` touch-target classes.

Run: `npm test -- src/components/__tests__/ArtifactValidationBanner.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 2: Implement the component contract**

Use:

```ts
interface ArtifactValidationBannerProps {
  disposition: ArtifactValidationDisposition;
  canRegenerate: boolean;
  canAccept: boolean;
  onRegenerate: () => void;
  onAccept: (input: { rationale: string; expectedBlockerFingerprint: string }) =>
    AcceptArtifactValidationIssueResult;
}
```

List `disposition.blockers[].message`. Show `Accept with noted issue` only for
`canAccept && overridePolicy === 'rationale_required'`. Accepted state keeps the
failed-check list inspectable and renders `accepted.rationale`.

- [ ] **Step 3: Implement dialog authority handoff and accessibility**

Use local `open`, `rationale`, and `error` state; the store result remains
authoritative:

```ts
const submit = () => {
  const trimmed = rationale.trim();
  if (!trimmed) return;
  const result = onAccept({
    rationale: trimmed,
    expectedBlockerFingerprint: artifactValidationBlockerSetFingerprint(disposition.blockers),
  });
  if (result.status === 'accepted' || result.reason === 'already_accepted') close();
  else if (['artifact_not_found','version_not_found','not_preferred','blockers_changed'].includes(result.reason))
    setError('This artifact changed. Review the current version before accepting an issue.');
  else if (result.reason === 'non_overridable')
    setError('This issue cannot be accepted and must be regenerated.');
  else setError('Enter a rationale before recording the accepted issue.');
};
```

Render `role="dialog"`, `aria-modal`, labeled heading/description, labeled
textarea, `role="alert"` error, mobile bottom sheet/desktop centered card, and
44px controls. On open focus the textarea; trap Tab within
`button:not([disabled]), textarea:not([disabled]), [href],
[tabindex]:not([tabindex="-1"])`; Escape closes; cleanup restores the prior
focused element.

- [ ] **Step 4: Wire ArtifactWorkspace**

Replace `readValidationBlockers` with
`readArtifactValidationDisposition`. In `slotStatusFor`:

```ts
if (preferred &&
  readArtifactValidationDisposition(preferred.metadata).effectiveStatus === 'needs_review'
) return 'needs_review';
return 'done';
```

Replace the inline banner with:

```tsx
const validationDisposition = readArtifactValidationDisposition(preferred.metadata);
{validationDisposition.effectiveStatus !== 'clear' && (
  <ArtifactValidationBanner disposition={validationDisposition}
    canRegenerate={capabilities.canGenerateArtifacts}
    canAccept={capabilities.canReviewArtifacts}
    onRegenerate={() => handleRetrySlot(activeSelection)}
    onAccept={input => acceptArtifactValidationIssue(projectId, {
      artifactId: artifact.id, versionId: preferred.id,
      expectedBlockerFingerprint: input.expectedBlockerFingerprint,
      rationale: input.rationale,
    })}
  />
)}
```

Compute `traceabilityRepaired` from
`validationDisposition.blockers.length === 0`.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npm test -- src/components/__tests__/ArtifactValidationBanner.test.tsx src/components/__tests__/ScreensStatusDot.test.tsx src/store/__tests__/artifactValidationAcceptanceSlice.test.ts src/lib/services/__tests__/artifactJobController.validationTrust.test.ts
```

Expected: PASS.

```bash
git add src/components/artifacts/ArtifactValidationBanner.tsx src/components/__tests__/ArtifactValidationBanner.test.tsx src/components/ArtifactWorkspace.tsx
git commit -m "feat: add rationale-backed validation acceptance"
```

### Task 7: Documentation, Slice 4 seam lock, and repository gates

**Files:**

- Modify: `src/lib/__tests__/artifactValidationPolicy.test.ts`
- Modify: `docs/architecture/SAFETY_AND_VALIDATION.md:54-111`
- Modify: `docs/architecture/WORKSPACE_AND_ARTIFACTS.md:224-233`
- Modify: `docs/architecture/VERSIONING_AND_EXPORT.md:89-107`
- Modify: `docs/architecture/UI_PATTERNS.md`
- Modify: `README.md:80-83`

- [ ] **Step 1: Lock the generation/export integration seam**

Add a test that exact accepted metadata projects all Slice 4 inputs:

```ts
expect(readArtifactValidationDisposition(metadata)).toEqual({
  blockers, accepted: {
    schemaVersion: 1, actor: 'user', acceptedAt: 123,
    rationale: 'The canonical mapping was reviewed manually.',
    blockerFingerprint,
  },
  effectiveStatus: 'accepted_issue', overridePolicy: 'rationale_required',
});
```

Run: `npm test -- src/lib/__tests__/artifactValidationPolicy.test.ts`

Expected: PASS. Do not modify `ExportModal`, `ExportManifestEntry`, or add
generation/export summary UI; Slice 4 imports this reader.

- [ ] **Step 2: Update architecture and product docs**

Document:

- `SAFETY_AND_VALIDATION.md`: typed code/message metadata, the central policy,
  legacy non-overrideability, atomic preferred-version/fingerprint recheck,
  preserved blockers, acceptance metadata/history, exact copy, and structural/
  truncation refusal.
- `WORKSPACE_AND_ARTIFACTS.md`: dependency health uses
  `isArtifactVersionEligibleAsGenerationContext`; clean and valid accepted
  versions may seed downstream work.
- `VERSIONING_AND_EXPORT.md`: acceptance is post-creation per-version
  provenance, audit history is `ValidationIssueAccepted`, regeneration/revert/
  mark-current strip acceptance, and Slice 4 reads the shared disposition seam.
- `UI_PATTERNS.md`: labeled dialog, focus trap, Escape, focus restoration,
  live stale error, non-color status, and 44px targets.
- `README.md`: “When a semantic validation check is a false positive, you can
  record a version-specific rationale; truncated or structurally incomplete
  output must still be regenerated.”

- [ ] **Step 3: Run focused Slice 3 tests**

Run:

```bash
npm test -- src/lib/__tests__/artifactValidationPolicy.test.ts src/lib/__tests__/artifactBlockingValidation.test.ts src/lib/__tests__/artifactTraceabilityRepair.test.ts src/store/__tests__/artifactValidationAcceptanceSlice.test.ts src/store/__tests__/demoReadOnlyMutations.test.ts src/store/__tests__/artifactSlice.revert.test.ts src/lib/services/__tests__/artifactJobController.validationTrust.test.ts src/lib/services/__tests__/artifactJobController.earlyDesign.test.ts src/lib/services/__tests__/artifactJobResume.test.ts src/components/__tests__/ArtifactValidationBanner.test.tsx src/components/__tests__/ScreensStatusDot.test.tsx
```

Expected: PASS.

- [ ] **Step 4: Run repository gates**

Run:

```bash
npm test
npm run build
npm run lint
git diff --check
```

Expected: all commands exit 0; `git diff --check` prints nothing.

- [ ] **Step 5: Audit forbidden shortcuts**

Run:

```bash
rg -n "validationBlockers|validationAcceptance|Accepted issue|Passed|Validated" src/lib src/store src/components
```

Expected: new writes are typed; legacy strings normalize only in
`artifactValidationPolicy.ts`; overrideability is selected only by
`artifactValidationOverridePolicyFor`; generation reads use
`isArtifactVersionEligibleAsGenerationContext`; accepted UI uses
`Accepted issue`; `ExportModal.tsx` has no Slice 3 summary implementation.

- [ ] **Step 6: Commit docs and seam coverage**

```bash
git add src/lib/__tests__/artifactValidationPolicy.test.ts docs/architecture/SAFETY_AND_VALIDATION.md docs/architecture/WORKSPACE_AND_ARTIFACTS.md docs/architecture/VERSIONING_AND_EXPORT.md docs/architecture/UI_PATTERNS.md README.md
git commit -m "docs: define validation acceptance lifecycle"
```

- [ ] **Step 7: Verify the seven-commit handoff**

Run:

```bash
git log --oneline -7
git status --short
```

Expected: seven Slice 3 commits appear and the working tree is clean.

## Final self-review

- [ ] Codes, action, and seam use the exact public names
  `ArtifactValidationBlockerCode`, `ArtifactValidationBlocker`,
  `ArtifactValidationAcceptance`, `ArtifactValidationDisposition`,
  `AcceptArtifactValidationIssueInput`, `AcceptArtifactValidationIssueResult`,
  `acceptArtifactValidationIssue`, and
  `readArtifactValidationDisposition`.
- [ ] Store checks preferred version and blocker fingerprint in one transaction.
- [ ] Metadata records user, time, rationale, and blocker identity; history
  records provenance; original failures remain.
- [ ] Truncation, unparsable, structural, mixed, and legacy blockers cannot be
  accepted.
- [ ] Only matching transient state clears; accepted exact versions are eligible
  downstream; new versions do not inherit acceptance.
- [ ] Demo/read-only, stale/cross-tab, copy, focus, Escape, live error, and touch
  targets have focused tests.
- [ ] Slice 4 summaries remain out of scope and have one stable read seam.
