import { describe, it, expect } from 'vitest';
import {
    parseImplementationPlan,
    parseMilestoneBody,
    findSection,
} from '../services/implementationPlanParser';

const SAMPLE_PLAN = `Some preamble paragraph that introduces the plan.

### Milestone 1: Foundation Setup (Week 1-2)
**Goal:** Stand up the core infrastructure.
**Key Deliverables:**
- [ ] Provision the database
- [ ] Wire CI/CD pipeline
**Technical Approach:** Terraform + GitHub Actions.
**Dependencies:** None.
**Risks:** Cloud account quota exhaustion.
**Definition of Done:**
- Migrations run cleanly in CI
- Staging deploy succeeds end-to-end

### Milestone 2: Auth Service
**Goal:** Allow users to sign in.
**Key Deliverables:**
- [ ] Build login UI
- [x] Provision identity provider
**Technical Approach:** OAuth 2.0 with PKCE.
**Dependencies:** Milestone 1, Identity provider account.

---

## Critical Path Summary
M1 -> M2.

## Team Size Recommendation
2 engineers.
`;

describe('parseImplementationPlan', () => {
    it('parses preamble, all milestones, and the appendix', () => {
        const plan = parseImplementationPlan(SAMPLE_PLAN);
        expect(plan.preamble).toContain('Some preamble paragraph');
        expect(plan.milestones).toHaveLength(2);
        expect(plan.appendix).toContain('Critical Path Summary');
        expect(plan.appendix).toContain('Team Size Recommendation');
    });

    it('extracts the timeframe from a parenthesized suffix', () => {
        const plan = parseImplementationPlan(SAMPLE_PLAN);
        expect(plan.milestones[0]).toMatchObject({
            id: 1,
            title: 'Foundation Setup',
            timeframe: 'Week 1-2',
        });
    });

    it('leaves timeframe undefined when the heading omits parens', () => {
        const plan = parseImplementationPlan(SAMPLE_PLAN);
        expect(plan.milestones[1]).toMatchObject({
            id: 2,
            title: 'Auth Service',
            timeframe: undefined,
        });
    });

    it('returns empty milestones array for free-form markdown', () => {
        const plan = parseImplementationPlan('# Just a heading\n\nNo milestones here.');
        expect(plan.milestones).toEqual([]);
        expect(plan.preamble).toContain('Just a heading');
    });
});

describe('parseMilestoneBody', () => {
    it('splits a milestone body into labeled sections and deliverables', () => {
        const plan = parseImplementationPlan(SAMPLE_PLAN);
        const m1 = parseMilestoneBody(plan.milestones[0].body);
        expect(m1.deliverables).toEqual([
            { text: 'Provision the database', checked: false },
            { text: 'Wire CI/CD pipeline', checked: false },
        ]);
        const labels = m1.sections.map(s => s.label);
        expect(labels).toEqual(expect.arrayContaining([
            'Goal', 'Technical Approach', 'Dependencies', 'Risks', 'Definition of Done',
        ]));
    });

    it('preserves the checked state on deliverables', () => {
        const plan = parseImplementationPlan(SAMPLE_PLAN);
        const m2 = parseMilestoneBody(plan.milestones[1].body);
        expect(m2.deliverables.find(d => d.text === 'Provision identity provider')?.checked).toBe(true);
    });

    it('findSection performs case-insensitive lookup', () => {
        const plan = parseImplementationPlan(SAMPLE_PLAN);
        const m1 = parseMilestoneBody(plan.milestones[0].body);
        expect(findSection(m1, 'definition of done')).toContain('Migrations run cleanly');
        expect(findSection(m1, 'Goal')).toContain('Stand up the core infrastructure');
        expect(findSection(m1, 'nonexistent')).toBeUndefined();
    });
});
