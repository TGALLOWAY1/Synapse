import { Fragment, type ReactNode } from 'react';
import type { Feature } from '../../../types';
import { FeatureReferenceChip } from './FeatureReferenceChip';
import { inlineMd } from './markdown';
import type { FeatureRef } from './types';

interface Options {
    /** Map of normalized feature id (e.g. "f1") to PRD `Feature`. Optional. */
    featuresById?: Map<string, Feature>;
    onSelectFeature: (refToken: FeatureRef) => void;
    /** Render the feature name next to the chip when known. Defaults true. */
    showFeatureName?: boolean;
}

const FEATURE_BRACKET_RE = /\[([fF]-?\d+)\]/g;

function normalizeId(token: string): string {
    return token.toLowerCase().replace(/-/g, '');
}

/**
 * Render markdown text with `[f1]` tokens substituted by interactive
 * feature chips. We split the string up front so chips render as React
 * components, and feed the prose segments through the existing
 * `inlineMd` helper so backticks / bold / italic still work.
 *
 * NOTE: bare `f1` tokens are intentionally left alone — too easy to
 * over-match `f5key`, `fps`, and similar identifiers. Authors should use
 * the bracket form.
 */
export function inlineWithFeatures(text: string, opts: Options): ReactNode {
    if (!text) return null;
    const segments: ReactNode[] = [];
    let cursor = 0;
    let m: RegExpExecArray | null;
    FEATURE_BRACKET_RE.lastIndex = 0;
    let key = 0;
    while ((m = FEATURE_BRACKET_RE.exec(text)) !== null) {
        if (m.index > cursor) {
            const prose = text.slice(cursor, m.index);
            segments.push(<Fragment key={`p-${key++}`}>{inlineMd(prose)}</Fragment>);
        }
        const id = normalizeId(m[1]);
        const feature = opts.featuresById?.get(id);
        const showName = opts.showFeatureName ?? true;
        segments.push(
            <FeatureReferenceChip
                key={`f-${key++}-${id}`}
                refToken={{ id, raw: m[0] }}
                feature={feature}
                onSelect={opts.onSelectFeature}
                showName={showName}
            />
        );
        cursor = m.index + m[0].length;
        // Generated text usually writes the feature name right after its token
        // ("[f1] Image Ingestion"). The chip already renders the name, so
        // swallow the duplicate from the prose — otherwise every feature
        // appears twice.
        if (showName && feature?.name) {
            const rest = text.slice(cursor);
            const ws = rest.match(/^\s*/)?.[0].length ?? 0;
            if (rest.slice(ws).toLowerCase().startsWith(feature.name.toLowerCase())) {
                cursor += ws + feature.name.length;
            }
        }
    }
    if (cursor < text.length) {
        const tail = text.slice(cursor);
        segments.push(<Fragment key={`p-${key++}`}>{inlineMd(tail)}</Fragment>);
    }
    if (segments.length === 0) return inlineMd(text);
    return <>{segments}</>;
}
