import { Link2, Check, Github, Linkedin, Mail } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { startProviderLink, type AuthProvider } from '../../lib/recruiterApi';

// Providers a user can connect via OAuth (email is password-based, shown as
// connected but not linkable here).
const LINKABLE: { provider: Exclude<AuthProvider, 'email'>; label: string; Icon: typeof Github }[] = [
  { provider: 'github', label: 'GitHub', Icon: Github },
  { provider: 'linkedin', label: 'LinkedIn', Icon: Linkedin },
];

/**
 * "Connected accounts" — lets a signed-in user link additional sign-in methods
 * to their account so the SAME projects show up regardless of how they sign in
 * next time (resolves R3: one human → one stable account → one project
 * namespace). Linking is a full-page OAuth redirect; on return the session
 * refreshes and any projects from a previously-divergent account are merged in.
 */
export function ConnectedAccountsSection() {
  const user = useAuthStore((s) => s.user);
  if (!user) return null;

  const connected = new Set<string>(
    (user.linkedProviders && user.linkedProviders.length > 0
      ? user.linkedProviders.map((p) => p.authProvider)
      : user.authProvider
        ? [user.authProvider]
        : []),
  );

  return (
    <div className="space-y-3">
      <label className="text-sm font-semibold text-neutral-300 flex items-center gap-2">
        <Link2 size={14} className="text-indigo-400" />
        Connected sign-in methods
      </label>
      <p className="text-[11px] text-neutral-500 leading-relaxed -mt-1">
        Link the ways you sign in so your projects stay with you no matter which
        you use. Projects are saved per account, so connecting GitHub and
        LinkedIn (and email) to one account keeps them together.
      </p>

      <div className="space-y-2">
        {/* Email is connected when the account has an email-provider identity. */}
        {connected.has('email') && (
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3">
            <span className="flex items-center gap-2 text-sm text-neutral-200">
              <Mail size={15} className="text-neutral-400" /> Email
            </span>
            <span className="flex items-center gap-1 text-xs font-medium text-emerald-400">
              <Check size={13} /> Connected
            </span>
          </div>
        )}

        {LINKABLE.map(({ provider, label, Icon }) => {
          const isConnected = connected.has(provider);
          return (
            <div
              key={provider}
              className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3"
            >
              <span className="flex items-center gap-2 text-sm text-neutral-200">
                <Icon size={15} className="text-neutral-400" /> {label}
              </span>
              {isConnected ? (
                <span className="flex items-center gap-1 text-xs font-medium text-emerald-400">
                  <Check size={13} /> Connected
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => startProviderLink(provider)}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition"
                >
                  Connect
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
