// Lightweight, opt-in observability for the project persistence lifecycle.
//
// Projects live entirely in per-user-namespaced localStorage, so when they
// "disappear" the useful signal is which namespace was read/written, how many
// projects rehydrated, and how auth resolved. Enable by setting
// `localStorage['synapse-projects-debug'] = 'true'` or adding `?projectsdebug`
// to the URL. Off by default and fully SSR/test-safe (never throws).

let cached: boolean | null = null;

export function projectsDebugEnabled(): boolean {
  if (cached !== null) return cached;
  try {
    if (typeof localStorage !== 'undefined' && localStorage.getItem('synapse-projects-debug') === 'true') {
      cached = true;
      return true;
    }
    if (typeof location !== 'undefined' && location.search.includes('projectsdebug')) {
      cached = true;
      return true;
    }
  } catch {
    // localStorage/location unavailable — treat as disabled.
  }
  cached = false;
  return false;
}

export function projectsDebug(message: string, data?: unknown): void {
  if (!projectsDebugEnabled()) return;
  try {
    if (data === undefined) {
      console.info(`[projects] ${message}`);
    } else {
      console.info(`[projects] ${message}`, data);
    }
  } catch {
    // console unavailable — ignore.
  }
}
