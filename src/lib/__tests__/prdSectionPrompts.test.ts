import { describe, it, expect } from 'vitest';
import { buildSectionPrompt, SECTION_TITLES } from '../prompts/prdSectionPrompts';
import { DEFAULT_PRD_SECTIONS } from '../services/progressivePrdGeneration';
import type { SectionId } from '../schemas/prdSchemas';

describe('buildSectionPrompt', () => {
    it('returns non-empty system and user strings for all pipeline sections', () => {
        for (const section of DEFAULT_PRD_SECTIONS) {
            const { system, user } = buildSectionPrompt(section.id as SectionId, {
                idea: 'A task management app for remote teams',
                upstream: {},
            });
            expect(system.length).toBeGreaterThan(20);
            expect(user.length).toBeGreaterThan(10);
        }
    });

    it('includes upstream vision data in the product_thesis user prompt', () => {
        const { user } = buildSectionPrompt('product_thesis', {
            idea: 'Test app',
            upstream: { vision: 'Unique test vision string', coreProblem: 'X', targetUsers: ['Dev'] },
        });
        expect(user).toContain('Unique test vision string');
    });

    it('uses the unavailable sentinel in the product_thesis prompt when upstream is empty', () => {
        const { user } = buildSectionPrompt('product_thesis', {
            idea: 'Test app',
            upstream: {},
        });
        expect(user).toContain('unavailable');
    });

    it('includes the product idea in every section prompt', () => {
        const idea = 'Unique idea string 12345xyz';
        for (const section of DEFAULT_PRD_SECTIONS) {
            const { user } = buildSectionPrompt(section.id as SectionId, { idea, upstream: {} });
            expect(user).toContain(idea);
        }
    });

    it('includes platform note when platform is provided', () => {
        const { system } = buildSectionPrompt('product_basics', {
            idea: 'App idea',
            platform: 'app',
            upstream: {},
        });
        expect(system.toLowerCase()).toContain('mobile');
    });

    it('forces the user-chosen project name as the productName in product_basics', () => {
        const { user } = buildSectionPrompt('product_basics', {
            idea: 'A budgeting app',
            projectName: 'PennyWise',
            upstream: {},
        });
        expect(user).toContain('PennyWise');
        expect(user.toLowerCase()).toContain('authoritative');
    });

    it('ignores a generic placeholder project name', () => {
        const { user } = buildSectionPrompt('product_basics', {
            idea: 'A budgeting app',
            projectName: 'Untitled Project',
            upstream: {},
        });
        expect(user).not.toContain('Untitled Project');
        expect(user.toLowerCase()).not.toContain('authoritative');
    });

    it('does not reference a project name when none is provided', () => {
        const { user } = buildSectionPrompt('product_basics', {
            idea: 'A budgeting app',
            upstream: {},
        });
        expect(user.toLowerCase()).not.toContain('authoritative');
    });
});

describe('lean decision-level prompts (detail deferred to artifacts)', () => {
    it('ux_loops asks for a lean screen list, not per-screen UI specs', () => {
        const { user } = buildSectionPrompt('ux_loops', { idea: 'Test app', upstream: {} });
        expect(user).toContain('key content');
        expect(user).not.toContain('emptyState');
        expect(user).not.toContain('loadingState');
        expect(user).not.toContain('errorState');
        expect(user).not.toContain('interactions (array)');
    });

    it('architecture grounds on domainEntities instead of the retired richDataModel', () => {
        const { user } = buildSectionPrompt('architecture', {
            idea: 'Test app',
            upstream: { domainEntities: [{ name: 'UniqueEntity99', description: 'x' }] },
        });
        expect(user).toContain('UniqueEntity99');
        expect(user).not.toContain('richDataModel');
    });

    it('features omits UI-acceptance and analytics-event asks', () => {
        const { user } = buildSectionPrompt('features', { idea: 'Test app', upstream: {} });
        expect(user).not.toContain('uiAcceptanceCriteria');
        expect(user).not.toContain('analyticsEvents');
        expect(user).toContain('failureModes');
    });

    it('metrics_scope asks for decision-level metrics without instrumentation fields', () => {
        const { user } = buildSectionPrompt('metrics_scope', { idea: 'Test app', upstream: {} });
        expect(user).toContain('{ name, target? }');
        expect(user).not.toContain('instrumentation?');
    });

    it('metrics_scope requires scope entries to reference features by id + exact name', () => {
        // Free-form scope strings that name no feature never resolve to an id
        // (resolveScopeFeature) and silently vanish from downstream assets,
        // which generate from prd.features only — the prompt must forbid them.
        const { user } = buildSectionPrompt('metrics_scope', { idea: 'Test app', upstream: {} });
        expect(user).toContain('MUST begin with the id and exact name of a feature from the Features list');
        expect(user).toContain('"f1: Feature Name — brief scope note"');
        expect(user).toContain('Do NOT introduce capabilities that are not in the Features list');
    });

    it('active sections keep the lean rubric', () => {
        const { system } = buildSectionPrompt('ux_loops', { idea: 'Test app', upstream: {} });
        expect(system).toContain('QUALITY BAR');
    });
});

describe('SECTION_TITLES', () => {
    it('covers every active section id', () => {
        for (const section of DEFAULT_PRD_SECTIONS) {
            const title = SECTION_TITLES[section.id as SectionId];
            expect(title).toBeTruthy();
        }
    });
});
