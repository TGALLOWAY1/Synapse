import { create } from 'zustand';
import type { RecruiterUser } from '../lib/recruiterApi';
import { fetchSession } from '../lib/recruiterApi';

type AuthState = {
  user: RecruiterUser | null;
  loading: boolean;
  refreshSession: () => Promise<void>;
};

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  refreshSession: async () => {
    set({ loading: true });
    try {
      const session = await fetchSession();
      set({ user: session.authenticated ? session.user : null, loading: false });
    } catch {
      set({ user: null, loading: false });
    }
  },
}));
