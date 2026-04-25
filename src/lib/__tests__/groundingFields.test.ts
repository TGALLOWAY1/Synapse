import { describe, expect, it } from 'vitest';
import {
    parseActions,
    parseEntities,
    serializeActions,
    serializeEntities,
} from '../groundingFields';

describe('groundingFields', () => {
    describe('entities', () => {
        it('serialize + parse is a round-trip for full records', () => {
            const input = [
                { name: 'Patient case', description: 'Intake record', exampleValues: ['Alex Chen', 'Priya Patel'] },
                { name: 'Triage owner', description: 'Clinician responsible', exampleValues: ['Dr. Kim'] },
            ];
            const raw = serializeEntities(input);
            expect(parseEntities(raw)).toEqual(input);
        });

        it('handles name-only entities', () => {
            expect(parseEntities('Patient case')).toEqual([{ name: 'Patient case' }]);
            expect(serializeEntities([{ name: 'Patient case' }])).toBe('Patient case');
        });

        it('drops empty lines and lines without a name', () => {
            const raw = '\n\n | no name |\nReal entity\n  \n| nothing | here';
            expect(parseEntities(raw)).toEqual([{ name: 'Real entity' }]);
        });

        it('parses description without examples', () => {
            expect(parseEntities('Order | A customer order')).toEqual([
                { name: 'Order', description: 'A customer order' },
            ]);
        });

        it('parses examples without description', () => {
            expect(parseEntities('SKU |  | A-1, B-2, C-3')).toEqual([
                { name: 'SKU', exampleValues: ['A-1', 'B-2', 'C-3'] },
            ]);
        });
    });

    describe('primaryActions', () => {
        it('serialize + parse is a round-trip', () => {
            const input = [
                { verb: 'Assign', target: 'case owner' },
                { verb: 'Submit', target: 'triage recommendation' },
            ];
            expect(parseActions(serializeActions(input))).toEqual(input);
        });

        it('drops lines missing a verb or target', () => {
            const raw = 'Assign | case owner\nAlone\n| only target\nverb |';
            expect(parseActions(raw)).toEqual([{ verb: 'Assign', target: 'case owner' }]);
        });

        it('handles multi-word verbs and targets', () => {
            expect(parseActions('Bulk approve | pending orders')).toEqual([
                { verb: 'Bulk approve', target: 'pending orders' },
            ]);
        });

        it('produces empty string for empty input', () => {
            expect(serializeActions([])).toBe('');
            expect(serializeActions(undefined)).toBe('');
            expect(parseActions('')).toEqual([]);
        });
    });
});
