// SYN-003: authoritative "does a rendered default-mockup image actually exist?"
// signal for the primary Default variant.
//
// The Screens variant grid used to infer the primary Default variant's
// "Generated" status from the mockup SPEC join alone (`item.mockupScreen`),
// never from the image store. A demo (or any device) could therefore claim a
// screen was "Generated" while showing the empty/upload state, because the
// spec existed but the rendered PNG did not (image generated in another
// browser, IndexedDB cleared, or a partial snapshot restore). This pure helper
// turns real image-store evidence into a MockupImagePresence so the derived
// variant model (src/lib/mockupVariants.ts) can gate the "Generated" claim on
// an actual image.
//
// A default mockup image can live in either of two stores:
//   - the AI mockup image store (src/store/mockupImageStore.ts), keyed
//     `${mockupVersionId}:${mockupScreenId}:${quality}`, and
//   - the screen-inventory image store (src/store/screenInventoryImageStore.ts),
//     which ALSO holds user-uploaded mockups keyed by the mockup version id +
//     screen slug (see the `user_uploaded` mockup mode).
// A record in EITHER store means the image is present.

import type { MockupImagePresence } from './mockupVariants';

export interface DefaultImagePresenceArgs {
    /** The AI mockup image store has finished loading this mockup version. */
    mockupImagesLoaded: boolean;
    /** An AI mockup image record exists for this screen's default slot. */
    hasMockupRecord: boolean;
    /** The screen-inventory image store has hydrated this mockup version. */
    inventoryHydrated: boolean;
    /** A user-uploaded mockup record exists for this screen's default slot. */
    hasUploadedRecord: boolean;
}

/**
 * Resolve the primary Default variant's image presence from real store
 * evidence. Rules:
 *   - ANY record (AI or uploaded) → 'present'. This short-circuits even if the
 *     other store hasn't settled yet — an image we can see is an image, and
 *     waiting on an unrelated store would only delay a correct answer.
 *   - both stores settled + no record → 'absent' (the honest empty state).
 *   - otherwise → 'checking' (still hydrating; do NOT flap the variant to
 *     "missing" mid-load).
 */
export function deriveDefaultImagePresence(args: DefaultImagePresenceArgs): MockupImagePresence {
    if (args.hasMockupRecord || args.hasUploadedRecord) return 'present';
    if (args.mockupImagesLoaded && args.inventoryHydrated) return 'absent';
    return 'checking';
}
