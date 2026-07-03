import { describe, it, expect, beforeEach } from 'vitest';
import {
  getUploadedImageKeys,
  markImagesUploaded,
  unmarkImagesUploaded,
} from '../imageUploadMarker';

beforeEach(() => {
  localStorage.clear();
});

describe('imageUploadMarker', () => {
  it('records uploaded image keys per user', () => {
    markImagesUploaded('user-a', ['k1', 'k2']);
    expect([...getUploadedImageKeys('user-a')].sort()).toEqual(['k1', 'k2']);
  });

  it('is namespaced per user', () => {
    markImagesUploaded('user-a', ['k1']);
    expect(getUploadedImageKeys('user-b').has('k1')).toBe(false);
  });

  it('does not duplicate keys on repeated marking', () => {
    markImagesUploaded('user-a', ['k1']);
    markImagesUploaded('user-a', ['k1', 'k1', 'k2']);
    expect(getUploadedImageKeys('user-a').size).toBe(2);
  });

  it('unmark forgets keys so a re-add re-uploads', () => {
    markImagesUploaded('user-a', ['k1', 'k2']);
    unmarkImagesUploaded('user-a', ['k1']);
    expect([...getUploadedImageKeys('user-a')]).toEqual(['k2']);
  });
});
