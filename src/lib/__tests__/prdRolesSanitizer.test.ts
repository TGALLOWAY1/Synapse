import { describe, expect, it } from 'vitest';
import type { RolePermission } from '../../types';
import {
    isImplementationPermission,
    sanitizeRolePermission,
    sanitizeRolePermissions,
    MAX_ALLOWED_PER_ROLE,
    MAX_RESTRICTED_PER_ROLE,
} from '../prdRolesSanitizer';

describe('isImplementationPermission', () => {
    it('flags backend / infrastructure / security-implementation items', () => {
        const bad = [
            'Disable SSL pinning',
            'Modify application-level security configurations',
            'Access authentication server configuration',
            'Modify encryption keys',
            'Access diagnostic endpoints',
            'Bypass sandbox restrictions',
            'Modify SQLite database',
            'Change API timeout configuration',
            'Modify telemetry',
            'Configure caches',
            'Bypass rate limiting',
            'Modify migration scripts',
            'Access Redis',
            'Rotate TLS certificates',
            'Edit JWT claims',
            'Deploy to Kubernetes',
            'Restart Docker containers',
            'Adjust load balancer',
            'Read session cookie',
            'Toggle feature flags',
        ];
        bad.forEach((item) => {
            expect(isImplementationPermission(item), item).toBe(true);
        });
    });

    it('does not flag legitimate business capabilities', () => {
        const good = [
            'Create workouts',
            'Edit meal plans',
            'Invite users',
            'View analytics',
            'Approve requests',
            'Export reports',
            'Log workouts',
            'Message coach',
            'Change subscription settings',
            'Authorize payments',
            'Manage organization members',
            'Pin a post to the top',
            'Configure notification preferences',
        ];
        good.forEach((item) => {
            expect(isImplementationPermission(item), item).toBe(false);
        });
    });
});

describe('sanitizeRolePermission', () => {
    it('strips implementation-detail items from allowed and restricted', () => {
        const role: RolePermission = {
            role: 'Admin',
            allowed: ['Invite users', 'Modify SQLite database', 'View analytics'],
            restricted: ['Disable SSL pinning', 'Cannot delete the workspace'],
        };
        const out = sanitizeRolePermission(role);
        expect(out.allowed).toEqual(['Invite users', 'View analytics']);
        expect(out.restricted).toEqual(['Cannot delete the workspace']);
    });

    it('drops an empty / all-implementation restricted section entirely', () => {
        const role: RolePermission = {
            role: 'Client',
            allowed: ['Log workouts', 'View progress'],
            restricted: ['Access diagnostic endpoints', 'Modify encryption keys'],
        };
        const out = sanitizeRolePermission(role);
        expect(out.restricted).toBeUndefined();
        expect('restricted' in out).toBe(false);
    });

    it('dedupes repeated permissions case-insensitively', () => {
        const role: RolePermission = {
            role: 'Editor',
            allowed: ['Edit meal plans', 'edit meal plans', 'Edit Meal Plans', 'Invite users'],
        };
        expect(sanitizeRolePermission(role).allowed).toEqual(['Edit meal plans', 'Invite users']);
    });

    it('caps excessively long lists to keep the artifact scannable', () => {
        const allowed = Array.from({ length: 40 }, (_, i) => `Do product action ${i}`);
        const restricted = Array.from({ length: 40 }, (_, i) => `Cannot do restricted thing ${i}`);
        const out = sanitizeRolePermission({ role: 'Power user', allowed, restricted });
        expect(out.allowed).toHaveLength(MAX_ALLOWED_PER_ROLE);
        expect(out.restricted).toHaveLength(MAX_RESTRICTED_PER_ROLE);
    });

    it('preserves role metadata (dataVisibility, notes)', () => {
        const role: RolePermission = {
            role: 'Coach',
            allowed: ['Create programs'],
            dataVisibility: 'Only their own clients',
            notes: 'Billed per seat',
        };
        const out = sanitizeRolePermission(role);
        expect(out.dataVisibility).toBe('Only their own clients');
        expect(out.notes).toBe('Billed per seat');
    });

    it('is idempotent', () => {
        const role: RolePermission = {
            role: 'Admin',
            allowed: ['Invite users', 'Modify SQLite database'],
            restricted: ['Disable SSL pinning'],
        };
        const once = sanitizeRolePermission(role);
        const twice = sanitizeRolePermission(once);
        expect(twice).toEqual(once);
    });

    it('ignores non-string / blank entries defensively', () => {
        const role = {
            role: 'Admin',
            allowed: ['Invite users', '', '   ', 42 as unknown as string, 'View analytics'],
        } as RolePermission;
        expect(sanitizeRolePermission(role).allowed).toEqual(['Invite users', 'View analytics']);
    });
});

describe('sanitizeRolePermissions', () => {
    it('sanitizes every role and returns non-arrays unchanged', () => {
        const roles: RolePermission[] = [
            { role: 'Client', allowed: ['Log workouts', 'Access authentication server'] },
            { role: 'Coach', allowed: ['Create programs'], restricted: ['Modify telemetry'] },
        ];
        const out = sanitizeRolePermissions(roles)!;
        expect(out[0].allowed).toEqual(['Log workouts']);
        expect(out[1].restricted).toBeUndefined();
        expect(sanitizeRolePermissions(undefined)).toBeUndefined();
    });
});
