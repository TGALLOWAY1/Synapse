import { describe, it, expect, beforeEach } from 'vitest';
import {
  namespaceFor,
  resolveProjectStorageName,
  setActiveProjectUser,
  getActiveProjectUser,
  countLegacyProjects,
  getLegacyImportOffer,
  importLegacyProjectsForUser,
  declineLegacyImport,
} from '../userScope';

const BASE = 'synapse-projects-storage';
const CLAIM = 'synapse-projects-legacy-claimed-by';
const LEGACY = '{"state":{"projects":{"p1":{},"p2":{}}}}';

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

  it('counts anonymous projects available for import', () => {
    expect(countLegacyProjects()).toBe(0);
    localStorage.setItem(BASE, LEGACY);
    expect(countLegacyProjects()).toBe(2);
  });

  it('offers import only when anonymous projects exist and nothing is claimed', () => {
    expect(getLegacyImportOffer('userA')).toEqual({ available: false, projectCount: 0 });
    localStorage.setItem(BASE, LEGACY);
    expect(getLegacyImportOffer('userA')).toEqual({ available: true, projectCount: 2 });
    // Never offered to an anonymous (signed-out) session.
    expect(getLegacyImportOffer(null)).toEqual({ available: false, projectCount: 0 });
  });

  it('imports anonymous projects on explicit request, non-destructively', () => {
    localStorage.setItem(BASE, LEGACY);

    const imported = importLegacyProjectsForUser('userA');
    expect(imported).toBe(true);
    // Copied into the user's namespace...
    expect(localStorage.getItem(namespaceFor('userA'))).toContain('p1');
    // ...and the original legacy data is left untouched.
    expect(localStorage.getItem(BASE)).toBe(LEGACY);
    expect(localStorage.getItem(CLAIM)).toBe('userA');
  });

  it('does NOT silently adopt — a second account is never offered claimed projects', () => {
    localStorage.setItem(BASE, LEGACY);
    importLegacyProjectsForUser('userA');

    // Once claimed by userA, userB is not offered and cannot import.
    expect(getLegacyImportOffer('userB')).toEqual({ available: false, projectCount: 0 });
    expect(importLegacyProjectsForUser('userB')).toBe(false);
    expect(localStorage.getItem(namespaceFor('userB'))).toBeNull();
  });

  it('stops offering after a user declines, but leaves data importable by others', () => {
    localStorage.setItem(BASE, LEGACY);

    declineLegacyImport('userA');
    expect(getLegacyImportOffer('userA')).toEqual({ available: false, projectCount: 0 });
    // Declining does not claim — the real owner can still import later.
    expect(getLegacyImportOffer('userB')).toEqual({ available: true, projectCount: 2 });
  });

  it('never offers import to an account that already has its own projects', () => {
    localStorage.setItem(BASE, LEGACY);
    localStorage.setItem(namespaceFor('userA'), '{"state":{"projects":{"mine":{}}}}');

    expect(getLegacyImportOffer('userA')).toEqual({ available: false, projectCount: 0 });
    expect(importLegacyProjectsForUser('userA')).toBe(false);
    expect(localStorage.getItem(namespaceFor('userA'))).toContain('mine');
    expect(localStorage.getItem(namespaceFor('userA'))).not.toContain('p1');
  });
});
