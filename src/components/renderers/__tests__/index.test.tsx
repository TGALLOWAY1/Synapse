import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { ArtifactContentRenderer } from '../index';

describe('ArtifactContentRenderer', () => {
    it('renders markdown content for screen_inventory when content is not JSON', () => {
        const markdownContent = '# Screen Inventory\n\n## Auth Group\n\n### Login Screen\n- Purpose: User authentication';
        const { container } = render(
            <ArtifactContentRenderer subtype="screen_inventory" content={markdownContent} />
        );
        // Should render via ReactMarkdown, producing an h1
        expect(container.querySelector('h1')).toHaveTextContent('Screen Inventory');
    });

    it('renders structured content for screen_inventory in the new sections shape', () => {
        const jsonContent = JSON.stringify({
            sections: [{
                title: 'Mood Capture',
                description: 'Where the user records a vibe.',
                flowSummary: 'Landing → Capture → Loading → Player',
                screens: [{
                    name: 'Mood Ingestion Portal',
                    type: 'screen',
                    priority: 'P0',
                    purpose: 'Capture a mood signal from the camera',
                    userIntent: 'Share a vibe in under 5 seconds',
                    states: [
                        { name: 'Default', description: 'Camera active' },
                        { name: 'Loading', description: 'Submitting capture' },
                        { name: 'Camera denied', description: 'Permission refused', trigger: 'permission denied' },
                    ],
                    entryPoints: ['Landing', 'Shared Vibe'],
                    exitPaths: [
                        { label: 'Submit', target: 'Loading' },
                        { label: 'Camera denied', target: 'Text Fallback', condition: 'permission denied' },
                    ],
                    coreUIElements: ['Mood capture canvas', 'Submit CTA'],
                    outputData: ['mood vector'],
                    risks: ['Camera permission denied'],
                    featureRefs: ['F-014'],
                }],
            }],
        });
        const { container } = render(
            <ArtifactContentRenderer subtype="screen_inventory" content={jsonContent} />
        );
        // Section header is numbered.
        expect(container).toHaveTextContent('1.');
        expect(container).toHaveTextContent('Mood Capture');
        expect(container).toHaveTextContent('Mood Ingestion Portal');
        // Priority badge.
        expect(container).toHaveTextContent('P0');
        // User intent + state chip.
        expect(container).toHaveTextContent('Share a vibe in under 5 seconds');
        expect(container).toHaveTextContent('Camera denied');
        // Exit path target.
        expect(container).toHaveTextContent('Text Fallback');
        // Risk callout copy.
        expect(container).toHaveTextContent('Camera permission denied');
        // Section-level Journey row (replaces the old `flow:` text).
        expect(container).toHaveTextContent('Journey');
        expect(container).not.toHaveTextContent(/^\s*flow:/);
        expect(container).toHaveTextContent('Landing');
        expect(container).toHaveTextContent('Capture');
        expect(container).toHaveTextContent('Player');
        // Card-level Navigation subsection groups Entry + Exit.
        expect(container).toHaveTextContent('Navigation');
        expect(container).toHaveTextContent('Entry');
        expect(container).toHaveTextContent('Exit');
        // Linked Features label + the feature ref still surfaces.
        expect(container).toHaveTextContent('Linked Features');
        expect(container).toHaveTextContent('F-014');
        // Screen count metadata.
        expect(container).toHaveTextContent('1 screen');
    });

    it('renders feature ref pills with id + label when refs include names', () => {
        const jsonContent = JSON.stringify({
            sections: [{
                title: 'Household Meal Logistics',
                screens: [{
                    name: 'Smart Grocery List',
                    priority: 'P0',
                    purpose: 'Aggregate ingredients into a shopping list',
                    featureRefs: ['f8 Ingredient Aggregation', 'f10 Grocery Export', 'f12'],
                }],
            }],
        });
        const { container } = render(
            <ArtifactContentRenderer subtype="screen_inventory" content={jsonContent} />
        );
        expect(container).toHaveTextContent('Linked Features');
        // Ids and human-readable labels both render.
        expect(container).toHaveTextContent('f8');
        expect(container).toHaveTextContent('Ingredient Aggregation');
        expect(container).toHaveTextContent('f10');
        expect(container).toHaveTextContent('Grocery Export');
        // Bare ids without a label still render.
        expect(container).toHaveTextContent('f12');
    });

    it('renders legacy groups + core/secondary priorities by normalizing on read', () => {
        const legacyJson = JSON.stringify({
            groups: [{
                name: 'Auth',
                screens: [{
                    name: 'Login',
                    purpose: 'User authentication',
                    components: ['EmailInput', 'PasswordInput'],
                    priority: 'core',
                    navigationFrom: ['Landing'],
                    navigationTo: ['Dashboard'],
                }],
            }],
        });
        const { container } = render(
            <ArtifactContentRenderer subtype="screen_inventory" content={legacyJson} />
        );
        expect(container).toHaveTextContent('Login');
        // Legacy 'core' migrates to P0.
        expect(container).toHaveTextContent('P0');
        // Legacy components survive as core UI.
        expect(container).toHaveTextContent('EmailInput');
        // Legacy navigation surfaces as entry/exit blocks.
        expect(container).toHaveTextContent('Landing');
        expect(container).toHaveTextContent('Dashboard');
    });

    it('renders markdown for subtypes without structured renderers', () => {
        const content = '# User Flows\n\n## Login Flow\n\n1. User opens app\n2. User enters credentials';
        const { container } = render(
            <ArtifactContentRenderer subtype="user_flows" content={content} />
        );
        expect(container.querySelector('h1')).toHaveTextContent('User Flows');
        expect(container.querySelector('ol')).toBeTruthy();
    });

    it('falls back to markdown when content is unparseable for data_model', () => {
        const garbage = 'this is not a data model artifact at all';
        const { container } = render(
            <ArtifactContentRenderer subtype="data_model" content={garbage} />
        );
        // Should not crash — renders as text via ReactMarkdown fallback
        expect(container).toHaveTextContent('this is not a data model artifact at all');
    });

    it('renders structured user_flows content with sidebar navigation when `### Flow:` heading is present', () => {
        const flowMarkdown = `### Flow: Login
**Goal:** User authenticates to access account.
**Steps:**
1. [Login] — User enters credentials → System validates
**Success Outcome:** Dashboard loads.`;
        const { container } = render(
            <ArtifactContentRenderer subtype="user_flows" content={flowMarkdown} />
        );
        expect(container).toHaveTextContent('Login');
        expect(container).toHaveTextContent('Goal');
        // step number badge
        expect(container).toHaveTextContent('1');
    });

    it('renders structured data_model content when valid JSON is provided', () => {
        const jsonContent = JSON.stringify({
            entities: [{
                name: 'User',
                description: 'Application user',
                fields: [
                    { name: 'id', type: 'UUID', required: true, description: 'Primary key' },
                    { name: 'email', type: 'string', required: true, description: 'Email address' },
                ],
                relationships: [],
            }],
            apiEndpoints: [],
        });
        const { container } = render(
            <ArtifactContentRenderer subtype="data_model" content={jsonContent} />
        );
        expect(container).toHaveTextContent('User');
        expect(container).toHaveTextContent('email');
    });

    it('renders rich data_model content when full markdown shape is provided', () => {
        const richMarkdown = `# Data Model

## How This Data Model Works

User input creates a Snapshot which seeds a Playlist.

**Data flow:** User → Snapshot → Playlist.

**Product outcome:** Adaptive playlists.

## Snapshot

Captures emotional state.

**Purpose:** Acts as the seed.
**Visibility:** User-facing
**Mutability:** mostly_immutable

**Key Product Fields**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| joy_score | Float | Yes | Joy intensity |

> [!CONSTRAINT] joy_score must be between 0 and 1
> [!PRIVACY] raw_input must be null when source is FACE_SCAN

## How This Appears in the Product

| Field | UI behavior |
|-------|-------------|
| \`joy_score\` | Drives playlist energy |

## API Endpoints

| Method | Path | Description | Entity |
|--------|------|-------------|--------|
| GET | /api/snapshots | List snapshots | Snapshot |
`;
        const { container } = render(
            <ArtifactContentRenderer subtype="data_model" content={richMarkdown} />
        );
        expect(container).toHaveTextContent('How This Data Model Works');
        expect(container).toHaveTextContent('Snapshot');
        expect(container).toHaveTextContent('joy_score');
        expect(container).toHaveTextContent('Constraint');
        expect(container).toHaveTextContent('Privacy');
        expect(container).toHaveTextContent('How This Appears in the Product');
    });

    it('renders legacy data_model markdown without crashing', () => {
        const legacy = `# Data Model

## Patient
A patient record.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | UUID | Yes | Primary key |
| name | String | Yes | Full name |

**Relationships:**
- has many Visit (via foreign key \`patient_id\`)

## API Endpoints

| Method | Path | Description | Entity |
|--------|------|-------------|--------|
| GET | /api/patients | List patients | Patient |
`;
        const { container } = render(
            <ArtifactContentRenderer subtype="data_model" content={legacy} />
        );
        expect(container).toHaveTextContent('Patient');
        expect(container).toHaveTextContent('id');
        expect(container).toHaveTextContent('name');
    });

});
