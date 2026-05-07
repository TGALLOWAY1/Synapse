import { describe, expect, it } from 'vitest';
import { parseFlows } from '../parseFlow';

describe('parseFlows', () => {
    it('returns empty array when no `### Flow:` headings exist (preserves fallback)', () => {
        const md = '# User Flows\n\n## Login Flow\n\n1. User opens app';
        expect(parseFlows(md)).toEqual([]);
    });

    it('parses the canonical generation prompt format', () => {
        const md = `### Flow: Login
**Goal:** User authenticates to access their account.
**Preconditions:** User has an account.
**Steps:**
1. [Login Screen] — User enters email and password → System validates credentials
   - **Decision:** If credentials valid, go to step 2; otherwise show error
2. [Home] — System displays dashboard → User sees their content
**Success Outcome:** User reaches the dashboard within < 2s.
**Error Paths:**
- Invalid credentials → Step 1 shows inline error
- Network timeout → Retry with backoff
**Edge Cases:** First-time login on a new device.`;

        const flows = parseFlows(md);
        expect(flows).toHaveLength(1);
        const flow = flows[0];
        expect(flow.title).toBe('Login');
        expect(flow.category).toBe('Auth & Identity');
        expect(flow.goal).toMatch(/authenticates/);
        expect(flow.steps).toHaveLength(2);

        const step1 = flow.steps[0];
        expect(step1.title).toBe('Login Screen');
        expect(step1.userAction).toMatch(/enters email/);
        expect(step1.systemBehavior).toMatch(/validates credentials/);
        expect(step1.decisions).toHaveLength(1);
        expect(step1.decisions[0]).toMatch(/credentials valid/);

        expect(flow.errorPaths).toHaveLength(2);
    });

    it('links errors to steps by explicit `Step N` reference', () => {
        const md = `### Flow: Photo upload
**Steps:**
1. [Camera] — User takes a photo → System captures image
2. [Editor] — User crops → System saves
**Error Paths:**
- Camera blocked → Step 1 falls back to upload from gallery
- Save fails → Step 2 retries`;
        const flow = parseFlows(md)[0];
        expect(flow.errorPaths[0].linkedStepIndex).toBe(0);
        expect(flow.errorPaths[1].linkedStepIndex).toBe(1);
    });

    it('preserves rawText on every step so prose-only content is never dropped', () => {
        const md = `### Flow: Legacy
**Steps:**
1. The user does something vaguely described in prose.
2. Then another thing happens.`;
        const flow = parseFlows(md)[0];
        expect(flow.steps).toHaveLength(2);
        expect(flow.steps[0].rawText).toMatch(/vaguely described/);
        expect(flow.steps[1].rawText).toMatch(/another thing/);
    });

    it('extracts backticked tokens as API references', () => {
        const md = `### Flow: API call
**Steps:**
1. [Login] — User submits → System calls \`auth/login\` and \`users/me\``;
        const flow = parseFlows(md)[0];
        expect(flow.steps[0].apiRefs).toContain('auth/login');
        expect(flow.steps[0].apiRefs).toContain('users/me');
        expect(flow.inferredSystems).toEqual(expect.arrayContaining(['auth/login', 'users/me']));
    });

    it('categorizes by title keywords', () => {
        const onboarding = parseFlows('### Flow: Welcome onboarding\n**Steps:**\n1. Hi')[0];
        expect(onboarding.category).toBe('Onboarding');

        const sharing = parseFlows('### Flow: Invite teammate\n**Steps:**\n1. Hi')[0];
        expect(sharing.category).toBe('Sharing & Collaboration');

        const core = parseFlows('### Flow: Edit document\n**Steps:**\n1. Hi')[0];
        expect(core.category).toBe('Core Experience');
    });
});
