import { Loader2 } from 'lucide-react';

/**
 * Branded full-screen boot state shown while the auth session resolves. The
 * first frame of the product carries the wordmark (matching LoginPage's
 * treatment), never a bare unbranded spinner.
 */
export function BootSplash() {
    return (
        <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-neutral-900 bg-blueprint-dark" role="status">
            <div className="flex flex-col items-center">
                <h1 className="font-display text-3xl font-bold tracking-tight text-neutral-100">Synapse</h1>
                <p className="text-sm text-muted-dark mt-2">From plain-language to product blueprint</p>
            </div>
            <Loader2 className="animate-spin text-brand-400" size={20} aria-hidden />
            <span className="sr-only">Loading Synapse…</span>
        </div>
    );
}
