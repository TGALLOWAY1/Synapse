import { describe, it, expect } from 'vitest';
import { parseImplementationPlan } from '../services/implementationPlanParser';
import { extractTasks } from '../services/taskExtractor';

const PLAN_WITH_DOD = `### Milestone 1: API Foundation (Week 1-2)
**Goal:** Stand up the API layer.
**Key Deliverables:**
- [ ] Build /users endpoint
- [ ] Build /sessions endpoint
**Technical Approach:** REST + Express.
**Dependencies:** None.
**Definition of Done:**
- Endpoints return 200 for happy paths
- Endpoints return 4xx with documented error codes

### Milestone 2: Frontend Login Form
**Goal:** Allow users to sign in.
**Key Deliverables:**
- [ ] Render login modal in React
**Dependencies:** Milestone 1, Auth service.
`;

const PLAN_WITHOUT_DOD = `### Milestone 1: Documentation
**Goal:** Write the docs.
**Key Deliverables:**
- [ ] Add quickstart README
`;

describe('extractTasks', () => {
    it('produces one task per deliverable across all milestones', () => {
        const plan = parseImplementationPlan(PLAN_WITH_DOD);
        const tasks = extractTasks(plan, { sourceArtifactId: 'art-1' });
        expect(tasks).toHaveLength(3);
        expect(tasks.map(t => t.title)).toEqual([
            'Build /users endpoint',
            'Build /sessions endpoint',
            'Render login modal in React',
        ]);
    });

    it('pulls acceptance criteria from the milestone Definition of Done when present', () => {
        const plan = parseImplementationPlan(PLAN_WITH_DOD);
        const tasks = extractTasks(plan, { sourceArtifactId: 'art-1' });
        const usersTask = tasks[0];
        expect(usersTask.acceptanceCriteria.length).toBeGreaterThanOrEqual(2);
        // Definition-of-done lines must be reflected verbatim.
        expect(usersTask.acceptanceCriteria.some(c => c.includes('return 200'))).toBe(true);
        expect(usersTask.acceptanceCriteria.some(c => c.includes('4xx'))).toBe(true);
    });

    it('falls back to title-derived criteria when no Definition of Done exists', () => {
        const plan = parseImplementationPlan(PLAN_WITHOUT_DOD);
        const tasks = extractTasks(plan, { sourceArtifactId: 'art-7' });
        expect(tasks).toHaveLength(1);
        const t = tasks[0];
        expect(t.acceptanceCriteria.length).toBeGreaterThanOrEqual(2);
        // None of the criteria should be vague placeholders.
        expect(t.acceptanceCriteria.some(c => /works correctly/i.test(c))).toBe(false);
    });

    it('infers task type from keywords in the deliverable + milestone context', () => {
        const plan = parseImplementationPlan(PLAN_WITH_DOD);
        const tasks = extractTasks(plan, { sourceArtifactId: 'art-1' });
        const apiTask = tasks.find(t => t.title.includes('/users'));
        const uiTask = tasks.find(t => t.title.includes('login modal'));
        expect(apiTask?.taskType).toBe('backend');
        expect(uiTask?.taskType).toBe('frontend');
    });

    it('parses dependencies into a list', () => {
        const plan = parseImplementationPlan(PLAN_WITH_DOD);
        const tasks = extractTasks(plan, { sourceArtifactId: 'art-1' });
        const uiTask = tasks.find(t => t.title.includes('login modal'));
        expect(uiTask?.dependencies).toEqual(expect.arrayContaining(['M1', 'Auth service.']));
    });

    it('includes source section ids and suggested labels', () => {
        const plan = parseImplementationPlan(PLAN_WITH_DOD);
        const tasks = extractTasks(plan, { sourceArtifactId: 'art-1' });
        expect(tasks[0].sourceSectionId).toBe('milestone-1');
        expect(tasks[0].suggestedLabels).toEqual(expect.arrayContaining(['milestone-1', 'synapse']));
    });

    it('returns an empty array for plans with no milestones', () => {
        const plan = parseImplementationPlan('# A plan with no milestone headings.');
        expect(extractTasks(plan, { sourceArtifactId: 'art-x' })).toEqual([]);
    });
});
