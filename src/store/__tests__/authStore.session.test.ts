import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock every side-effecting dependency the auth store wires up so the test
// exercises only the session-resolution logic.
const fetchSession = vi.fn();
vi.mock('../../lib/recruiterApi', () => ({
  fetchSession: (...args: unknown[]) => fetchSession(...args),
  loginWithEmail: vi.fn(),
  signupWithEmail: vi.fn(),
  logout: vi.fn(),
}));

const applyProjectUser = vi.fn();
vi.mock('../projectUserSync', () => ({
  applyProjectUser: (...args: unknown[]) => applyProjectUser(...args),
}));

vi.mock('../../lib/providerSession', () => ({
  primeProviderSession: vi.fn(),
  clearProviderSession: vi.fn(),
  clearLocalProviderKeys: vi.fn(),
}));

import { useAuthStore } from '../authStore';

const USER = { userId: 'u1', authProvider: 'email' as const, name: 'A', profileUrl: null, headline: '', company: null, avatarUrl: null };

describe('authStore.refreshSession', () => {
  beforeEach(() => {
    fetchSession.mockReset();
    applyProjectUser.mockReset();
    useAuthStore.setState({ user: null, loading: true, authError: null });
  });

  it('sets the user and clears error on an authenticated session', async () => {
    fetchSession.mockResolvedValue({ authenticated: true, user: USER });
    await useAuthStore.getState().refreshSession();
    const s = useAuthStore.getState();
    expect(s.user).toEqual(USER);
    expect(s.loading).toBe(false);
    expect(s.authError).toBeNull();
    expect(applyProjectUser).toHaveBeenCalledWith('u1');
  });

  it('resolves to signed-out (no error) on an unauthenticated session', async () => {
    fetchSession.mockResolvedValue({ authenticated: false });
    await useAuthStore.getState().refreshSession();
    const s = useAuthStore.getState();
    expect(s.user).toBeNull();
    expect(s.authError).toBeNull();
    expect(applyProjectUser).toHaveBeenCalledWith(null);
  });

  it('records authError on a transport/server failure WITHOUT masquerading as signed-out', async () => {
    // A previously signed-in user must NOT be dropped to null (which would swap
    // the project namespace and make projects look like they vanished).
    useAuthStore.setState({ user: USER, loading: true, authError: null });
    fetchSession.mockRejectedValue(new Error('session_request_failed_500'));

    await useAuthStore.getState().refreshSession();

    const s = useAuthStore.getState();
    expect(s.loading).toBe(false);
    expect(s.authError).toBe('session_request_failed_500');
    // User preserved; project namespace NOT switched on failure.
    expect(s.user).toEqual(USER);
    expect(applyProjectUser).not.toHaveBeenCalled();
  });
});
