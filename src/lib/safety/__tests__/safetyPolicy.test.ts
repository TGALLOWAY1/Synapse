import { describe, expect, it } from 'vitest';
import {
    DISALLOWED_CAPABILITIES,
    renderClassifierInstruction,
    renderDisallowedCapabilities,
    renderInPromptSafetyOverride,
} from '../safetyPolicy';
import { SAFETY_OVERRIDE } from '../../prompts/prdPrompts';

describe('safetyPolicy — single source of policy text', () => {
    it('renders every capability term into the classifier instruction', () => {
        const instruction = renderClassifierInstruction();
        for (const capability of DISALLOWED_CAPABILITIES) {
            expect(instruction).toContain(capability);
        }
    });

    it('renders every capability term into the in-prompt safety override', () => {
        const override = renderInPromptSafetyOverride();
        for (const capability of DISALLOWED_CAPABILITIES) {
            expect(override).toContain(capability);
        }
    });

    it('keeps the classifier and the override on the SAME capability list', () => {
        // The historical drift: "anti-detection" and "covert/silent monitoring"
        // existed only in the classifier's copy. Both surfaces now embed the
        // identical rendered list.
        const list = renderDisallowedCapabilities();
        expect(renderClassifierInstruction()).toContain(list);
        expect(renderInPromptSafetyOverride()).toContain(list);
    });

    it('exposes the rendered override as the SAFETY_OVERRIDE prompt fragment', () => {
        expect(SAFETY_OVERRIDE).toBe(renderInPromptSafetyOverride());
        expect(SAFETY_OVERRIDE.startsWith('## Safety Override')).toBe(true);
    });

    it('keeps the override defense-in-depth invariants', () => {
        expect(SAFETY_OVERRIDE).toContain('Do NOT fill template sections with refusal text');
        expect(SAFETY_OVERRIDE).toContain(
            'never Disallowed on subject matter alone',
        );
    });
});
