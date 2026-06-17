import { describe, it, expect, beforeEach } from 'vitest';
import {
  namespaceFor,
  resolveProjectStorageName,
  setActiveProjectUser,
  getActiveProjectUser,
  adoptLegacyProjectsForUser,
} from '../userScope';

const BASE = 'synapse-projects-storage';
const CLAIM = 'synapse-projects-legacy-claimed-by';

describe('userScope', () => {
  beforeEach(() => {
    localStorage.clear();
    setActiveProjectUser(null);
  });

  it('resolves the legacy key for anonymous and a per-user key when set', () => {
    expect(resolveProjectStorageName()).toBe(BASE);
    expect(namespaceFor('abc')).toBe(`${BASE}::u:abc`);

    setActiveProjectUser('abc');
    expect(getActiveProjectUser()).toBe('abc');
    expect(resolveProjectStorageName()).toBe(`${BASE}::u:abc`);
  });

  it('isolates two users into separate namespaces', () => {
    expect(namespaceFor('userA')).not.toBe(namespaceFor('userB'));
  });

  it('adopts pre-existing anonymous projects into the first account, non-destructively', () => {
    localStorage.setItem(BASE, '{"state":{"projects":{"p1":{}}}}');

    const adopted = adoptLegacyProjectsForUser('userA');
    expect(adopted).toBe(true);
    // Copied into the user's namespace...
    expect(localStorage.getItem(namespaceFor('userA'))).toContain('p1');
    // ...and the original legacy data is left untouched.
    expect(localStorage.getItem(BASE)).toContain('p1');
    expect(localStorage.getItem(CLAIM)).toBe('userA');
  });

  it('does not let a second account inherit already-claimed legacy projects', () => {
    localStorage.setItem(BASE, '{"state":{"projects":{"p1":{}}}}');
    adoptLegacyProjectsForUser('userA');

    const adoptedByB = adoptLegacyProjectsForUser('userB');
    expect(adoptedByB).toBe(false);
    expect(localStorage.getItem(namespaceFor('userB'))).toBeNull();
  });

  it('never overwrites an account that already has its own projects', () => {
    localStorage.setItem(BASE, '{"state":{"projects":{"legacy":{}}}}');
    localStorage.setItem(namespaceFor('userA'), '{"state":{"projects":{"mine":{}}}}');

    const adopted = adoptLegacyProjectsForUser('userA');
    expect(adopted).toBe(false);
    expect(localStorage.getItem(namespaceFor('userA'))).toContain('mine');
    expect(localStorage.getItem(namespaceFor('userA'))).not.toContain('legacy');
  });
});
