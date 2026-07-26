import { describe, it, expect } from 'vitest';
import {
    coerceToBulletList,
    collapseRepeats,
    dedupeSentences,
    looksDegenerate,
} from '../textCleanup';

describe('dedupeSentences', () => {
    it('returns empty for empty input', () => {
        expect(dedupeSentences('')).toEqual([]);
        expect(dedupeSentences('   ')).toEqual([]);
    });

    it('splits on period+space and dedupes case-insensitively', () => {
        expect(dedupeSentences('Shows A. shows a. Shows B.')).toEqual(['Shows A', 'Shows B']);
    });

    it('respects max', () => {
        expect(dedupeSentences('A. B. C. D.', { max: 2 })).toEqual(['A', 'B']);
    });

    it('splits on newlines and bullet glyphs', () => {
        const out = dedupeSentences('• Save\n• Skip\n- Share');
        expect(out).toContain('Save');
        expect(out).toContain('Skip');
        expect(out).toContain('Share');
    });
});

describe('collapseRepeats', () => {
    it('passes short strings through', () => {
        expect(collapseRepeats('hello')).toBe('hello');
    });

    it('collapses runs of repeated substrings without sentence boundaries', () => {
        const chunk = 'XYZABCDEF12345QRSTUVWXYZ_ABCDEFG_XYZ_ABCD'; // > 30 chars
        const repeated = chunk.repeat(5);
        const out = collapseRepeats(repeated);
        expect(out.length).toBeLessThan(repeated.length);
        // After collapse, the chunk should still appear at least once.
        expect(out.includes(chunk)).toBe(true);
    });

    it('leaves a string with no long repeat untouched', () => {
        // Long enough to pass the 90-char floor, but no block of >= 30 chars
        // repeats three times back-to-back.
        const text = 'The quick brown fox jumps over the lazy dog while the cat naps '
            + 'quietly beside a warm radiator in the corner of the room.';
        expect(text.length).toBeGreaterThan(90);
        expect(collapseRepeats(text)).toBe(text);
    });

    // Performance regression guard. This ran as ~270 separate whole-string
    // regex passes and cost seconds on realistic degenerate input — and it is
    // called synchronously from the render path, so "slow" meant a frozen tab.
    // The character-scan form is ~100x faster; the generous bound below still
    // fails loudly if the quadratic-ish behavior ever comes back.
    it.each([12_000, 48_000])('stays fast on a %i-char degenerate string', (targetLen) => {
        const phrase = "Shows 'Connect to collaborate' CTA on share sheet. "
            + "Disables 'Save to Library' swipe right feature. "
            + 'Hides collaborative features. ';
        const repeats = Math.ceil(targetLen / phrase.length);
        const degenerate = phrase.repeat(repeats);
        expect(degenerate.length).toBeGreaterThanOrEqual(targetLen);

        const started = performance.now();
        const out = collapseRepeats(degenerate);
        const elapsedMs = performance.now() - started;

        expect(out.length).toBeLessThan(degenerate.length);
        expect(elapsedMs).toBeLessThan(1000);
    });

    // The worst case for the scan is input with NO repeat at all: every period
    // is checked across the whole string before giving up.
    it('stays fast on a long string with no repeats', () => {
        // Deterministic LCG filler — long period, so no 30+ char block repeats
        // three times back-to-back and every period is scanned before giving up.
        let seed = 1;
        const chars: string[] = [];
        for (let i = 0; i < 40_000; i += 1) {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            chars.push(String.fromCharCode(33 + (seed % 90)));
        }
        const text = chars.join('');

        const started = performance.now();
        const out = collapseRepeats(text);
        const elapsedMs = performance.now() - started;

        expect(out === text).toBe(true);
        expect(elapsedMs).toBeLessThan(1000);
    });
});

describe('coerceToBulletList', () => {
    it('returns empty for null/undefined', () => {
        expect(coerceToBulletList(undefined)).toEqual([]);
        expect(coerceToBulletList(null)).toEqual([]);
    });

    it('passes a clean array through with case-insensitive dedupe', () => {
        expect(coerceToBulletList(['Save track', 'Skip track', 'save track'])).toEqual([
            'Save track',
            'Skip track',
        ]);
    });

    it('splits a paragraph into bullets', () => {
        const out = coerceToBulletList(
            'Shows Connect Spotify button. Defaults to Preview Mode. Hides collaborative features.',
        );
        expect(out).toEqual([
            'Shows Connect Spotify button',
            'Defaults to Preview Mode',
            'Hides collaborative features',
        ]);
    });

    it('handles the legacy degenerate state-machine sample without exploding', () => {
        // Drawn directly from the QA screenshot — same handful of phrases
        // repeated dozens of times.
        const phrases = [
            "Shows 'Connect to collaborate' CTA on share sheet.",
            "Disables 'Save to Library' swipe right feature.",
            "Shows 'Preview' badge on album art.",
            'Disables WebGL audio frequency reactivity if CORS blocks HTML5 audio analysis.',
            'Shows clear value prop modal explaining why auth is needed (full tracks, saving, better recommendations).',
            'Allows user to dismiss modal and continue in Preview Mode.',
            'Hides collaborative features.',
        ];
        const degenerate = Array.from({ length: 30 }, () => phrases.join(' ')).join(' ');
        expect(degenerate.length).toBeGreaterThan(5000);
        const out = coerceToBulletList(degenerate, { max: 8 });
        expect(out.length).toBeLessThanOrEqual(8);
        // Every distinct phrase should be represented exactly once.
        for (const phrase of phrases) {
            const stripped = phrase.replace(/\.$/, '');
            expect(out).toContain(stripped);
        }
    });

    it('caps the output at max', () => {
        expect(coerceToBulletList('A. B. C. D. E.', { max: 3 })).toEqual(['A', 'B', 'C']);
    });

    it('flattens an array of paragraphs into a single bullet list', () => {
        const out = coerceToBulletList([
            'Save track. Skip track.',
            'Skip track. Share vibe.',
        ]);
        expect(out).toEqual(['Save track', 'Skip track', 'Share vibe']);
    });
});

describe('looksDegenerate', () => {
    it('returns false for short input', () => {
        expect(looksDegenerate('Save the track to library.')).toBe(false);
    });

    it('returns true for the QA-screenshot-style input', () => {
        const phrases = [
            "Shows 'Connect to collaborate' CTA on share sheet.",
            "Disables 'Save to Library' swipe right feature.",
        ];
        const degenerate = Array.from({ length: 30 }, () => phrases.join(' ')).join(' ');
        expect(looksDegenerate(degenerate)).toBe(true);
    });

    it('returns false for a clean array of distinct sentences', () => {
        expect(
            looksDegenerate([
                'Shows Connect Spotify button.',
                'Defaults to Preview Mode.',
                'Hides collaborative features.',
            ]),
        ).toBe(false);
    });
});
