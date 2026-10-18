import { describe, expect, it } from 'vitest';
import { routingFromKey } from '../imageRefKey.js';

describe('routingFromKey', () => {
  it('parses an OpenAI mockup key (versionId:screenId:quality)', () => {
    expect(routingFromKey('v1:s1:low')).toEqual({ versionId: 'v1', screenId: 's1', quality: 'low' });
  });

  it('drops the trailing provider segment of a Nano Banana key', () => {
    expect(routingFromKey('v1:s1:high:gemini')).toEqual({ versionId: 'v1', screenId: 's1', quality: 'high' });
  });

  it('keeps colons inside a namespaced version id', () => {
    expect(routingFromKey('demo:v1:s1:low')).toEqual({ versionId: 'demo:v1', screenId: 's1', quality: 'low' });
    expect(routingFromKey('demo:v1:s1:low:gemini')).toEqual({ versionId: 'demo:v1', screenId: 's1', quality: 'low' });
  });

  it('returns no routing for a key that is too short', () => {
    expect(routingFromKey('v1:s1')).toEqual({});
    expect(routingFromKey('s1:gemini')).toEqual({});
  });
});
