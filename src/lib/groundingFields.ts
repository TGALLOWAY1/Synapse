import type { DomainEntity, PrimaryAction } from '../types';

// Edit-format helpers for the Phase B grounding fields in StructuredPRDView.
// Users edit one entity / action per line and these helpers parse back into
// typed records. Kept in /lib so the UI module stays components-only (React
// Fast Refresh requires pure-component exports from .tsx files).
//
// Entities format:  `Name | description | example1, example2`  (only Name required)
// Actions format:   `verb | target`                            (both required)

export const serializeEntities = (entities?: DomainEntity[]): string =>
    (entities ?? [])
        .map(e => {
            const parts: string[] = [e.name];
            if (e.description) parts.push(e.description);
            if (e.exampleValues && e.exampleValues.length > 0) parts.push(e.exampleValues.join(', '));
            return parts.join(' | ');
        })
        .join('\n');

export const parseEntities = (raw: string): DomainEntity[] =>
    raw
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const parts = line.split('|').map(s => s.trim());
            const entity: DomainEntity = { name: parts[0] };
            if (parts[1]) entity.description = parts[1];
            if (parts[2]) {
                const values = parts[2].split(',').map(v => v.trim()).filter(Boolean);
                if (values.length > 0) entity.exampleValues = values;
            }
            return entity;
        })
        .filter(e => e.name.length > 0);

export const serializeActions = (actions?: PrimaryAction[]): string =>
    (actions ?? []).map(a => `${a.verb} | ${a.target}`).join('\n');

export const parseActions = (raw: string): PrimaryAction[] =>
    raw
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => {
            const parts = line.split('|').map(s => s.trim());
            if (parts.length < 2 || !parts[0] || !parts[1]) return null;
            return { verb: parts[0], target: parts[1] };
        })
        .filter((a): a is PrimaryAction => a !== null);
