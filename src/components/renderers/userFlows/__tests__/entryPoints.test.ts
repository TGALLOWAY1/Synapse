import { describe, expect, it } from 'vitest';
import { parseFlows } from '../parseFlow';

describe('parseFlows — entry points vs preconditions', () => {
    it('uses an explicit `**Entry Points:**` block when present', () => {
        const md = `### Flow: Workout
**Preconditions:** User has an active \`WorkoutSession\`.
**Entry Points:**
- Tap "Resume workout" on the Today screen
- Open notification deep-link
**Steps:**
1. [Today] — User taps resume → System loads cached program`;
        const flow = parseFlows(md)[0];
        expect(flow.entryPoints).toEqual([
            'Tap "Resume workout" on the Today screen',
            'Open notification deep-link',
        ]);
        expect(flow.preconditions).toMatch(/active `WorkoutSession`/);
    });

    it('drops entry-point lines that are byte-equal to the preconditions sentence', () => {
        const md = `### Flow: Onboarding
**Preconditions:** User has installed the PWA, authenticated, and has no active \`AdaptiveProgram\`.
**Entry Points:**
- User has installed the PWA, authenticated, and has no active \`AdaptiveProgram\`.
**Steps:**
1. [Home] — User taps Get Started → System launches the setup wizard`;
        const flow = parseFlows(md)[0];
        // The duplicated entry-point line should be removed (this is the
        // exact pathology seen in the screenshot of the current UI).
        expect(flow.entryPoints).toEqual([]);
    });

    it('infers entry points from preconditions only when they look like a list', () => {
        const md = `### Flow: Mixed
**Preconditions:**
- User is authenticated
- Today screen is open
**Steps:**
1. [Today] — User taps start → System begins workout`;
        const flow = parseFlows(md)[0];
        // Multi-bullet preconditions get surfaced as inferred entry points.
        expect(flow.entryPoints.length).toBe(2);
    });

    it('does NOT infer an entry point from a single-paragraph precondition', () => {
        const md = `### Flow: Mixed
**Preconditions:** User is authenticated.
**Steps:**
1. [Home] — User taps a button → System fires`;
        const flow = parseFlows(md)[0];
        // Single-sentence preconditions are state-facts, not entry points.
        // Surfacing them would just duplicate the preconditions card.
        expect(flow.entryPoints).toEqual([]);
    });
});

describe('parseFlows — assumptions / open questions / risk', () => {
    it('parses `**Assumptions:**` and `**Open Questions:**` sections', () => {
        const md = `### Flow: Recovery
**Steps:**
1. [Home] — User opens app → System checks state
**Assumptions:**
- Service Worker installs on first visit
- Cached program is at most 7 days old
**Open Questions:**
- What if the user changes devices mid-flow?`;
        const flow = parseFlows(md)[0];
        expect(flow.assumptions).toMatch(/Service Worker/);
        expect(flow.openQuestions).toMatch(/changes devices/);
    });

    it('assigns a high-risk label when failure modes or unresolved refs exist', () => {
        const md = `### Flow: Dangerous
**Steps:**
1. [Home] — User does X → System returns 500 and cannot recover
**Error Paths:**
- Service returns 500 and cannot recover, hard fail
- TBD: confirm canonical id once feature catalog ships`;
        const flow = parseFlows(md)[0];
        expect(flow.risk).toBe('high');
    });

    it('assigns a medium-risk label when only alternate paths or edge cases exist', () => {
        const md = `### Flow: Reasonable
**Steps:**
1. [Home] — User opens app → System loads
**Error Paths:**
- Network timeout → retry with backoff`;
        const flow = parseFlows(md)[0];
        expect(flow.risk).toBe('medium');
    });

    it('assigns a low-risk label when no issues are present', () => {
        const md = `### Flow: Safe
**Steps:**
1. [Home] — User opens app → System renders`;
        const flow = parseFlows(md)[0];
        expect(flow.risk).toBe('low');
    });
});
