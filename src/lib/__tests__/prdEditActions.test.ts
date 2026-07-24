import { describe, expect, it } from 'vitest';
import {
    PRD_EDIT_ACTIONS,
    getPrdEditAction,
    getActionFromIntent,
    intentPrefixFor,
} from '../prdEditActions';

describe('PRD edit-action registry', () => {
    it('exposes the expected actions in order with distinct system prompts', () => {
        expect(PRD_EDIT_ACTIONS.map(a => a.id)).toEqual([
            'clarify', 'expand', 'specify', 'alternative', 'replace', 'critique',
        ]);
        const prompts = new Set(PRD_EDIT_ACTIONS.map(a => a.systemPrompt));
        expect(prompts.size).toBe(PRD_EDIT_ACTIONS.length);
    });

    it('resolves actions by id', () => {
        expect(getPrdEditAction('critique')?.label).toBe('Critique');
        expect(getPrdEditAction('specify')?.mode).toBe('draft');
        expect(getPrdEditAction('clarify')?.mode).toBe('chat');
    });

    it('derives the action from an intent prefix, case-insensitively', () => {
        expect(getActionFromIntent('Clarify: who is this for')?.id).toBe('clarify');
        expect(getActionFromIntent('specify: acceptance criteria')?.id).toBe('specify');
        // A bare follow-up reply with no prefix resolves to nothing.
        expect(getActionFromIntent('what about offline?')).toBeUndefined();
        expect(getActionFromIntent('')).toBeUndefined();
    });

    it('builds the intent prefix a chip prefills', () => {
        expect(intentPrefixFor(PRD_EDIT_ACTIONS[0])).toBe('Clarify: ');
    });
});
