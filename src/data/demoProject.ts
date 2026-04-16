/**
 * Static demo-project fixture.
 *
 * This file ships a fully-finished Synapse project ("Demo: Fitness tracker")
 * so any visitor can explore the end-to-end pipeline — finished PRD, a mockup
 * with screens, and all 7 core artifacts — without providing a Gemini API key.
 *
 * The content is captured once by running the pipeline in /admin/capture-demo
 * (see src/components/AdminCaptureDemo.tsx). That helper is only available in
 * dev builds; it downloads a regenerated version of this file which is then
 * committed over the top of the old one.
 *
 * IMPORTANT: keep `DEMO_PROJECT_ID` stable. The store's `loadDemoProject()`
 * action keys on it for idempotency — if we changed the id, every prior
 * visitor would get a duplicate copy on next visit.
 */

import type {
    Project,
    SpineVersion,
    Artifact,
    ArtifactVersion,
    HistoryEvent,
} from '../types';

export const DEMO_PROJECT_ID = '00000000-0000-4000-8000-000000000d01';

/**
 * True when the fixture has real captured content. The capture helper flips
 * this to `true` when it writes the file. Until then, `loadDemoProject()`
 * surfaces a friendly error instead of hydrating an empty shell.
 */
export const DEMO_PROJECT_CAPTURED = false;

export const demoProject: Project = {
    id: DEMO_PROJECT_ID,
    name: 'Demo: Fitness tracker',
    createdAt: 0,
    platform: 'app',
    currentStage: 'artifacts',
};

export const demoSpineVersions: SpineVersion[] = [];
export const demoArtifacts: Artifact[] = [];
export const demoArtifactVersions: ArtifactVersion[] = [];
export const demoHistoryEvents: HistoryEvent[] = [];
