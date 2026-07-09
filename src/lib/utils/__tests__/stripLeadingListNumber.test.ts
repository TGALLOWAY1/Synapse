import { describe, it, expect } from 'vitest';
import { stripLeadingListNumber } from '../stripLeadingListNumber';

describe('stripLeadingListNumber', () => {
    it('strips a leading "N. " ordinal', () => {
        expect(stripLeadingListNumber('1. User completes the form.')).toBe('User completes the form.');
        expect(stripLeadingListNumber('12. Something else.')).toBe('Something else.');
    });

    it('strips a leading "N) " ordinal', () => {
        expect(stripLeadingListNumber('3) Do the thing.')).toBe('Do the thing.');
    });

    it('leaves text with no leading ordinal untouched', () => {
        expect(stripLeadingListNumber('User completes the form.')).toBe('User completes the form.');
    });

    it('does not strip a number that is not a leading ordinal', () => {
        expect(stripLeadingListNumber('Retry after 3. seconds pass.')).toBe('Retry after 3. seconds pass.');
    });
});
