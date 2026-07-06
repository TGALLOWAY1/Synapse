// Prompt-surface snapshot net (audit R10-lite).
//
// Every major prompt surface is rendered against a small deterministic
// fixture and snapshotted, so ANY textual change to a prompt — intentional or
// accidental — shows up as a reviewed snapshot diff instead of drifting
// silently. When a prompt edit is deliberate, update the snapshot in the same
// change (`npx vitest run -u src/lib/__tests__/promptSurfaces.test.ts`) and
// let the diff document the edit.

import { describe, expect, it } from 'vitest';
import { SAFETY_OVERRIDE, PROMPT_CONTRACT, RUBRIC_DEFINITION } from '../prompts/prdPrompts';
import { buildSectionPrompt } from '../prompts/prdSectionPrompts';
import { buildQuestionSystemInstruction, SUMMARY_SYSTEM_INSTRUCTION } from '../prompts/preflightPrompts';
import { renderClassifierInstruction } from '../safety/safetyPolicy';
import { buildRestrictionDirective } from '../safety/safetyReviewArtifact';
import { CORE_ARTIFACT_PROMPTS } from '../services/coreArtifactService';
import { buildScreenImagePrompt } from '../services/mockupImageService';
import { buildExternalMockupPrompt } from '../services/screenInventoryImageService';
import { normalizeDesignTokens } from '../designTokens';
import { DEFAULT_PRD_SECTIONS, RETIRED_PRD_SECTIONS } from '../services/progressivePrdGeneration';
import type { MockupPayload, MockupScreen, MockupSettings, ScreenItem, StructuredPRD } from '../../types';

const FIXTURE_IDEA = 'A trip-planning app for weekend hikers that builds routes from difficulty and season.';

// A tiny upstream PRD slice so section prompts render their context blocks.
const FIXTURE_UPSTREAM: Partial<StructuredPRD> = {
    vision: 'Every weekend hiker gets a safe, season-appropriate route in under a minute.',
    coreProblem: 'Hikers stitch together blogs and maps; conditions data is stale.',
    targetUsers: ['Weekend hikers', 'Trail club organizers'],
    features: [
        {
            id: 'f1',
            name: 'Route Builder',
            description: 'Generates a route from difficulty, distance, and season.',
            userValue: 'A safe plan without research.',
            complexity: 'medium',
            priority: 'must',
            acceptanceCriteria: ['Route renders on the map', 'Difficulty matches the request'],
        },
    ],
};

describe('prompt surfaces — snapshot net', () => {
    it('shared PRD fragments', () => {
        expect(SAFETY_OVERRIDE).toMatchSnapshot('SAFETY_OVERRIDE');
        expect(PROMPT_CONTRACT).toMatchSnapshot('PROMPT_CONTRACT');
        expect(RUBRIC_DEFINITION).toMatchSnapshot('RUBRIC_DEFINITION');
    });

    it('safety classifier instruction', () => {
        expect(renderClassifierInstruction()).toMatchSnapshot();
    });

    it('restriction directive (with and without detected concerns)', () => {
        const base = {
            classification: 'allowed_with_restrictions' as const,
            confidence: 'high' as const,
            userFacingReason: 'Touches monitoring territory.',
            safeAlternatives: [],
        };
        expect(
            buildRestrictionDirective({ ...base, detectedConcerns: ['covert monitoring'] }),
        ).toMatchSnapshot('with concerns');
        expect(
            buildRestrictionDirective({ ...base, detectedConcerns: [] }),
        ).toMatchSnapshot('fallback concerns');
    });

    it('every live PRD section prompt', () => {
        for (const section of DEFAULT_PRD_SECTIONS) {
            const { system, user } = buildSectionPrompt(section.id, {
                idea: FIXTURE_IDEA,
                platform: 'web',
                upstream: FIXTURE_UPSTREAM,
                projectName: 'TrailPlan',
            });
            expect(system).toMatchSnapshot(`${section.id} system`);
            expect(user).toMatchSnapshot(`${section.id} user`);
        }
    });

    it('every retired PRD section prompt (legacy retry contract)', () => {
        for (const section of RETIRED_PRD_SECTIONS) {
            const { system, user } = buildSectionPrompt(section.id, {
                idea: FIXTURE_IDEA,
                platform: 'web',
                upstream: FIXTURE_UPSTREAM,
            });
            expect(system).toMatchSnapshot(`${section.id} system`);
            expect(user).toMatchSnapshot(`${section.id} user`);
        }
    });

    it('preflight prompts', () => {
        expect(buildQuestionSystemInstruction(5)).toMatchSnapshot('questions (quick)');
        expect(SUMMARY_SYSTEM_INSTRUCTION).toMatchSnapshot('summary');
    });

    it('every core artifact system prompt and user prefix', () => {
        for (const [subtype, config] of Object.entries(CORE_ARTIFACT_PROMPTS)) {
            expect(config.system).toMatchSnapshot(`${subtype} system`);
            expect(config.userPrefix).toMatchSnapshot(`${subtype} userPrefix`);
        }
    });

    it('screen image prompts (internal gpt-image-2 path)', () => {
        const payload = {
            title: 'TrailPlan',
            summary: 'Weekend hiking routes from difficulty and season.',
        } as MockupPayload;
        const screen = {
            id: 'scr-route-builder',
            name: 'Route Builder',
            purpose: 'Compose a route from difficulty, distance, and season.',
            userIntent: 'Get a safe route fast',
            coreUIElements: ['Difficulty selector', 'Season picker', 'Route map preview'],
            componentRefs: ['FilterBar', 'MapCanvas'],
            priority: 'P0',
        } as unknown as MockupScreen;
        const settings = { platform: 'mobile', fidelity: 'high', scope: 'all' } as unknown as MockupSettings;
        const tokens = normalizeDesignTokens({});

        expect(buildScreenImagePrompt(payload, screen, settings)).toMatchSnapshot('no design system');
        expect(buildScreenImagePrompt(payload, screen, settings, tokens)).toMatchSnapshot('with design system');
    });

    it('screen image prompts (external copy path)', () => {
        const screen = {
            id: 'scr-route-builder',
            name: 'Route Builder',
            purpose: 'Compose a route from difficulty, distance, and season.',
            userIntent: 'Get a safe route fast',
            coreUIElements: ['Difficulty selector', 'Season picker', 'Route map preview'],
        } as unknown as ScreenItem;
        const context = {
            productTitle: 'TrailPlan',
            productSummary: 'Weekend hiking routes from difficulty and season.',
            platformHint: 'mobile' as const,
        };
        const tokens = normalizeDesignTokens({});

        expect(buildExternalMockupPrompt(screen, context)).toMatchSnapshot('no design system');
        expect(
            buildExternalMockupPrompt(screen, { ...context, designTokens: tokens }),
        ).toMatchSnapshot('with design system');
    });
});
