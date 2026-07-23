import { describe, it, expect } from 'vitest';
import {
    matchFeaturesToContent,
    repairTraceability,
    filterKnownFeatureIds,
    TRACEABILITY_SECTION_HEADING,
} from '../artifactTraceabilityRepair';
import { detectArtifactBlockers } from '../artifactBlockingValidation';
import { parseDataModelMarkdown } from '../services/dataModelMarkdown';
import type { StructuredPRD } from '../../types';

// A "Take A Hike"-style PRD: features whose names/tokens appear in generated
// artifact content only implicitly (via entity/flow names), never verbatim.
const prd = {
    vision: 'Plan safe multi-day hikes.',
    coreProblem: 'Planning hazard-aware backcountry trips is hard.',
    targetUsers: ['Backpackers'],
    architecture: 'SPA + API',
    risks: [],
    features: [
        {
            id: 'f1',
            name: 'Trip Creation',
            description: 'Create a multi-day trip itinerary for a chosen park.',
            userValue: 'Get started planning fast.',
            complexity: 'medium',
        },
        {
            id: 'f2',
            name: 'Route Planning',
            description: 'Plan hazard-aware routes with waypoints and segments.',
            userValue: 'Avoid dangerous terrain.',
            complexity: 'high',
        },
        {
            id: 'f3',
            name: 'Daily Scheduling',
            description: 'Break a trip into daily schedules.',
            userValue: 'Pace the hike.',
            complexity: 'low',
        },
    ],
} as unknown as StructuredPRD;

const dataModelContent = `# Data Model

## How This Data Model Works

Stores a hiker's plan.

## TripItinerary

Represents a planned multi-day journey through a park.

**Fields**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| id | string | Yes | Identifier |
| park | string | Yes | Chosen park |

## DailySchedules

A per-day plan within an itinerary.

## RouteSegments

An ordered leg of the route between waypoints.

## Waypoints

A named point along the route.

## API Endpoints

| Method | Path | Description | Entity |
|--------|------|-------------|--------|
| GET | /itineraries | List itineraries | TripItinerary |
`;

describe('matchFeaturesToContent', () => {
    it('matches features by token overlap even without explicit names/ids', () => {
        const matches = matchFeaturesToContent(dataModelContent, prd);
        const ids = matches.map(m => m.featureId).sort();
        // "trip"/"itinerary", "route"/"waypoints", "daily"/"schedules" all appear.
        expect(ids).toContain('f1');
        expect(ids).toContain('f2');
        expect(ids).toContain('f3');
    });

    it('never returns a feature id that is not in the PRD', () => {
        const matches = matchFeaturesToContent(dataModelContent, prd);
        const known = new Set(prd.features.map(f => f.id));
        for (const m of matches) expect(known.has(m.featureId)).toBe(true);
    });

    it('returns no matches for content unrelated to the PRD', () => {
        const unrelated = `# Data Model\n\n## WeatherTile\nShows the forecast temperature.\n\n## API Endpoints\n| GET | /weather |\n`;
        expect(matchFeaturesToContent(unrelated, prd)).toEqual([]);
    });

    it('scores a direct id/name reference highest', () => {
        const withId = dataModelContent + '\n\nImplements f1.';
        const matches = matchFeaturesToContent(withId, prd);
        const f1 = matches.find(m => m.featureId === 'f1');
        expect(f1?.score).toBe(100);
    });
});

describe('repairTraceability — data_model', () => {
    it('enriches a structurally-valid data model and clears the traceability blocker', () => {
        // Precondition: the artifact trips ONLY the traceability blocker.
        const before = detectArtifactBlockers('data_model', dataModelContent, prd);
        expect(before.some(b => b.code === 'prd_traceability_unverified')).toBe(true);
        expect(before.some(b => b.code === 'data_model_api_surface_missing')).toBe(false);

        const repair = repairTraceability('data_model', dataModelContent, prd);
        expect(repair.repaired).toBe(true);
        expect(repair.content).toContain(TRACEABILITY_SECTION_HEADING);
        expect(repair.mappedFeatures.length).toBeGreaterThan(0);

        // Revalidation: the traceability blocker is gone after repair.
        const after = detectArtifactBlockers('data_model', repair.content, prd);
        expect(after).toEqual([]);
    });

    it('preserves the original content (append-only, no rewrite)', () => {
        const repair = repairTraceability('data_model', dataModelContent, prd);
        expect(repair.content.startsWith(dataModelContent.replace(/\s+$/, ''))).toBe(true);
        // Original entity headings are untouched.
        expect(repair.content).toContain('## TripItinerary');
        expect(repair.content).toContain('## RouteSegments');
    });

    it('does not render the appended traceability section as a bogus entity', () => {
        const repair = repairTraceability('data_model', dataModelContent, prd);
        const parsed = parseDataModelMarkdown(repair.content);
        expect(parsed).not.toBeNull();
        const entityNames = parsed!.entities.map(e => e.name);
        expect(entityNames).not.toContain(TRACEABILITY_SECTION_HEADING);
        // The real entities still parse.
        expect(entityNames).toContain('TripItinerary');
    });
});

describe('repairTraceability — user_flows', () => {
    it('enriches a flow that has project-relevant content but no explicit feature ids', () => {
        const flows = `# User Flows

### Flow: First-Time User Onboarding and Journey Setup
**Goal:** Set up an initial itinerary and plan a route.
**Steps:**
1. Home — User picks a park.
2. Route — User adds waypoints and segments.
**Error Paths:**
- Network error → retry.
`;
        const before = detectArtifactBlockers('user_flows', flows, prd);
        expect(before.some(b => b.code === 'prd_traceability_unverified')).toBe(true);

        const repair = repairTraceability('user_flows', flows, prd);
        expect(repair.repaired).toBe(true);
        const after = detectArtifactBlockers('user_flows', repair.content, prd);
        expect(after).toEqual([]);
    });
});

describe('repairTraceability — failure cases', () => {
    it('fails (no change) when nothing maps to the PRD', () => {
        const unrelated = `# User Flows\n\n### Flow: Weather Forecast\n**Goal:** Show temperature.\n**Error Paths:**\n- none.\n`;
        const repair = repairTraceability('user_flows', unrelated, prd);
        expect(repair.repaired).toBe(false);
        expect(repair.content).toBe(unrelated);
        expect(repair.warnings.length).toBeGreaterThan(0);
        // Blocker survives a failed repair.
        const after = detectArtifactBlockers('user_flows', repair.content, prd);
        expect(after.some(b => b.code === 'prd_traceability_unverified')).toBe(true);
    });

    it('fails when the PRD has no features', () => {
        const noFeatures = { ...prd, features: [] } as unknown as StructuredPRD;
        const repair = repairTraceability('data_model', dataModelContent, noFeatures);
        expect(repair.repaired).toBe(false);
    });
});

describe('filterKnownFeatureIds', () => {
    it('drops invented ids, keeps canonical ids (case-insensitive, deduped)', () => {
        expect(filterKnownFeatureIds(['f1', 'F2', 'f99', 'f1'], prd)).toEqual(['f1', 'f2']);
    });
});
