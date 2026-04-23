// Minimal HTML-entity escape for slot-text rendered inside templates. Model
// output is trusted to be text, not markup — any angle brackets or ampersands
// are treated as data.
const ENTITIES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};

export const esc = (value: string): string =>
    String(value ?? '').replace(/[&<>"']/g, ch => ENTITIES[ch] ?? ch);
