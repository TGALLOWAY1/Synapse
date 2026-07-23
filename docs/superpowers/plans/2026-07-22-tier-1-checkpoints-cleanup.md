# Tier 1 Checkpoints and Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace repeated pre-build/export warnings with one inline pre-generation checkpoint and one derived generation/export summary, then remove unused feedback/checklist machinery without breaking legacy reads.

**Architecture:** A pure `workflowCheckpointSummary` module composes prepared artifact, validation, job, alignment, and planning-verdict inputs; React surfaces only render and route its stable items. Generation completion is session-local and keyed by the transient job’s `startedAt`, while export receives an optional prepared planning verdict and stays backward compatible with the existing `exploratory` handoff input.

**Tech Stack:** React 19, TypeScript, Zustand 5, Vitest, Testing Library, Tailwind CSS, existing artifact/readiness/export primitives.

**Prerequisites:** Complete the Tier 1 orientation/return-loop plan and validation-trust plan first. This plan consumes `ArtifactValidationDisposition` and `readArtifactValidationDisposition` from the validation plan.

---

## File structure

- Create `src/lib/workflowCheckpointSummary.ts`: pure summary types and derivation; no store or React imports.
- Create `src/lib/__tests__/workflowCheckpointSummary.test.ts`: blocker/warning/accepted/failure/alignment matrices.
- Create `src/components/workflow/GenerationOutcomeSummary.tsx`: accessible generation-settled summary.
- Create `src/components/__tests__/GenerationOutcomeSummary.test.tsx`: rendering, links, dismissal, labels.
- Create `src/components/planning/PreBuildCheckpointCard.tsx`: inline advisory replacement for the modal.
- Delete `src/components/planning/PreBuildCheckModal.tsx` after integration.
- Replace `src/components/__tests__/PreBuildCheckModal.test.tsx` with `src/components/__tests__/PreBuildCheckpointCard.test.tsx`.
- Modify `src/components/ArtifactWorkspace.tsx`: derive/show one session-local settled-job summary.
- Modify `src/components/ProjectWorkspace.tsx`: render pre-build card below the stage bar and pass export verdict.
- Modify `src/components/ExportModal.tsx`: render one planning verdict and accepted-risk summary.
- Modify `src/lib/exportHandoff.ts`: optional structured planning verdict and accepted-risk markdown.
- Modify `src/lib/__tests__/exportHandoff.test.ts` and `src/lib/__tests__/exportManifest.test.ts`: backward-compatible handoff coverage.
- Modify `src/components/review/ReviewWorkspace.tsx` and its tests: remove duplicate page/tab raw counts left after the global strip.
- Modify `src/components/StructuredPRDView.tsx` and its tests only if the orientation plan did not already remove aggregate section counts; retain exact-record links.
- Modify `src/store/slices/feedbackSlice.ts`, `src/store/types.ts`, `src/lib/projectCapabilities.ts`: remove the unused creation action while retaining feedback reads/status updates.
- Modify `src/lib/screenReviewWorkflow.ts` and its tests: remove unrendered checklist/progress projection while retaining persisted legacy metadata parsing.
- Modify architecture docs, README, and tour copy listed in Task 7.

### Task 1: Derive one current-state checkpoint summary

**Files:**
- Create: `src/lib/workflowCheckpointSummary.ts`
- Create: `src/lib/__tests__/workflowCheckpointSummary.test.ts`
- Read dependency: `src/lib/artifactBlockingValidation.ts`
- Read dependency: `src/lib/planning/outputAlignment.ts`

- [ ] **Step 1: Write the failing summary tests**

```ts
import { describe, expect, it } from 'vitest';
import {
    deriveWorkflowCheckpointSummary,
    type WorkflowCheckpointInput,
} from '../workflowCheckpointSummary';

const baseInput = (): WorkflowCheckpointInput => ({
    job: {
        spineVersionId: 'spine-2',
        startedAt: 200,
        slots: {
            data_model: { status: 'done' as const, attempt: 1 },
            user_flows: { status: 'done' as const, attempt: 1 },
        },
    },
    artifacts: [
        {
            artifactId: 'data',
            nodeId: 'data_model' as const,
            title: 'Data Model',
            versionId: 'data-v1',
            metadata: {},
        },
        {
            artifactId: 'flows',
            nodeId: 'user_flows' as const,
            title: 'User Flows',
            versionId: 'flows-v1',
            metadata: { validationWarnings: ['One advisory warning'] },
        },
    ],
    alignments: [],
});

describe('deriveWorkflowCheckpointSummary', () => {
    it('counts ready outputs and surfaces advisory warnings once', () => {
        const summary = deriveWorkflowCheckpointSummary(baseInput());
        expect(summary.jobKey).toBe('spine-2:200');
        expect(summary.readyCount).toBe(2);
        expect(summary.items).toEqual(expect.arrayContaining([
            expect.objectContaining({
                kind: 'advisory_warning',
                artifactId: 'flows',
                title: 'User Flows',
            }),
        ]));
    });

    it('distinguishes accepted issues from active blockers', () => {
        const input = baseInput();
        input.artifacts[0].metadata = {
            validationBlockers: [{
                code: 'missing_api_surface',
                message: 'No API surface.',
                overrideability: 'rationale_required',
            }],
            validationAcceptance: {
                schemaVersion: 1,
                actor: 'user',
                acceptedAt: 300,
                rationale: 'Server actions own this boundary.',
                blockerFingerprint: 'fp-1',
            },
        };
        const accepted = deriveWorkflowCheckpointSummary(input);
        expect(accepted.acceptedIssueCount).toBe(1);
        expect(accepted.blockerCount).toBe(0);

        delete input.artifacts[0].metadata.validationAcceptance;
        const blocked = deriveWorkflowCheckpointSummary(input);
        expect(blocked.blockerCount).toBe(1);
        expect(blocked.items[0]).toMatchObject({ kind: 'blocking_issue', artifactId: 'data' });
    });

    it('surfaces failed jobs and consequential alignment without duplicating the artifact', () => {
        const input = baseInput();
        input.job.slots.user_flows = {
            status: 'error',
            attempt: 1,
            error: { message: 'Quota exhausted', category: 'quota', timestamp: 250 },
        };
        input.alignments = [{
            artifactId: 'data',
            nodeId: 'data_model',
            title: 'Data Model',
            state: 'stale',
            confidence: 'definite',
            summary: 'The entity boundary changed.',
            reasons: ['Plan changed'],
            nextAction: 'Review Data Model.',
            usefulForExploration: true,
            blocksBuildReadiness: true,
        }];
        const summary = deriveWorkflowCheckpointSummary(input);
        expect(summary.failedCount).toBe(1);
        expect(summary.alignmentCount).toBe(1);
        expect(summary.items.filter(item => item.artifactId === 'data')).toHaveLength(1);
        expect(summary.items.find(item => item.artifactId === 'data')?.details).toContain('entity boundary');
    });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx vitest run src/lib/__tests__/workflowCheckpointSummary.test.ts
```

Expected: FAIL because `../workflowCheckpointSummary` does not exist.

- [ ] **Step 3: Implement the pure summary module**

```ts
import type { ArtifactSlotKey, ProjectJobState } from '../types';
import type { OutputAlignment } from './planning/outputAlignment';
import { readArtifactValidationDisposition } from './artifactValidationPolicy';

export type CheckpointItemKind =
    | 'blocking_issue'
    | 'accepted_issue'
    | 'advisory_warning'
    | 'generation_failure'
    | 'alignment_review';

export interface CheckpointArtifactInput {
    artifactId: string;
    nodeId: ArtifactSlotKey;
    title: string;
    versionId: string;
    metadata: Record<string, unknown>;
}

export interface WorkflowCheckpointItem {
    id: string;
    kind: CheckpointItemKind;
    title: string;
    details: string;
    artifactId?: string;
    nodeId?: ArtifactSlotKey;
    versionId?: string;
}

export interface WorkflowCheckpointSummary {
    jobKey?: string;
    readyCount: number;
    blockerCount: number;
    acceptedIssueCount: number;
    advisoryWarningCount: number;
    failedCount: number;
    alignmentCount: number;
    items: WorkflowCheckpointItem[];
}

export interface WorkflowCheckpointInput {
    job?: ProjectJobState;
    artifacts: CheckpointArtifactInput[];
    alignments: OutputAlignment[];
}

const stringList = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export function deriveWorkflowCheckpointSummary(
    input: WorkflowCheckpointInput,
): WorkflowCheckpointSummary {
    const byArtifact = new Map<string, WorkflowCheckpointItem>();
    let readyCount = 0;
    let blockerCount = 0;
    let acceptedIssueCount = 0;
    let advisoryWarningCount = 0;

    for (const artifact of input.artifacts) {
        const disposition = readArtifactValidationDisposition(artifact.metadata);
        const warnings = stringList(artifact.metadata.validationWarnings);
        if (disposition.blockers.length > 0 && !disposition.accepted) {
            blockerCount += 1;
            byArtifact.set(artifact.artifactId, {
                id: `blocker:${artifact.versionId}`,
                kind: 'blocking_issue',
                title: artifact.title,
                details: disposition.blockers.map(item => item.message).join(' '),
                artifactId: artifact.artifactId,
                nodeId: artifact.nodeId,
                versionId: artifact.versionId,
            });
        } else if (disposition.accepted) {
            acceptedIssueCount += 1;
            byArtifact.set(artifact.artifactId, {
                id: `accepted:${artifact.versionId}`,
                kind: 'accepted_issue',
                title: artifact.title,
                details: disposition.accepted.rationale,
                artifactId: artifact.artifactId,
                nodeId: artifact.nodeId,
                versionId: artifact.versionId,
            });
        } else {
            readyCount += 1;
        }
        if (warnings.length > 0 && !byArtifact.has(artifact.artifactId)) {
            advisoryWarningCount += warnings.length;
            byArtifact.set(artifact.artifactId, {
                id: `warning:${artifact.versionId}`,
                kind: 'advisory_warning',
                title: artifact.title,
                details: warnings.join(' '),
                artifactId: artifact.artifactId,
                nodeId: artifact.nodeId,
                versionId: artifact.versionId,
            });
        }
    }

    let failedCount = 0;
    for (const [nodeId, slot] of Object.entries(input.job?.slots ?? {})) {
        if (slot?.status !== 'error') continue;
        failedCount += 1;
        const artifact = input.artifacts.find(item => item.nodeId === nodeId);
        const key = artifact?.artifactId ?? `slot:${nodeId}`;
        byArtifact.set(key, {
            id: `failure:${input.job?.startedAt}:${nodeId}`,
            kind: 'generation_failure',
            title: artifact?.title ?? nodeId,
            details: slot.error?.message ?? 'Generation failed.',
            artifactId: artifact?.artifactId,
            nodeId: nodeId as ArtifactSlotKey,
            versionId: artifact?.versionId,
        });
    }

    let alignmentCount = 0;
    for (const alignment of input.alignments) {
        if (alignment.state === 'aligned') continue;
        alignmentCount += 1;
        const existing = byArtifact.get(alignment.artifactId);
        byArtifact.set(alignment.artifactId, existing
            ? { ...existing, details: `${existing.details} ${alignment.summary}`.trim() }
            : {
                id: `alignment:${alignment.artifactId}`,
                kind: 'alignment_review',
                title: alignment.title,
                details: alignment.summary,
                artifactId: alignment.artifactId,
                nodeId: alignment.nodeId,
            });
    }

    return {
        jobKey: input.job ? `${input.job.spineVersionId}:${input.job.startedAt}` : undefined,
        readyCount,
        blockerCount,
        acceptedIssueCount,
        advisoryWarningCount,
        failedCount,
        alignmentCount,
        items: [...byArtifact.values()],
    };
}
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
npx vitest run src/lib/__tests__/workflowCheckpointSummary.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add src/lib/workflowCheckpointSummary.ts src/lib/__tests__/workflowCheckpointSummary.test.ts
git commit -m "feat: derive workflow checkpoint summaries"
```

### Task 2: Show one generation-complete summary

**Files:**
- Create: `src/components/workflow/GenerationOutcomeSummary.tsx`
- Create: `src/components/__tests__/GenerationOutcomeSummary.test.tsx`
- Modify: `src/components/ArtifactWorkspace.tsx`

- [ ] **Step 1: Write the failing component tests**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GenerationOutcomeSummary } from '../workflow/GenerationOutcomeSummary';

const summary = {
    jobKey: 'spine-2:200',
    readyCount: 5,
    blockerCount: 0,
    acceptedIssueCount: 1,
    advisoryWarningCount: 1,
    failedCount: 0,
    alignmentCount: 0,
    items: [
        {
            id: 'accepted:data-v1',
            kind: 'accepted_issue' as const,
            title: 'Data Model',
            details: 'Server actions own this boundary.',
            artifactId: 'data',
            nodeId: 'data_model' as const,
            versionId: 'data-v1',
        },
    ],
};

it('renders accepted issues without calling them passed', () => {
    render(<GenerationOutcomeSummary summary={summary} onOpenItem={vi.fn()} onDismiss={vi.fn()} />);
    expect(screen.getByText('Generation complete')).toBeInTheDocument();
    expect(screen.getByText('1 accepted issue')).toBeInTheDocument();
    expect(screen.queryByText(/validated|passed/i)).not.toBeInTheDocument();
});

it('opens the exact item and dismisses the current summary', () => {
    const onOpenItem = vi.fn();
    const onDismiss = vi.fn();
    render(<GenerationOutcomeSummary summary={summary} onOpenItem={onOpenItem} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /open data model/i }));
    expect(onOpenItem).toHaveBeenCalledWith(summary.items[0]);
    fireEvent.click(screen.getByRole('button', { name: /dismiss generation summary/i }));
    expect(onDismiss).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx vitest run src/components/__tests__/GenerationOutcomeSummary.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the accessible summary component**

```tsx
import { CheckCircle2, CircleAlert, X } from 'lucide-react';
import type {
    WorkflowCheckpointItem,
    WorkflowCheckpointSummary,
} from '../../lib/workflowCheckpointSummary';

interface Props {
    summary: WorkflowCheckpointSummary;
    onOpenItem: (item: WorkflowCheckpointItem) => void;
    onDismiss: () => void;
}

export function GenerationOutcomeSummary({ summary, onOpenItem, onDismiss }: Props) {
    return (
        <section className="rounded-xl border border-neutral-200 bg-white p-4" aria-labelledby="generation-outcome-heading">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h2 id="generation-outcome-heading" className="font-semibold text-neutral-950">Generation complete</h2>
                    <p className="mt-1 text-sm text-neutral-600">
                        {summary.readyCount} ready
                        {summary.acceptedIssueCount ? ` · ${summary.acceptedIssueCount} accepted issue${summary.acceptedIssueCount === 1 ? '' : 's'}` : ''}
                        {summary.advisoryWarningCount ? ` · ${summary.advisoryWarningCount} advisory warning${summary.advisoryWarningCount === 1 ? '' : 's'}` : ''}
                    </p>
                </div>
                <button type="button" onClick={onDismiss} aria-label="Dismiss generation summary" className="min-h-11 min-w-11 rounded-lg p-2 hover:bg-neutral-100">
                    <X size={16} />
                </button>
            </div>
            {summary.items.length > 0 && (
                <div className="mt-3 divide-y divide-neutral-200 border-t border-neutral-200">
                    {summary.items.map(item => (
                        <button
                            key={item.id}
                            type="button"
                            onClick={() => onOpenItem(item)}
                            className="flex min-h-11 w-full items-start gap-2 py-3 text-left"
                            aria-label={`Open ${item.title}`}
                        >
                            {item.kind === 'blocking_issue' || item.kind === 'generation_failure'
                                ? <CircleAlert size={16} className="mt-0.5 shrink-0 text-amber-600" />
                                : <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-indigo-600" />}
                            <span>
                                <span className="block text-sm font-semibold text-neutral-900">{item.title}</span>
                                <span className="mt-0.5 block text-xs leading-5 text-neutral-600">{item.details}</span>
                            </span>
                        </button>
                    ))}
                </div>
            )}
        </section>
    );
}
```

- [ ] **Step 4: Integrate session-local settled-job display in `ArtifactWorkspace`**

Add a stable empty collection constant and derive the summary from current
preferred versions:

```tsx
const [dismissedGenerationJobKey, setDismissedGenerationJobKey] = useState<string>();

const projectArtifactsForSummary = useProjectStore(
    state => state.artifacts[projectId] ?? EMPTY_ARTIFACTS,
);
const projectVersionsForSummary = useProjectStore(
    state => state.artifactVersions[projectId] ?? EMPTY_ARTIFACT_VERSIONS,
);
const checkpointArtifacts = useMemo(() => {
    return projectArtifactsForSummary
        .filter(artifact => artifact.type === 'core_artifact')
        .flatMap(artifact => {
            const preferred = projectVersionsForSummary.find(version =>
                version.artifactId === artifact.id && version.isPreferred,
            );
            if (!preferred || !artifact.subtype) return [];
            return [{
                artifactId: artifact.id,
                nodeId: artifact.subtype,
                title: getArtifactMeta(artifact.subtype).title,
                versionId: preferred.id,
                metadata: preferred.metadata,
            }];
        });
}, [projectArtifactsForSummary, projectVersionsForSummary]);

const generationSummary = useMemo(() => deriveWorkflowCheckpointSummary({
    job,
    artifacts: checkpointArtifacts,
    alignments: projectOutputAlignment.outputs,
}), [job, checkpointArtifacts, projectOutputAlignment.outputs]);

const jobSettled = !!job && Object.values(job.slots).every(slot =>
    !slot || !['queued', 'generating'].includes(slot.status),
);
const showGenerationSummary = jobSettled
    && !!generationSummary.jobKey
    && generationSummary.jobKey !== dismissedGenerationJobKey;
```

Render the summary once above the active artifact content:

```tsx
{showGenerationSummary && (
    <GenerationOutcomeSummary
        summary={generationSummary}
        onDismiss={() => setDismissedGenerationJobKey(generationSummary.jobKey)}
        onOpenItem={(item) => {
            if (item.nodeId) setSelected(item.nodeId === 'screen_inventory' ? 'screens' : item.nodeId);
        }}
    />
)}
```

Use existing stable selectors in `ArtifactWorkspace`; do not add literal `?? []`
inside Zustand selectors. Define `EMPTY_ARTIFACTS` and
`EMPTY_ARTIFACT_VERSIONS` once at module scope.

- [ ] **Step 5: Run component and workspace tests**

Run:

```bash
npx vitest run src/components/__tests__/GenerationOutcomeSummary.test.tsx src/components/__tests__/ArtifactWorkspaceTasksSelector.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/components/workflow/GenerationOutcomeSummary.tsx src/components/__tests__/GenerationOutcomeSummary.test.tsx src/components/ArtifactWorkspace.tsx
git commit -m "feat: summarize completed artifact generation"
```

### Task 3: Replace the pre-build modal with an inline checkpoint

**Files:**
- Create: `src/components/planning/PreBuildCheckpointCard.tsx`
- Create: `src/components/__tests__/PreBuildCheckpointCard.test.tsx`
- Modify: `src/components/ProjectWorkspace.tsx`
- Delete: `src/components/planning/PreBuildCheckModal.tsx`
- Delete: `src/components/__tests__/PreBuildCheckModal.test.tsx`

- [ ] **Step 1: Write failing card tests**

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PreBuildCheckpointCard } from '../planning/PreBuildCheckpointCard';

const item = {
    id: 'record-1',
    title: 'Confirm guest checkout',
};

it('is advisory and exposes review and generate actions without a duplicate count', () => {
    render(
        <PreBuildCheckpointCard
            primaryItem={item}
            onGenerate={vi.fn()}
            onReview={vi.fn()}
            onCancel={vi.fn()}
        />,
    );
    expect(screen.getByText(/generation can proceed/i)).toBeInTheDocument();
    expect(screen.queryByText(/1 open|1 unresolved/i)).not.toBeInTheDocument();
});

it('invokes each inline action', () => {
    const onGenerate = vi.fn();
    const onReview = vi.fn();
    const onCancel = vi.fn();
    render(<PreBuildCheckpointCard primaryItem={item} onGenerate={onGenerate} onReview={onReview} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole('button', { name: 'Review first' }));
    fireEvent.click(screen.getByRole('button', { name: 'Generate outputs' }));
    expect(onReview).toHaveBeenCalledOnce();
    expect(onGenerate).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(onCancel).toHaveBeenCalledOnce();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx vitest run src/components/__tests__/PreBuildCheckpointCard.test.tsx
```

Expected: FAIL because the card does not exist.

- [ ] **Step 3: Implement the inline card**

```tsx
import { AlertTriangle } from 'lucide-react';
export interface PreBuildCheckpointItem {
    id: string;
    title: string;
}

interface Props {
    primaryItem: PreBuildCheckpointItem;
    onGenerate: () => void;
    onReview: () => void;
    onCancel: () => void;
}

export function PreBuildCheckpointCard({ primaryItem, onGenerate, onReview, onCancel }: Props) {
    return (
        <section className="shrink-0 border-b border-amber-200 bg-amber-50 px-4 py-3" aria-labelledby="pre-build-heading">
            <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-start gap-2">
                    <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-700" />
                    <div>
                        <h2 id="pre-build-heading" className="text-sm font-semibold text-amber-950">
                            Before generating: {primaryItem.title}
                        </h2>
                        <p className="mt-0.5 text-xs leading-5 text-amber-800">
                            Generation can proceed. Review this first if it may change the outputs you expect.
                        </p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={onCancel} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-amber-900">Not now</button>
                    <button type="button" onClick={onReview} className="min-h-11 rounded-lg border border-amber-300 bg-white px-3 text-sm font-semibold text-amber-950">Review first</button>
                    <button type="button" onClick={onGenerate} className="min-h-11 rounded-lg bg-amber-700 px-3 text-sm font-semibold text-white">Generate outputs</button>
                </div>
            </div>
        </section>
    );
}
```

- [ ] **Step 4: Integrate the card below `PipelineStageBar`**

Remove the modal render near the other overlay dialogs. Immediately after the
`PipelineStageBar` wrapper, render:

```tsx
{showPreBuildCheck && openPlanningItems[0] && (
    <PreBuildCheckpointCard
        primaryItem={{
            id: preBuildAttentionItem?.key ?? openPlanningItems[0].id,
            title: preBuildAttentionItem?.title ?? openPlanningItems[0].title,
        }}
        onGenerate={() => {
            setShowPreBuildCheck(false);
            proceedToAssetGeneration();
        }}
        onReview={() => {
            setShowPreBuildCheck(false);
            if (preBuildAttentionItem) {
                openPlanningAttention(preBuildAttentionItem.destination);
            } else {
                openDecisionCenter(openPlanningItems[0].id, planReturnTarget);
            }
        }}
        onCancel={() => setShowPreBuildCheck(false)}
    />
)}
```

Derive `preBuildAttentionItem` immediately after `planningAttention` so the card
uses the same materiality/ranking engine as the global strip:

```tsx
const openPlanningRecordIds = new Set(openPlanningItems.map(record => record.id));
const preBuildAttentionItem = [
    planningAttention.primary,
    ...planningAttention.secondary,
].find(item => item?.destination.kind === 'planning_record'
    && openPlanningRecordIds.has(item.destination.recordId));
```

Keep `continueGenerateAfterIncompleteAck` and `preBuildCheckOffered` unchanged so
the card preserves the current once-per-component-session advisory behavior.
Do not move or bypass the incomplete-PRD confirmation or design-preset gate.

- [ ] **Step 5: Remove the old modal and run tests**

Run:

```bash
npx vitest run src/components/__tests__/PreBuildCheckpointCard.test.tsx
npm run build
```

Expected: PASS. The production build proves the `ProjectWorkspace` integration
uses the new props and that no old modal import remains.

- [ ] **Step 6: Commit Task 3**

```bash
git add src/components/ProjectWorkspace.tsx src/components/planning/PreBuildCheckpointCard.tsx src/components/__tests__/PreBuildCheckpointCard.test.tsx
git rm src/components/planning/PreBuildCheckModal.tsx src/components/__tests__/PreBuildCheckModal.test.tsx
git commit -m "refactor: make pre-build guidance inline"
```

### Task 4: Reuse the current Finalize verdict in export and handoff

**Files:**
- Modify: `src/components/ProjectWorkspace.tsx`
- Modify: `src/components/ExportModal.tsx`
- Modify: `src/lib/exportHandoff.ts`
- Modify: `src/lib/__tests__/exportHandoff.test.ts`
- Modify: `src/lib/__tests__/exportManifest.test.ts`

- [ ] **Step 1: Write failing handoff verdict tests**

```ts
it('renders a finalized verdict with accepted risks instead of exploratory copy', () => {
    const out = buildAgentHandoff({
        projectName: 'Acme',
        artifacts: [],
        planningVerdict: {
            status: 'finalized',
            label: 'Proceeding with accepted risk',
            acceptedRisks: ['Guest checkout remains deferred.'],
            rationale: 'The risk is contained for the first release.',
        },
    });
    expect(out).toContain('## Planning checkpoint');
    expect(out).toContain('Proceeding with accepted risk');
    expect(out).toContain('Guest checkout remains deferred.');
    expect(out).not.toContain('Exploratory handoff');
});

it('labels a plan with no current verdict once as a working plan', () => {
    const out = buildAgentHandoff({
        projectName: 'Acme',
        artifacts: [],
        planningVerdict: {
            status: 'working',
            label: 'Working plan',
            acceptedRisks: [],
        },
    });
    expect(out.match(/Working plan/g)).toHaveLength(1);
    expect(out).not.toContain('Exploratory handoff');
});

it('keeps the legacy exploratory input backward compatible', () => {
    const out = buildAgentHandoff({ projectName: 'Acme', artifacts: [], exploratory: true });
    expect(out).toContain('Exploratory handoff');
});
```

- [ ] **Step 2: Run tests and verify they fail**

Run:

```bash
npx vitest run src/lib/__tests__/exportHandoff.test.ts
```

Expected: FAIL because `planningVerdict` is not part of `HandoffInput`.

- [ ] **Step 3: Add the optional handoff verdict contract**

```ts
export interface HandoffPlanningVerdict {
    status: 'finalized' | 'working';
    label: string;
    acceptedRisks: string[];
    rationale?: string;
    containment?: string;
}

export interface HandoffInput {
    projectName: string;
    prdMarkdown?: string;
    artifacts: HandoffArtifact[];
    manifestMarkdown?: string;
    exploratory?: boolean;
    planningVerdict?: HandoffPlanningVerdict;
}

function renderPlanningVerdict(verdict: HandoffPlanningVerdict): string {
    const lines = ['## Planning checkpoint', '', `- Status: ${verdict.label}`];
    if (verdict.rationale) lines.push(`- Rationale: ${verdict.rationale}`);
    if (verdict.containment) lines.push(`- Containment: ${verdict.containment}`);
    if (verdict.acceptedRisks.length > 0) {
        lines.push('', '### Accepted risks', '');
        for (const risk of verdict.acceptedRisks) lines.push(`- ${risk}`);
    }
    return `${lines.join('\n')}\n\n---\n`;
}
```

In `buildAgentHandoff`, place this immediately after the preamble:

```ts
if (input.planningVerdict) {
    parts.push(renderPlanningVerdict(input.planningVerdict));
} else if (input.exploratory) {
    parts.push('> **Exploratory handoff:** This working plan has not been committed as implementation-ready. Validate unresolved assumptions and decisions before building.\n\n---\n');
}
```

- [ ] **Step 4: Prepare and pass the export verdict from `ProjectWorkspace`**

Derive one prop object from the current trusted commitment:

```tsx
const exportPlanningVerdict = currentCommittedReadiness?.commitment.activeCommit
    && currentCommittedReadiness.commitment.authorization
    ? {
        status: 'finalized' as const,
        label: currentCommittedReadiness.review.conclusion === 'ready_to_build'
            ? 'Plan finalized'
            : 'Proceeding with accepted risk',
        acceptedRisks: currentCommittedReadiness.review.concerns
            .filter(concern => currentCommittedReadiness.commitment.authorization!.acceptedConcernIds.includes(concern.id))
            .map(concern => concern.title),
        rationale: currentCommittedReadiness.commitment.authorization.rationale,
        containment: currentCommittedReadiness.commitment.authorization.containmentPlan,
    }
    : {
        status: 'working' as const,
        label: 'Working plan',
        acceptedRisks: [],
    };
```

Pass it to `ExportModal`:

```tsx
<ExportModal
    projectId={projectId}
    planningVerdict={exportPlanningVerdict}
    onClose={() => setIsExportOpen(false)}
/>
```

The authorization event carries accepted concern ids, rationale, and
containment; `plan_committed` only links to that authorization. Do not read
those fields from `activeCommit` or invent a second commitment projection.

- [ ] **Step 5: Replace the blanket export warning**

Change `ExportModalProps`:

```ts
interface ExportModalProps {
    projectId: string;
    planningVerdict: HandoffPlanningVerdict;
    onClose: () => void;
}
```

Inside `ExportModal`, prepare the same checkpoint-artifact inputs used by the
workspace from preferred core-artifact versions and derive:

```ts
const exportCheckpointSummary = deriveWorkflowCheckpointSummary({
    artifacts: orderedCoreArtifacts.flatMap(artifact => {
        const preferred = getArtifactVersions(projectId, artifact.id).find(version => version.isPreferred);
        if (!preferred || !artifact.subtype) return [];
        return [{
            artifactId: artifact.id,
            nodeId: artifact.subtype,
            title: displayTitle(artifact),
            versionId: preferred.id,
            metadata: preferred.metadata,
        }];
    }),
    alignments: outputAlignment.outputs,
});
const acceptedValidationRisks = exportCheckpointSummary.items
    .filter(item => item.kind === 'accepted_issue')
    .map(item => `${item.title}: ${item.details}`);
const handoffPlanningVerdict = {
    ...planningVerdict,
    acceptedRisks: [...planningVerdict.acceptedRisks, ...acceptedValidationRisks],
};
```

Remove the `planningReady` boolean and blanket exploratory card. Render one
planning checkpoint card:

```tsx
<div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sky-950">
    <p className="text-sm font-semibold">{planningVerdict.label}</p>
    {handoffPlanningVerdict.acceptedRisks.length > 0 ? (
        <ul className="mt-1 list-disc pl-4 text-xs leading-5 text-sky-800">
            {handoffPlanningVerdict.acceptedRisks.map(risk => <li key={risk}>{risk}</li>)}
        </ul>
    ) : (
        <p className="mt-1 text-xs text-sky-800">
            {planningVerdict.status === 'working'
                ? 'No current Finalize checkpoint is recorded. Export remains available.'
                : 'No accepted planning risks are attached to this checkpoint.'}
        </p>
    )}
</div>
```

Pass `handoffPlanningVerdict` to `buildAgentHandoff`. Add it to the structured
JSON export as optional top-level `planningVerdict`. Preserve the separate
cloud-durability and output-alignment warnings because they describe different
risks.

- [ ] **Step 6: Run export tests**

Run:

```bash
npx vitest run src/lib/__tests__/exportHandoff.test.ts src/lib/__tests__/exportManifest.test.ts
```

Expected: PASS, including the legacy `exploratory` case.

- [ ] **Step 7: Commit Task 4**

```bash
git add src/components/ProjectWorkspace.tsx src/components/ExportModal.tsx src/lib/exportHandoff.ts src/lib/__tests__/exportHandoff.test.ts src/lib/__tests__/exportManifest.test.ts
git commit -m "feat: reuse planning checkpoint in exports"
```

### Task 5: Enforce the final echo budget

**Files:**
- Modify: `src/components/review/ReviewWorkspace.tsx`
- Modify: `src/components/StructuredPRDView.tsx` if not already handled by Slice 1
- Modify: `src/components/__tests__/ReviewWorkspace.test.tsx`
- Modify: `src/components/__tests__/StructuredPRDReview.test.tsx`
- Modify: `src/components/__tests__/PlanningStateBar.test.tsx`

- [ ] **Step 1: Add failing absence assertions**

In the global-strip test created by Slice 1, render three open planning records
and assert:

```tsx
expect(screen.getByText(/3 open items/i)).toBeInTheDocument();
```

Within `ReviewWorkspace` and `StructuredPRDView` focused tests, assert:

```tsx
expect(screen.queryByText(/3 open decisions/i)).not.toBeInTheDocument();
expect(screen.queryByText(/3 planning items need review/i)).not.toBeInTheDocument();
expect(screen.getByRole('link', { name: /review planning item/i })).toBeInTheDocument();
```

- [ ] **Step 2: Run the focused tests and verify they fail**

Run:

```bash
npx vitest run src/components/__tests__/ReviewWorkspace.test.tsx src/components/__tests__/StructuredPRDReview.test.tsx src/components/__tests__/PlanningStateBar.test.tsx
```

Expected: FAIL on duplicate count text.

- [ ] **Step 3: Remove aggregate echoes but preserve contextual actions**

In `ReviewWorkspace`, remove stage/page badge text that repeats the number of
open decisions. Keep the local Decision Center queue heading and exact record
rows because that is where the items are managed.

In `StructuredPRDView`, replace aggregate banner copy:

```tsx
<button type="button" onClick={() => onOpenPlanningRecord(record.id)}>
    Review planning item
</button>
```

Do not remove exact-record deep links, return banners, source-change notices,
output-alignment warnings, or cloud-durability warnings. Those communicate
distinct context rather than repeating one open-item total.

- [ ] **Step 4: Run the focused tests**

Run:

```bash
npx vitest run src/components/__tests__/ReviewWorkspace.test.tsx src/components/__tests__/StructuredPRDReview.test.tsx src/components/__tests__/PlanningStateBar.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add src/components/review/ReviewWorkspace.tsx src/components/StructuredPRDView.tsx src/components/__tests__/ReviewWorkspace.test.tsx src/components/__tests__/StructuredPRDReview.test.tsx src/components/__tests__/PlanningStateBar.test.tsx
git commit -m "refactor: enforce planning warning echo budget"
```

### Task 6: Remove unused creation and checklist projections safely

**Files:**
- Modify: `src/store/slices/feedbackSlice.ts`
- Modify: `src/store/types.ts`
- Modify: `src/lib/projectCapabilities.ts`
- Modify: `src/lib/screenReviewWorkflow.ts`
- Modify: `src/components/__tests__/ScreenExperienceViews.test.tsx`
- Modify: `src/store/__tests__/demoReadOnlyMutations.test.ts`

- [ ] **Step 1: Add a failing screen-review model test**

Update the type-level model expectation:

```ts
const model = buildScreenReviewModel({
    screen: SCREEN,
    reviewMeta: {
        checklist: { purposeMatchesPrd: true },
        notes: 'Legacy note',
    },
});

expect(model).not.toHaveProperty('checklist');
expect(model).not.toHaveProperty('checklistProgress');
expect(model.reviewMeta?.notes).toBe('Legacy note');
expect(model.reviewMeta?.checklist?.purposeMatchesPrd).toBe(true);
```

This proves legacy metadata is readable even though the unrendered projection is
gone.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```bash
npx vitest run src/components/__tests__/ScreenExperienceViews.test.tsx
```

Expected: FAIL because `buildScreenReviewModel` still exposes checklist fields.

- [ ] **Step 3: Remove only the unused feedback creation action**

Change `FeedbackSlice` to:

```ts
export type FeedbackSlice = {
    feedbackItems: Record<string, FeedbackItem[]>;
    updateFeedbackStatus: ProjectState['updateFeedbackStatus'];
    getFeedbackItems: ProjectState['getFeedbackItems'];
};
```

Delete `createFeedbackItem` from `createFeedbackSlice`, `ProjectState`, and
`PERSISTENT_STORE_ACTIONS`. Retain:

- `feedbackItems` persisted collection;
- bundle/snapshot/sync handling;
- `updateFeedbackStatus`;
- `getFeedbackItems`;
- `FeedbackItem` domain types; and
- legacy history rendering.

Clean imports in `feedbackSlice.ts`: remove `FeedbackType` and `ArtifactType`,
but keep `uuidv4` because incorporated-status history events still use it.

- [ ] **Step 4: Remove checklist/progress from the derived model**

Update `ScreenReviewModel`:

```ts
export interface ScreenReviewModel {
    userStatus?: ScreenReviewStatus;
    systemReadiness: SystemReadinessStatus;
    issues: ScreenReviewIssue[];
    blockingCount: number;
    reviewCount: number;
    infoCount: number;
    acceptedOverWarnings: boolean;
    freshness: ScreenReviewFreshnessStatus;
    reviewMeta?: ScreenReviewMeta;
}
```

Remove `CHECKLIST_ITEM_KEYS`, `CHECKLIST_LABELS`, the checked-count calculation,
the two return properties, and the corresponding fields from
`EMPTY_REVIEW_MODEL`.

Do not remove `ScreenReviewChecklist`, `ScreenReviewMeta.checklist`, or
`parseReviewMeta`; they preserve legacy stored overlays.

- [ ] **Step 5: Run cleanup-focused tests and build**

Run:

```bash
npx vitest run src/components/__tests__/ScreenExperienceViews.test.tsx src/store/__tests__/demoReadOnlyMutations.test.ts
npm run build
```

Expected: PASS. The build catches any remaining `createFeedbackItem`,
`checklistProgress`, or derived `checklist` consumers.

- [ ] **Step 6: Commit Task 6**

```bash
git add src/store/slices/feedbackSlice.ts src/store/types.ts src/lib/projectCapabilities.ts src/lib/screenReviewWorkflow.ts src/components/__tests__/ScreenExperienceViews.test.tsx src/store/__tests__/demoReadOnlyMutations.test.ts
git commit -m "refactor: retire unused review creation paths"
```

### Task 7: Update docs and run the complete Tier 1 gate

**Files:**
- Modify: `docs/architecture/PLANNING_AND_DECISIONS.md`
- Modify: `docs/architecture/WORKSPACE_AND_ARTIFACTS.md`
- Modify: `docs/architecture/SCREENS_EXPERIENCE.md`
- Modify: `docs/architecture/SAFETY_AND_VALIDATION.md`
- Modify: `docs/architecture/VERSIONING_AND_EXPORT.md`
- Modify: `docs/architecture/UI_PATTERNS.md`
- Modify: `README.md`
- Modify if current screenshots/copy drift: `src/components/tour/tourData.ts`

- [ ] **Step 1: Update architecture documentation with exact shipped behavior**

Document:

```md
- Planning attention has one global aggregate surface below the stage rail.
- Pre-generation planning guidance is inline and advisory; the existing hard
  safety, structured-PRD, incomplete-PRD, and design-preset gates are unchanged.
- Generation completion uses a pure, non-persisted summary over current
  artifact versions, validation dispositions, job state, and alignment.
- Export reuses the current trusted readiness commitment; absent one, it labels
  the handoff Working plan once and never blocks export.
- Advisory validation warnings are visible in the completion summary.
- Legacy feedback/checklist data remains readable, but no UI creates feedback
  items and no unrendered checklist progress is derived.
```

Place each statement in its owning topic document; do not duplicate all text in
every file.

- [ ] **Step 2: Align README and tour**

In `README.md`, replace any user-visible description that says pre-build
guidance is a modal or export always receives an exploratory warning. Mention
the generation-complete summary and specific accepted-risk handoff.

In `tourData.ts`, change only frames whose copy now contradicts the global strip,
inline checkpoint, or accepted-risk export. If no frame shows those surfaces,
record in the commit message that the tour required no change; do not edit
unrelated frames.

- [ ] **Step 3: Run focused Tier 1 suites**

Run:

```bash
npx vitest run \
  src/lib/__tests__/workflowCheckpointSummary.test.ts \
  src/components/__tests__/GenerationOutcomeSummary.test.tsx \
  src/components/__tests__/PreBuildCheckpointCard.test.tsx \
  src/lib/__tests__/exportHandoff.test.ts \
  src/lib/__tests__/exportManifest.test.ts \
  src/components/__tests__/ReviewWorkspace.test.tsx \
  src/components/__tests__/StructuredPRDReview.test.tsx \
  src/components/__tests__/PlanningStateBar.test.tsx \
  src/components/__tests__/ScreenExperienceViews.test.tsx \
  src/store/__tests__/demoReadOnlyMutations.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run the complete repository gate**

Run:

```bash
npm test
npm run build
npm run lint
git diff --check
```

Expected:

- all Vitest suites pass;
- production build passes; the known CSS minifier and large-chunk warnings may
  remain but no new warning category appears;
- ESLint passes;
- `git diff --check` prints nothing.

- [ ] **Step 5: Commit docs and any final test adjustments**

```bash
git add docs/architecture README.md src/components/tour/tourData.ts
git commit -m "docs: align Synapse with Tier 1 workflow"
```

If `tourData.ts` did not require a change, omit it from `git add`.
