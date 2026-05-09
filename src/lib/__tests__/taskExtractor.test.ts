import { describe, it, expect } from 'vitest';
import { parseImplementationPlan } from '../services/implementationPlanParser';
import { extractTasks, extractTasksFromMarkdown } from '../services/taskExtractor';
import type { StructuredImplementationPlan } from '../../types';

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

const STRUCTURED_PLAN: StructuredImplementationPlan = {
    overview: { summary: 'Build the API.' },
    milestones: [
        {
            id: 'm_setup',
            name: 'API Foundation',
            timeframe: 'Week 1-2',
            goal: 'Stand up the API layer.',
            tasks: [
                {
                    id: 'task_users_endpoint',
                    title: 'Build /users endpoint',
                    description: 'POST and GET on /users.',
                    status: 'todo',
                    dependencies: [],
                    linkedArtifacts: { prd: ['Auth'], dataModel: ['User'] },
                },
                {
                    id: 'task_sessions_endpoint',
                    title: 'Build /sessions endpoint',
                    status: 'todo',
                    dependencies: ['task_users_endpoint'],
                },
            ],
        },
    ],
    definitionOfDone: [
        'All endpoints return documented status codes',
        'Integration tests pass in CI',
    ],
};

describe('extractTasksFromMarkdown — structured plan path', () => {
    it('detects a synapse-plan JSON fence and extracts tasks from it', () => {
        const markdown = `### Milestone 1: Foo (Week 1-2)\n**Key Deliverables:**\n- [ ] X\n\n\`\`\`json synapse-plan\n${JSON.stringify(STRUCTURED_PLAN)}\n\`\`\``;
        const tasks = extractTasksFromMarkdown(markdown, { sourceArtifactId: 'art-1' });
        expect(tasks).toHaveLength(2);
        expect(tasks.map(t => t.id)).toEqual(['task_users_endpoint', 'task_sessions_endpoint']);
        expect(tasks[0].title).toBe('Build /users endpoint');
        // Plan-wide DoD propagates into criteria.
        expect(tasks[0].acceptanceCriteria.some(c => c.includes('documented status codes'))).toBe(true);
    });

    it('resolves task-id dependencies into human-readable titles', () => {
        const markdown = `\`\`\`json synapse-plan\n${JSON.stringify(STRUCTURED_PLAN)}\n\`\`\``;
        const tasks = extractTasksFromMarkdown(markdown, { sourceArtifactId: 'art-1' });
        const sessionsTask = tasks.find(t => t.id === 'task_sessions_endpoint');
        expect(sessionsTask?.dependencies).toEqual(['Build /users endpoint']);
    });

    it('falls back to the legacy markdown extractor when there is no fence', () => {
        const legacyMarkdown = `### Milestone 1: Auth (Week 1)\n**Key Deliverables:**\n- [ ] Build login form\n`;
        const tasks = extractTasksFromMarkdown(legacyMarkdown, { sourceArtifactId: 'art-7' });
        expect(tasks).toHaveLength(1);
        expect(tasks[0].title).toBe('Build login form');
    });
});
