// Some legacy generations embedded a step's own ordinal ("1. Do the thing")
// even though callers render steps into an already-numbered list, producing
// visible double numbering ("1.  1. Do the thing"). Strip it defensively at
// render time so both new and legacy PRDs display a single number.
export function stripLeadingListNumber(text: string): string {
    return text.replace(/^\s*\d+[.)]\s+/, '');
}
