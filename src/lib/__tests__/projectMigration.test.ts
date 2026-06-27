import { describe, it, expect, beforeEach } from 'vitest';
import {
  getMigratedProjectIds,
  markProjectsMigrated,
  isProjectMigrated,
} from '../projectMigration';

beforeEach(() => {
  localStorage.clear();
});

describe('projectMigration markers', () => {
  it('records migrated project ids per user', () => {
    markProjectsMigrated('user-a', ['p1', 'p2']);
    expect([...getMigratedProjectIds('user-a')].sort()).toEqual(['p1', 'p2']);
    expect(isProjectMigrated('user-a', 'p1')).toBe(true);
    expect(isProjectMigrated('user-a', 'p3')).toBe(false);
  });

  it('is namespaced per user', () => {
    markProjectsMigrated('user-a', ['p1']);
    expect(isProjectMigrated('user-b', 'p1')).toBe(false);
  });

  it('does not duplicate ids on repeated marking (prevents duplicate imports)', () => {
    markProjectsMigrated('user-a', ['p1']);
    markProjectsMigrated('user-a', ['p1', 'p1', 'p2']);
    const ids = getMigratedProjectIds('user-a');
    expect(ids.size).toBe(2);
  });
});
