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
  mergeNamespaceInto,
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

  it('still offers recovery when the user has their own projects but unclaimed legacy projects remain', () => {
    // Regression for "projects disappearing": before this, the moment a user
    // created any namespaced project the import offer vanished forever, leaving
    // pre-namespacing projects permanently stranded.
    localStorage.setItem(BASE, LEGACY); // p1, p2
    localStorage.setItem(namespaceFor('userA'), '{"state":{"projects":{"mine":{}}}}');

    // p1 + p2 are both missing from userA's namespace, so 2 are importable.
    expect(getLegacyImportOffer('userA')).toEqual({ available: true, projectCount: 2 });
  });

  it('merges legacy projects additively without overwriting the user\'s own', () => {
    // Legacy has p1, p2 and a colliding id "mine" with different data; the
    // user's own "mine" must win, and p1/p2 must be added.
    localStorage.setItem(BASE, '{"state":{"projects":{"p1":{},"p2":{},"mine":{"name":"legacy"}}}}');
    localStorage.setItem(
      namespaceFor('userA'),
      '{"state":{"projects":{"mine":{"name":"current"}}}}',
    );

    expect(importLegacyProjectsForUser('userA')).toBe(true);

    const blob = JSON.parse(localStorage.getItem(namespaceFor('userA'))!);
    const projects = blob.state.projects;
    expect(Object.keys(projects).sort()).toEqual(['mine', 'p1', 'p2']);
    // Existing entry wins on collision — the user's data is never clobbered.
    expect(projects.mine.name).toBe('current');
    // Claimed so the offer stops afterward.
    expect(localStorage.getItem(CLAIM)).toBe('userA');
    expect(getLegacyImportOffer('userA')).toEqual({ available: false, projectCount: 0 });
  });

  it('merges all project-keyed collections, not just the projects map', () => {
    localStorage.setItem(
      BASE,
      JSON.stringify({
        state: {
          projects: { p1: {} },
          spineVersions: { p1: [{ id: 'v1' }] },
          historyEvents: { p1: [{ id: 'h1' }] },
        },
      }),
    );
    localStorage.setItem(namespaceFor('userA'), '{"state":{"projects":{"mine":{}}}}');

    expect(importLegacyProjectsForUser('userA')).toBe(true);
    const blob = JSON.parse(localStorage.getItem(namespaceFor('userA'))!);
    expect(blob.state.spineVersions.p1).toEqual([{ id: 'v1' }]);
    expect(blob.state.historyEvents.p1).toEqual([{ id: 'h1' }]);
  });

  it('does not re-offer once every legacy project is already present', () => {
    localStorage.setItem(BASE, '{"state":{"projects":{"p1":{}}}}');
    localStorage.setItem(namespaceFor('userA'), '{"state":{"projects":{"p1":{}}}}');

    // Nothing importable (p1 already owned).
    expect(getLegacyImportOffer('userA')).toEqual({ available: false, projectCount: 0 });
    // Importing claims (so the offer stops) but reports no data added.
    expect(importLegacyProjectsForUser('userA')).toBe(false);
    expect(localStorage.getItem(CLAIM)).toBe('userA');
  });
});

describe('mergeNamespaceInto (account-linking recovery — R3)', () => {
  beforeEach(() => {
    localStorage.clear();
    setActiveProjectUser(null);
  });

  it('copies the source namespace wholesale when the target has none yet', () => {
    localStorage.setItem(namespaceFor('old'), '{"state":{"projects":{"p1":{}}}}');
    expect(mergeNamespaceInto('canonical', 'old')).toBe(true);
    expect(localStorage.getItem(namespaceFor('canonical'))).toContain('p1');
    // Source left untouched (non-destructive / idempotent).
    expect(localStorage.getItem(namespaceFor('old'))).toContain('p1');
  });

  it('merges additively, keeping the canonical account\'s own entries on collision', () => {
    localStorage.setItem(namespaceFor('canonical'), '{"state":{"projects":{"mine":{"name":"keep"},"dup":{"name":"current"}}}}');
    localStorage.setItem(namespaceFor('old'), '{"state":{"projects":{"p1":{},"dup":{"name":"old"}}}}');

    expect(mergeNamespaceInto('canonical', 'old')).toBe(true);
    const projects = JSON.parse(localStorage.getItem(namespaceFor('canonical'))!).state.projects;
    expect(Object.keys(projects).sort()).toEqual(['dup', 'mine', 'p1']);
    expect(projects.dup.name).toBe('current'); // canonical wins
  });

  it('is a no-op when there is nothing new to merge', () => {
    localStorage.setItem(namespaceFor('canonical'), '{"state":{"projects":{"p1":{}}}}');
    localStorage.setItem(namespaceFor('old'), '{"state":{"projects":{"p1":{}}}}');
    expect(mergeNamespaceInto('canonical', 'old')).toBe(false);
  });

  it('ignores a missing source and a self-merge', () => {
    expect(mergeNamespaceInto('canonical', 'nonexistent')).toBe(false);
    expect(mergeNamespaceInto('same', 'same')).toBe(false);
  });
});
