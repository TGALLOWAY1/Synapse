import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  getLocalCredential,
  setLocalCredential,
  removeLocalCredential,
  clearLocalCredentialsForActiveUser,
  GEMINI_API_KEY,
  OPENAI_API_KEY,
} from '../localCredentials';
import { setActiveProjectUser } from '../../store/userScope';

const nsKey = (base: string, userId: string) => `${base}::u:${userId}`;

describe('localCredentials', () => {
  beforeEach(() => {
    localStorage.clear();
    setActiveProjectUser(null);
  });

  afterEach(() => {
    setActiveProjectUser(null);
  });

  it('namespaces writes per active user and isolates accounts', () => {
    setActiveProjectUser('userA');
    setLocalCredential(GEMINI_API_KEY, 'key-A');

    // Stored under the namespaced key, not the bare global key.
    expect(localStorage.getItem(nsKey(GEMINI_API_KEY, 'userA'))).toBe('key-A');
    expect(localStorage.getItem(GEMINI_API_KEY)).toBeNull();

    // A different account cannot read it.
    setActiveProjectUser('userB');
    expect(getLocalCredential(GEMINI_API_KEY)).toBeNull();
    setLocalCredential(GEMINI_API_KEY, 'key-B');

    setActiveProjectUser('userA');
    expect(getLocalCredential(GEMINI_API_KEY)).toBe('key-A');
    setActiveProjectUser('userB');
    expect(getLocalCredential(GEMINI_API_KEY)).toBe('key-B');
  });

  it('migrates a legacy global key into the active user and removes the global', () => {
    // Pre-existing un-namespaced key from before namespacing existed.
    localStorage.setItem(GEMINI_API_KEY, 'legacy-key');

    setActiveProjectUser('userA');
    // First read migrates it.
    expect(getLocalCredential(GEMINI_API_KEY)).toBe('legacy-key');
    expect(localStorage.getItem(nsKey(GEMINI_API_KEY, 'userA'))).toBe('legacy-key');
    // Shared global copy is gone, so another account can't read it.
    expect(localStorage.getItem(GEMINI_API_KEY)).toBeNull();
    setActiveProjectUser('userB');
    expect(getLocalCredential(GEMINI_API_KEY)).toBeNull();
  });

  it('clears the active user keys (and sweeps legacy globals) on logout', () => {
    setActiveProjectUser('userA');
    setLocalCredential(GEMINI_API_KEY, 'key-A');
    setLocalCredential(OPENAI_API_KEY, 'openai-A');
    localStorage.setItem(GEMINI_API_KEY, 'stale-global'); // simulate a stale global

    clearLocalCredentialsForActiveUser();

    expect(getLocalCredential(GEMINI_API_KEY)).toBeNull();
    expect(getLocalCredential(OPENAI_API_KEY)).toBeNull();
    expect(localStorage.getItem(GEMINI_API_KEY)).toBeNull();
  });

  it('falls back to the bare key when signed out', () => {
    removeLocalCredential(GEMINI_API_KEY); // no-op
    setLocalCredential(GEMINI_API_KEY, 'anon-key');
    expect(localStorage.getItem(GEMINI_API_KEY)).toBe('anon-key');
    expect(getLocalCredential(GEMINI_API_KEY)).toBe('anon-key');
  });
});
