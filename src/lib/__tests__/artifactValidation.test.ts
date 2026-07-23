import { describe, it, expect } from 'vitest';
import { detectDegenerateContent, validateArtifactContent } from '../artifactValidation';
import { dataModelToMarkdown } from '../services/dataModelMarkdown';
import type { DataModelContent } from '../../types';

describe('detectDegenerateContent', () => {
    it('returns null for clean content', () => {
        const clean = `### Login Screen
| State | Trigger | Behavior |
|---|---|---|
| Idle | App start | Show login form. |
| Submitting | Submit click | Show spinner. Disable inputs. |
| Error | Bad creds | Show error toast. Re-enable inputs. |
`;
        expect(detectDegenerateContent(clean)).toBeNull();
    });

    it('flags a single mega-cell over the threshold', () => {
        const phrase = "Shows Connect Spotify button. Disables Save to Library. ";
        const cell = phrase.repeat(30); // ~1700 chars in one cell
        const md = `| State | User-visible |
|---|---|
| Idle | ${cell} |
`;
        expect(detectDegenerateContent(md)).toMatch(/unusually long/);
    });

    it('flags a cell whose sentences dedupe to ≤ half their original count', () => {
        const repeated = Array.from({ length: 6 }, () => 'Shows the connect button.').join(' ');
        const md = `| State | User-visible |
|---|---|
| Idle | ${repeated} Shows another sentence. Yet another. Shows the connect button. |
`;
        expect(detectDegenerateContent(md)).toMatch(/degenerate|repeating|repeats/i);
    });
});

describe('validateArtifactContent', () => {
    it('penalizes degenerate content via the new heuristic', () => {
        const phrase = 'Shows Connect Spotify. Disables Save to Library. ';
        const cell = phrase.repeat(30);
        const md = `# Doc

### Section
**Goal:** something

| Flow | Steps | Success | Error |
|---|---|---|---|
| A | ${cell} | done | none |
`;
        const result = validateArtifactContent('user_flows', md);
        expect(result.warnings.some(w => /repeating|degenerate|unusually long/.test(w))).toBe(true);
        expect(result.qualityScore).toBeLessThan(100);
    });

    it('does not flag "may lack detail" for a real data model emitted as tables + callouts', () => {
        // The data_model artifact carries its detail via GFM tables and `> [!…]`
        // callouts, never bullet lists. Compose the actual emitter so this stays
        // true against the exact markdown the generation path produces.
        const model: DataModelContent = {
            overview: {
                summary: 'The model stores habits and their completions locally.',
                dataFlow: 'User input creates Habit rows, logged as HabitCompletion.',
                productOutcome: 'Zero-latency habit logging offline.',
            },
            entities: [
                {
                    name: 'Habit',
                    description: 'A recurring routine logged with a single tap.',
                    userFacing: true,
                    mutability: 'mutable',
                    fields: [
                        { name: 'id', type: 'UUID', required: true, description: 'Primary key' },
                        { name: 'name', type: 'String', required: true, description: 'Display name' },
                    ],
                    relationships: [{ type: 'has_many', target: 'HabitCompletion' }],
                    indexes: ['idx_name on (name)'],
                    constraints: ['name must be non-empty'],
                },
                {
                    name: 'HabitCompletion',
                    description: 'A timestamped completion record.',
                    userFacing: true,
                    mutability: 'mostly_immutable',
                    fields: [{ name: 'id', type: 'UUID', required: true, description: 'Primary key' }],
                    relationships: [{ type: 'belongs_to', target: 'Habit' }],
                },
            ],
            apiEndpoints: [{ method: 'POST', path: '/api/v1/sync', description: 'Sync batch', entity: 'HabitCompletion' }],
        };
        const md = dataModelToMarkdown(model);
        // Sanity: the emitter really produces no bullet/numbered list line.
        expect(/^[-*]\s/m.test(md) || /^\d+\.\s/m.test(md)).toBe(false);
        const result = validateArtifactContent('data_model', md);
        expect(result.warnings.some(w => /may lack detail/.test(w))).toBe(false);
    });

    it('still flags "may lack detail" when a doc has neither list, table, nor callout', () => {
        const md = `# Notes

## Overview

Just a couple of prose paragraphs with a header and nothing structured.

More prose here that carries no bullets, tables, or callouts at all.
`;
        const result = validateArtifactContent('data_model', md);
        expect(result.warnings.some(w => /may lack detail/.test(w))).toBe(true);
    });
});
