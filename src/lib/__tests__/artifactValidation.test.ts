import { describe, it, expect } from 'vitest';
import { detectDegenerateContent, validateArtifactContent } from '../artifactValidation';

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
});
