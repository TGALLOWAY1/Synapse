import { describe, it, expect } from 'vitest';
import {
  extractProjectBundle,
  mergeBundlesIntoSource,
  projectSlicesChanged,
  isValidBundle,
  type BundleSource,
  type ProjectBundle,
} from '../projectBundle';

function emptySource(): BundleSource {
  return {
    projects: {},
    spineVersions: {},
    historyEvents: {},
    branches: {},
    artifacts: {},
    artifactVersions: {},
    feedbackItems: {},
    tasks: {},
    workflowRuns: {},
  };
}

function sourceWith(id: string): BundleSource {
  const s = emptySource();
  s.projects[id] = { id, name: `Project ${id}`, createdAt: 1 };
  s.spineVersions[id] = [
    { id: 'v1', projectId: id, promptText: 'idea', responseText: 'x', createdAt: 1, isLatest: true, isFinal: false },
  ];
  s.tasks[id] = [];
  return s;
}

describe('extractProjectBundle', () => {
  it('gathers all nine slices for a project, defaulting missing ones to []', () => {
    const bundle = extractProjectBundle(sourceWith('p1'), 'p1');
    expect(bundle).not.toBeNull();
    expect(bundle!.project.id).toBe('p1');
    expect(bundle!.spineVersions).toHaveLength(1);
    expect(bundle!.historyEvents).toEqual([]);
    expect(bundle!.workflowRuns).toEqual([]);
  });

  it('returns null for an unknown project', () => {
    expect(extractProjectBundle(emptySource(), 'nope')).toBeNull();
  });
});

describe('mergeBundlesIntoSource', () => {
  it('adds a server project the device does not have (cross-device pull)', () => {
    const local = emptySource();
    const bundle = extractProjectBundle(sourceWith('p1'), 'p1') as ProjectBundle;
    const { next, addedIds } = mergeBundlesIntoSource(local, [bundle]);
    expect(addedIds).toEqual(['p1']);
    expect(next.projects['p1']).toBeTruthy();
    expect(next.spineVersions['p1']).toHaveLength(1);
  });

  it('keeps the local copy on id collision (local always wins, no clobber)', () => {
    const local = sourceWith('p1');
    local.projects['p1'].name = 'Local edit';
    const serverBundle = extractProjectBundle(sourceWith('p1'), 'p1') as ProjectBundle;
    serverBundle.project.name = 'Server version';
    const { next, addedIds } = mergeBundlesIntoSource(local, [serverBundle]);
    expect(addedIds).toEqual([]);
    expect(next.projects['p1'].name).toBe('Local edit');
  });

  it('ignores structurally invalid bundles', () => {
    const { addedIds } = mergeBundlesIntoSource(emptySource(), [{} as ProjectBundle]);
    expect(addedIds).toEqual([]);
  });
});

describe('projectSlicesChanged', () => {
  it('detects a changed slice by reference', () => {
    const a = sourceWith('p1');
    const b: BundleSource = { ...a, spineVersions: { ...a.spineVersions, p1: [] } };
    expect(projectSlicesChanged(a, b, 'p1')).toBe(true);
  });

  it('reports unchanged when references are identical', () => {
    const a = sourceWith('p1');
    expect(projectSlicesChanged(a, a, 'p1')).toBe(false);
  });
});

describe('isValidBundle', () => {
  it('requires a project with a non-empty id', () => {
    expect(isValidBundle({ project: { id: 'p1' } })).toBe(true);
    expect(isValidBundle({ project: { id: '' } })).toBe(false);
    expect(isValidBundle({})).toBe(false);
    expect(isValidBundle(null)).toBe(false);
  });
});
