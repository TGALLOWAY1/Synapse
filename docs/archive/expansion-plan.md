# Synapse Expansion — Implementation Plan

## Overview
Expand Synapse from a 3-stage PRD pipeline into a 5-section artifact-driven workspace: **Explore → PRD → Mockups → Artifacts → History**. Migrate existing DevPlan and AgentPrompt into the new generic Artifact/ArtifactVersion model. Text-based mockup generation via Gemini API.

---

## Phase 1: Artifact Foundation & Type System

### 1.1 Expand types (`src/types/index.ts`)

**New types to add:**

```typescript
// Expand PipelineStage to cover new sections
export type PipelineStage = 'prd' | 'mockups' | 'artifacts' | 'history';

// Artifact type enum
export type ArtifactType = 'prd' | 'mockup' | 'prompt' | 'core_artifact';

// Core artifact subtypes
export type CoreArtifactSubtype =
  | 'screen_inventory' | 'user_flows' | 'component_inventory'
  | 'implementation_plan' | 'data_model' | 'prompt_pack' | 'design_system';

// Staleness states
export type StalenessState = 'current' | 'possibly_outdated' | 'outdated';

// Source reference - tracks provenance
export type SourceRef = {
  id: string;
  sourceArtifactId: string;
  sourceArtifactVersionId: string;
  sourceType: ArtifactType;
  anchorInfo?: string; // optional section/selection reference
};

// Generic Artifact container
export type Artifact = {
  id: string;
  projectId: string;
  type: ArtifactType;
  subtype?: CoreArtifactSubtype;
  title: string;
  status: 'draft' | 'active' | 'archived';
  currentVersionId: string | null;
  createdAt: number;
  updatedAt: number;
};

// Immutable version of an artifact
export type ArtifactVersion = {
  id: string;
  artifactId: string;
  versionNumber: number;
  parentVersionId: string | null;
  content: string; // markdown/structured text content
  metadata: Record<string, unknown>; // flexible metadata (e.g., mockup settings, structured data)
  sourceRefs: SourceRef[];
  generationPrompt: string;
  isPreferred: boolean; // user-designated preferred version
  createdAt: number;
};

// Feedback from mockups/artifacts back to PRD
export type FeedbackType =
  | 'feature_addition' | 'workflow_refinement' | 'ia_navigation'
  | 'missing_state' | 'visual_system' | 'ambiguous_requirement'
  | 'implementation_consideration' | 'naming_wording';

export type FeedbackItem = {
  id: string;
  projectId: string;
  sourceArtifactVersionId: string;
  type: FeedbackType;
  title: string;
  description: string;
  status: 'open' | 'accepted' | 'rejected' | 'incorporated';
  targetArtifactType: ArtifactType;
  createdAt: number;
  updatedAt: number;
};

// Mockup generation settings
export type MockupSettings = {
  platform: 'mobile' | 'desktop' | 'responsive';
  fidelity: 'low' | 'mid' | 'high';
  style?: string;
  scope: 'single_screen' | 'multi_screen' | 'key_workflow';
  notes?: string;
  selectedSections?: string[]; // PRD section IDs to focus on
};

// Prompt artifact settings
export type PromptTarget = 'mockup' | 'coding' | 'ux_critique' | 'implementation' | 'user_flow' | 'testing' | 'launch_copy';
```

**Expand HistoryEvent type:**
```typescript
export type HistoryEvent = {
  id: string;
  projectId: string;
  spineVersionId?: string; // optional now (not all events are spine-related)
  artifactId?: string;
  artifactVersionId?: string;
  type: "Init" | "Regenerated" | "Consolidated" | "ArtifactGenerated" | "ArtifactRegenerated" | "FeedbackCreated" | "FeedbackApplied";
  description: string;
  diff?: { ... };
  createdAt: number;
};
```

**Keep existing types** (SpineVersion, Branch, BranchMessage, StructuredPRD, Feature) — SpineVersion remains the PRD-specific version model. The Artifact model wraps it for provenance tracking.

**Remove from types** (after migration): `DevPlan`, `Milestone`, `DevTask`, `AgentPrompt`, `AgentTarget` — these become `core_artifact` and `prompt` type artifacts with their data stored in ArtifactVersion.content/metadata.

### 1.2 Expand store (`src/store/projectStore.ts`)

**New state fields:**
```typescript
artifacts: Record<string, Artifact[]>;        // keyed by projectId
artifactVersions: Record<string, ArtifactVersion[]>; // keyed by projectId
feedbackItems: Record<string, FeedbackItem[]>; // keyed by projectId
```

**New actions:**
```typescript
// Artifact CRUD
createArtifact: (projectId, type, title, subtype?) => { artifactId }
updateArtifact: (projectId, artifactId, updates) => void
deleteArtifact: (projectId, artifactId) => void
getArtifacts: (projectId, type?) => Artifact[]
getArtifact: (projectId, artifactId) => Artifact | undefined

// ArtifactVersion CRUD
createArtifactVersion: (projectId, artifactId, content, metadata, sourceRefs, generationPrompt, parentVersionId?) => { versionId }
setPreferredVersion: (projectId, artifactId, versionId) => void
getArtifactVersions: (projectId, artifactId) => ArtifactVersion[]
getPreferredVersion: (projectId, artifactId) => ArtifactVersion | undefined
getLatestVersion: (projectId, artifactId) => ArtifactVersion | undefined

// Feedback CRUD
createFeedbackItem: (projectId, sourceArtifactVersionId, type, title, description, targetArtifactType) => { feedbackId }
updateFeedbackStatus: (projectId, feedbackId, status) => void
getFeedbackItems: (projectId, status?) => FeedbackItem[]

// Staleness
getArtifactStaleness: (projectId, artifactId) => StalenessState
```

**Migration logic:** On store initialization, detect legacy `devPlans` and `agentPrompts` and convert them to Artifact/ArtifactVersion entries. Add a `_migrated` flag to prevent re-migration.

### 1.3 Expand history events

Update `createArtifactVersion` to automatically create a HistoryEvent of type "ArtifactGenerated". Update feedback application to create "FeedbackApplied" events.

---

## Phase 2: Navigation & Mockups

### 2.1 Update PipelineStageBar (`src/components/PipelineStageBar.tsx`)

Change from 3 linear stages to 5 sections:
- **PRD** (FileText icon) — always enabled
- **Mockups** (Image icon) — enabled when PRD has isFinal spine
- **Artifacts** (Package icon) — enabled when PRD has isFinal spine
- **History** (Clock icon) — always enabled

Remove the linear chevron-arrow progression. Use a horizontal tab bar instead (since sections are no longer strictly linear). Update `PipelineStage` type accordingly.

### 2.2 Update ProjectWorkspace (`src/components/ProjectWorkspace.tsx`)

Add conditional rendering for new stages:
```tsx
{pipelineStage === 'mockups' && <MockupsView projectId={projectId} />}
{pipelineStage === 'artifacts' && <ArtifactsView projectId={projectId} />}
{pipelineStage === 'history' && <HistoryView projectId={projectId} />}
```

### 2.3 Create MockupsView (`src/components/MockupsView.tsx`)

**Layout:** Full workspace page with:
- Header: "Mockups" title + "Generate Mockup" button
- Settings panel: platform, fidelity, style, scope, notes, PRD section picker
- Mockup list: cards showing generated mockup versions
- Selected mockup detail view with version comparison

**Key interactions:**
1. User configures settings → clicks Generate → calls LLM → creates Artifact + ArtifactVersion
2. User views generated mockup (rendered markdown/structured text)
3. User marks a version as preferred
4. User creates FeedbackItem from a mockup insight
5. User compares two mockup versions side-by-side

**Sub-components:**
- `MockupGeneratePanel.tsx` — settings form + generate button
- `MockupCard.tsx` — card displaying a mockup version summary
- `MockupDetailView.tsx` — full view of selected mockup with feedback actions
- `MockupCompareView.tsx` — side-by-side comparison of two versions
- `FeedbackModal.tsx` — modal for creating structured feedback items

### 2.4 Add LLM functions (`src/lib/llmProvider.ts`)

```typescript
export const generateMockup = async (
  prdContent: string,
  settings: MockupSettings,
  options?: ProviderOptions
): Promise<string> => { ... }
```

The system prompt should instruct Gemini to generate:
- Screen-by-screen descriptions
- ASCII wireframe layouts
- Component hierarchy
- Navigation flows
- Interaction annotations

For each selected scope (single screen, multi-screen, key workflow).

---

## Phase 3: Core Artifacts & Prompts

### 3.1 Create ArtifactsView (`src/components/ArtifactsView.tsx`)

**Layout:**
- Header: "Core Artifacts" + "Generate Bundle" button + individual artifact generate buttons
- Grid/list of artifact cards showing each generated artifact
- Each card shows: title, type, staleness badge, version count, last generated timestamp
- Click to expand/view artifact content

**Core artifacts (V1 bundle):**
1. Screen Inventory
2. User Flows
3. Component Inventory
4. Implementation Plan (replaces DevPlan)
5. Data Model Draft
6. Prompt Pack (replaces AgentPrompt)
7. Design System Starter

**Sub-components:**
- `ArtifactCard.tsx` — card for each artifact with staleness indicator
- `ArtifactDetailView.tsx` — full view with version history, regenerate button
- `ArtifactVersionList.tsx` — version timeline for an artifact
- `StalenessBadge.tsx` — visual staleness indicator component
- `GenerateBundleModal.tsx` — modal for generating all/selected core artifacts

### 3.2 Create PromptGenerationView (inside ArtifactsView)

Prompts are a type of artifact. The ArtifactsView includes a "Prompts" section or tab:
- Generate prompt from PRD or another artifact
- Select target use case (mockup, coding, UX critique, etc.)
- Edit before saving
- Save as versioned prompt artifact

### 3.3 Add LLM functions for core artifacts

Add to `src/lib/llmProvider.ts`:
```typescript
export const generateCoreArtifact = async (
  subtype: CoreArtifactSubtype,
  prdContent: string,
  structuredPRD: StructuredPRD,
  options?: ProviderOptions
): Promise<string> => { ... }

export const generatePromptArtifact = async (
  sourceContent: string,
  target: PromptTarget,
  options?: ProviderOptions
): Promise<string> => { ... }
```

Each subtype gets a tailored system prompt for high-quality generation.

### 3.4 Staleness detection logic

In the store or a utility:
```typescript
function computeStaleness(artifact, latestSpineVersion, artifactVersions): StalenessState {
  const latestVersion = artifactVersions.find(v => v.isPreferred) || artifactVersions[artifactVersions.length - 1];
  if (!latestVersion) return 'outdated';

  const sourceRef = latestVersion.sourceRefs.find(r => r.sourceType === 'prd');
  if (!sourceRef) return 'possibly_outdated';

  if (sourceRef.sourceArtifactVersionId === latestSpineVersion.id) return 'current';

  // Check if PRD content actually changed
  return 'possibly_outdated';
}
```

---

## Phase 4: History View & Feedback Loop

### 4.1 Create HistoryView (`src/components/HistoryView.tsx`)

**Layout:** Unified timeline showing:
- PRD version events (Init, Regenerated, Consolidated)
- Artifact generation events
- Feedback creation/application events
- Grouped by date, sorted newest first

Replace the existing right-sidebar history tab with a link to this full-page view.

### 4.2 Feedback-to-PRD refinement flow

When user clicks "Apply to PRD" on a FeedbackItem:
1. Navigate to PRD stage
2. Pre-populate a branch with the feedback content
3. User can consolidate as normal
4. Mark feedback as "incorporated"
5. Dependent artifacts show as stale

---

## File Change Summary

### New files (11):
1. `src/components/MockupsView.tsx` — main mockups page
2. `src/components/MockupGeneratePanel.tsx` — generation settings form
3. `src/components/MockupCard.tsx` — mockup version card
4. `src/components/MockupDetailView.tsx` — mockup detail with feedback
5. `src/components/MockupCompareView.tsx` — side-by-side comparison
6. `src/components/ArtifactsView.tsx` — main artifacts page
7. `src/components/ArtifactCard.tsx` — artifact summary card
8. `src/components/ArtifactDetailView.tsx` — artifact detail with versions
9. `src/components/StalenessBadge.tsx` — staleness indicator
10. `src/components/FeedbackModal.tsx` — structured feedback creation
11. `src/components/HistoryView.tsx` — full-page history timeline

### Modified files (5):
1. `src/types/index.ts` — new types + expanded existing types
2. `src/store/projectStore.ts` — new state + actions + migration
3. `src/lib/llmProvider.ts` — new generation functions
4. `src/components/PipelineStageBar.tsx` — new navigation layout
5. `src/components/ProjectWorkspace.tsx` — route new stages to new views

### Preserved files (no changes needed):
- `src/App.tsx` — routing unchanged
- `src/components/HomePage.tsx` — unchanged
- `src/components/SelectableSpine.tsx` — unchanged
- `src/components/BranchList.tsx` — unchanged
- `src/components/BranchCanvas.tsx` — unchanged
- `src/components/ConsolidationModal.tsx` — unchanged
- `src/components/StructuredPRDView.tsx` — unchanged
- `src/components/FeatureCard.tsx` — unchanged
- `src/components/SettingsModal.tsx` — unchanged
- `src/components/MilestoneCard.tsx` — kept for backward compat

### Deprecated (kept but unused after migration):
- `src/components/DevPlanView.tsx` — replaced by ArtifactsView
- `src/components/AgentPromptView.tsx` — replaced by ArtifactsView
- `src/components/AgentPromptCard.tsx` — replaced by ArtifactCard

---

## Implementation Order

1. **Phase 1** — Types + Store + Migration (foundation, no UI changes yet)
2. **Phase 2** — PipelineStageBar + MockupsView + LLM mockup generation
3. **Phase 3** — ArtifactsView + Core artifact generation + Prompt generation + Staleness
4. **Phase 4** — HistoryView + Feedback loop + Polish
