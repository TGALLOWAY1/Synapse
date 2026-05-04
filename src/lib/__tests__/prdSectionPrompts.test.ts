import { describe, it, expect } from 'vitest';
import { buildSectionPrompt, SECTION_TITLES } from '../prompts/prdSectionPrompts';
import { DEFAULT_PRD_SECTIONS } from '../services/progressivePrdGeneration';
import type { SectionId } from '../schemas/prdSchemas';

describe('buildSectionPrompt', () => {
    it('returns non-empty system and user strings for all 10 sections', () => {
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
});

describe('SECTION_TITLES', () => {
    it('has an entry for all 10 sections', () => {
        expect(Object.keys(SECTION_TITLES).length).toBe(DEFAULT_PRD_SECTIONS.length);
    });

    it('every DEFAULT_PRD_SECTIONS entry has a non-empty title', () => {
        for (const section of DEFAULT_PRD_SECTIONS) {
            const title = SECTION_TITLES[section.id as SectionId];
            expect(title).toBeTruthy();
        }
    });
});
