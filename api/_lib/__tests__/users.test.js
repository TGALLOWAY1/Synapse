import { describe, expect, it } from 'vitest';
import { sanitizeExternalUrl, sanitizeProviderString } from '../users.js';

describe('sanitizeExternalUrl', () => {
  it('accepts http/https URLs', () => {
    expect(sanitizeExternalUrl('https://example.com/foo')).toBe('https://example.com/foo');
    expect(sanitizeExternalUrl('http://example.com/')).toBe('http://example.com/');
  });

  it('rejects javascript: URLs', () => {
    expect(sanitizeExternalUrl('javascript:alert(1)')).toBeNull();
    expect(sanitizeExternalUrl('JAVASCRIPT:alert(1)')).toBeNull();
  });

  it('rejects data: URLs', () => {
    expect(sanitizeExternalUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('rejects other exotic protocols', () => {
    expect(sanitizeExternalUrl('ftp://example.com')).toBeNull();
    expect(sanitizeExternalUrl('file:///etc/passwd')).toBeNull();
    expect(sanitizeExternalUrl('vbscript:msgbox')).toBeNull();
  });

  it('rejects obviously malformed input', () => {
    expect(sanitizeExternalUrl('')).toBeNull();
    expect(sanitizeExternalUrl(null)).toBeNull();
    expect(sanitizeExternalUrl(undefined)).toBeNull();
    expect(sanitizeExternalUrl(12345)).toBeNull();
    expect(sanitizeExternalUrl('not-a-url')).toBeNull();
  });

  it('rejects overly long URLs', () => {
    const huge = `https://example.com/${'a'.repeat(5000)}`;
    expect(sanitizeExternalUrl(huge)).toBeNull();
  });
});

describe('sanitizeProviderString', () => {
  it('strips control characters', () => {
    const raw = 'Alex\u0000\u0001 Example';
    expect(sanitizeProviderString(raw)).toBe('Alex Example');
  });

  it('trims whitespace', () => {
    expect(sanitizeProviderString('  hello  ')).toBe('hello');
  });

  it('caps length at 512 chars', () => {
    const result = sanitizeProviderString('x'.repeat(2000));
    expect(result.length).toBe(512);
  });

  it('returns empty string for non-strings', () => {
    expect(sanitizeProviderString(null)).toBe('');
    expect(sanitizeProviderString(undefined)).toBe('');
    expect(sanitizeProviderString(42)).toBe('');
  });
});
