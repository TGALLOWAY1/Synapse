import { describe, it, expect } from 'vitest';
import {
    effectiveImageVersionId,
    inheritedImageMetadata,
    remapInheritedImageMetadata,
} from '../artifactImageVersion';

const version = (id: string, metadata: Record<string, unknown> = {}) => ({ id, metadata });

describe('effectiveImageVersionId', () => {
    it('falls back to the version own id when nothing was inherited', () => {
        expect(effectiveImageVersionId(version('v1'))).toBe('v1');
    });

    it('resolves to the inherited owner when the version is a clone', () => {
        expect(effectiveImageVersionId(version('v2', { imageSourceVersionId: 'v1' }))).toBe('v1');
    });

    it('ignores an empty or non-string pointer rather than producing a bad key', () => {
        expect(effectiveImageVersionId(version('v2', { imageSourceVersionId: '' }))).toBe('v2');
        expect(effectiveImageVersionId(version('v2', { imageSourceVersionId: 42 }))).toBe('v2');
    });
});

describe('inheritedImageMetadata', () => {
    it('points a clone at a plain source version', () => {
        expect(inheritedImageMetadata(version('v1'))).toEqual({ imageSourceVersionId: 'v1' });
    });

    it('collapses the chain so a clone of a clone stays one hop from the owner', () => {
        const clone = version('v2', { imageSourceVersionId: 'v1' });
        expect(inheritedImageMetadata(clone)).toEqual({ imageSourceVersionId: 'v1' });
    });
});

describe('remapInheritedImageMetadata', () => {
    it('rewrites the pointer through an id remap', () => {
        const next = remapInheritedImageMetadata(
            { imageSourceVersionId: 'v1', other: 1 },
            (id) => (id === 'v1' ? 'demo:v1' : undefined),
        );
        expect(next).toEqual({ imageSourceVersionId: 'demo:v1', other: 1 });
    });

    it('drops an unmappable pointer instead of leaving it dangling', () => {
        const next = remapInheritedImageMetadata({ imageSourceVersionId: 'gone' }, () => undefined);
        expect(next).toEqual({});
    });

    it('leaves metadata without a pointer untouched', () => {
        const metadata = { other: 1 };
        expect(remapInheritedImageMetadata(metadata, () => 'x')).toBe(metadata);
    });
});
