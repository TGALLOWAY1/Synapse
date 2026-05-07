import { describe, expect, it } from 'vitest';
import { classifyIssue, extractFeatureRefs, parseFlows } from '../parseFlow';

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

        // Backwards-compat: errorPaths still populated.
        expect(flow.errorPaths).toHaveLength(2);
        // New: normalized issues are also populated.
        expect(flow.issues.length).toBeGreaterThanOrEqual(2);
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

describe('extractFeatureRefs', () => {
    it('finds bracketed feature references and normalizes the id', () => {
        const refs = extractFeatureRefs('See [f1] and [F-014] for details.');
        const ids = refs.map(r => r.id);
        expect(ids).toContain('f1');
        expect(ids).toContain('f014');
    });

    it('deduplicates repeated references', () => {
        const refs = extractFeatureRefs('[f1] and again [f1] and [F1]');
        expect(refs).toHaveLength(1);
        expect(refs[0].id).toBe('f1');
    });

    it('does not match bare tokens by default (avoids fps/f5key collisions)', () => {
        const refs = extractFeatureRefs('30fps target, f5key shortcut, f1 unbracketed');
        expect(refs).toHaveLength(0);
    });

    it('aggregates feature refs onto the parsed flow', () => {
        const md = `### Flow: Recipe ingestion
**Goal:** Import a recipe via [f1] NLP Recipe Importer.
**Steps:**
1. [Importer] — User pastes URL → System scrapes via [f9] microservice
2. [Macros] — System computes via [f3] Macro Calculator → User adjusts servings`;
        const flow = parseFlows(md)[0];
        const ids = flow.featureRefs.map(r => r.id);
        expect(ids).toEqual(expect.arrayContaining(['f1', 'f9', 'f3']));

        // Each step's featureRefs should also be populated.
        expect(flow.steps[0].featureRefs.map(r => r.id)).toContain('f9');
        expect(flow.steps[1].featureRefs.map(r => r.id)).toContain('f3');
    });

    it('does not turn a [f1]-style step prefix into the step title', () => {
        const md = `### Flow: Action-only step
**Steps:**
1. [f1] — User clicks the button → System fires the import job`;
        const flow = parseFlows(md)[0];
        const step = flow.steps[0];
        // The "[f1]" should be parsed as a feature ref, not the title.
        expect(step.title).not.toBe('f1');
        expect(step.featureRefs.map(r => r.id)).toContain('f1');
    });
});

describe('classifyIssue / normalized issues', () => {
    it('treats fallback / retry wording as alternate paths, not errors', () => {
        expect(classifyIssue('Camera blocked → falls back to upload from gallery')).toBe('alternate_path');
        expect(classifyIssue('Network timeout → retry with backoff')).toBe('alternate_path');
    });

    it('treats validation / required wording as validation_warning', () => {
        expect(classifyIssue('Email is required and must be a valid format')).toBe('validation_warning');
        expect(classifyIssue('Quantity out-of-range — min 1, max 99')).toBe('validation_warning');
    });

    it('treats crash / 500 wording as failure_mode', () => {
        expect(classifyIssue('Service returns 500 and cannot recover')).toBe('failure_mode');
    });

    it('treats unresolved / TBD wording as unresolved_reference', () => {
        expect(classifyIssue('TBD: hook this up to the canonical feature catalog')).toBe('unresolved_reference');
        expect(classifyIssue('Reference to flow X is unresolved')).toBe('unresolved_reference');
    });

    it('treats edge case / first-time wording as edge_case', () => {
        expect(classifyIssue('Edge case: user is offline on first launch')).toBe('edge_case');
        expect(classifyIssue('Rare: device clock is wildly skewed')).toBe('edge_case');
    });

    it('produces normalized issues on a parsed flow with kind labels', () => {
        const md = `### Flow: Mixed issues
**Steps:**
1. [Importer] — User submits → System validates
**Error Paths:**
- Network timeout → retry with backoff
- Email format invalid → show inline validation message
- Service returns 500 → cannot recover, surface error toast
- TBD: confirm canonical id once feature catalog ships`;
        const flow = parseFlows(md)[0];
        const kinds = flow.issues.map(i => i.kind);
        expect(kinds).toEqual(expect.arrayContaining([
            'alternate_path',
            'validation_warning',
            'failure_mode',
            'unresolved_reference',
        ]));
    });
});
