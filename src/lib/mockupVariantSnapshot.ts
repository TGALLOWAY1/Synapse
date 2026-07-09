// Phase 3D: portable snapshot / restore layer for per-variant mockup images.
//
// Phase 3B/3C stored generated variant images, coverage manifests, source
// signatures, and variant history ONLY in a device-local IndexedDB store
// (src/lib/mockupVariantImageStore.ts). They did not travel in project
// snapshots and could not be recovered on another device. This module makes
// those records PORTABLE:
//
//   - `buildMockupVariantImageSnapshot` serializes the local store records into
//     a schema-versioned, size-guarded transport format.
//   - `validateMockupVariantImageSnapshot` / `estimateMockupVariantSnapshotSize`
//     are pure guards used before writing or restoring.
//   - `restoreMockupVariantImageSnapshot` hydrates a snapshot back into the
//     variant store (IndexedDB + the reactive cache) with CONSERVATIVE merge
//     semantics — it never blindly overwrites newer local work.
//   - `splitVariantSnapshotImages` / `joinVariantSnapshotImages` move the image
//     BYTES out of the JSON envelope so the wire path reuses the existing
//     per-image blob channel in snapshotClient (dodging Vercel's ~4.5 MB cap),
//     exactly like mockup + screen-inventory images already do.
//
// Everything here is PURE except `restoreMockupVariantImageSnapshot`, which
// takes its IndexedDB accessors injected so it stays unit-testable without a
// real IDB. Honesty rules from the rest of the Screens layer carry over: a
// legacy record with no image/metadata is never fabricated, and only safe
// raster image payloads (png/jpeg/webp — never SVG) travel.

import type {
    MockupCoverageManifest, MockupImageQuality, MockupVariantImageRecord,
    MockupVariantImageHistoryEntry,
} from '../types';
import type { MockupVariantSourceSignature } from './mockupVariantTrust';
import { buildVariantImageKey } from './mockupVariantImageStore';

// --- Constants ---------------------------------------------------------------

export const MOCKUP_VARIANT_SNAPSHOT_SCHEMA_VERSION = 1 as const;

/** Per-image ceiling. A gpt-image-2 PNG is normally 0.2–2 MB; 8 MB is a
 * generous cap that only skips pathological payloads. */
export const MAX_VARIANT_IMAGE_BYTES = 8 * 1024 * 1024;
/** Whole-section ceiling so one project can't produce a 500 MB snapshot. */
export const MAX_VARIANT_SNAPSHOT_TOTAL_BYTES = 50 * 1024 * 1024;
/** History entries preserved per variant in a snapshot (store cap is 6). */
export const MAX_VARIANT_SNAPSHOT_HISTORY = 10;

/** Only safe raster image types travel — never SVG (script-bearing) or other. */
export const SAFE_VARIANT_IMAGE_MIME: readonly string[] = [
    'image/png', 'image/jpeg', 'image/webp',
];

const VALID_QUALITIES: readonly MockupImageQuality[] = ['low', 'medium', 'high'];
const VALID_VIEWPORTS: readonly string[] = ['desktop', 'mobile', 'tablet'];

// --- Transport types ---------------------------------------------------------

export type MockupVariantSnapshotSource =
    | 'generated_variant'
    | 'default_sidecar'
    | 'legacy_sidecar';

export interface MockupVariantImageSnapshotHistoryEntry {
    imageDataUrl?: string;
    imageMimeType?: string;
    imageByteLength?: number;
    quality?: MockupImageQuality;
    prompt?: string;
    manifest?: MockupCoverageManifest;
    sourceSignature?: MockupVariantSourceSignature;
    generatedAt?: number;
    reason?: 'regenerated' | 'replaced';
    /** Wire-only: key the image blob was shipped under (set by
     * `splitVariantSnapshotImages`, cleared by `joinVariantSnapshotImages`). */
    imageRef?: string;
}

export interface MockupVariantImageSnapshotRecord {
    key: string;
    versionId: string;
    screenId: string;
    variantId: string;
    quality: MockupImageQuality;
    projectId?: string;
    artifactId?: string;
    viewport?: 'desktop' | 'mobile' | 'tablet';
    stateName?: string;
    imageDataUrl?: string;
    imageMimeType?: string;
    imageByteLength?: number;
    prompt?: string;
    manifest?: MockupCoverageManifest;
    sourceSignature?: MockupVariantSourceSignature;
    generatedFrom?: {
        prdVersionId?: string;
        screenVersionId?: string;
        designSystemVersionId?: string;
    };
    generatedAt?: number;
    history?: MockupVariantImageSnapshotHistoryEntry[];
    source?: MockupVariantSnapshotSource;
    /** Wire-only: key the current image blob was shipped under. */
    imageRef?: string;
}

export interface MockupVariantImageSnapshotSummary {
    recordCount: number;
    historyEntryCount: number;
    totalApproxBytes: number;
    skippedCount?: number;
    warnings?: string[];
}

export interface MockupVariantImageSnapshot {
    schemaVersion: 1;
    projectId?: string;
    exportedAt: string;
    records: MockupVariantImageSnapshotRecord[];
    summary: MockupVariantImageSnapshotSummary;
}

// --- Image data-url safety ---------------------------------------------------

export interface ParsedImageDataUrl {
    mime: string;
    base64: string;
    approxBytes: number;
}

/** Parse + validate a base64 image data URL. Returns null for anything that is
 * not a well-formed `data:<safe-mime>;base64,<payload>` string. Rejects SVG and
 * every non-raster / non-safe MIME. */
export function parseImageDataUrl(dataUrl: unknown): ParsedImageDataUrl | null {
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
    const comma = dataUrl.indexOf(',');
    if (comma < 0) return null;
    const header = dataUrl.slice(5, comma); // between "data:" and ","
    const base64 = dataUrl.slice(comma + 1);
    if (!header.includes(';base64')) return null;
    const mime = header.slice(0, header.indexOf(';')).trim().toLowerCase();
    if (!SAFE_VARIANT_IMAGE_MIME.includes(mime)) return null;
    if (base64.length === 0) return null;
    // Decoded byte length ≈ 3/4 of the base64 length, minus padding.
    const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    const approxBytes = Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
    return { mime, base64, approxBytes };
}

export const isSafeVariantImageDataUrl = (dataUrl: unknown): boolean =>
    parseImageDataUrl(dataUrl) !== null;

// --- Build (store records -> portable snapshot) ------------------------------

export interface BuildVariantSnapshotOptions {
    projectId?: string;
    /** ISO timestamp; defaults to now. Injectable for deterministic tests. */
    exportedAt?: string;
    maxImageBytes?: number;
    maxTotalBytes?: number;
    maxHistory?: number;
}

const classifySource = (record: MockupVariantImageRecord): MockupVariantSnapshotSource =>
    record.variantId === 'default' ? 'default_sidecar' : 'generated_variant';

const hasUsefulMetadata = (record: MockupVariantImageRecord): boolean =>
    Boolean(record.coverageManifest || record.sourceSignature || record.generatedFrom);

/**
 * Serialize the local variant image records into a portable, size-guarded
 * snapshot. Records are processed in the given order so the size caps are
 * deterministic. Rules:
 *   - `variantId === 'default'` → a metadata-only sidecar (no image bytes; the
 *     legacy default image lives elsewhere and is never moved here).
 *   - a non-default record with a SAFE, in-size image → a full generated variant
 *     (with size-guarded history).
 *   - a non-default record with no safe/in-size image → SKIPPED (a warning is
 *     recorded) — never serialized as a fake image-bearing record, because on
 *     restore a non-default variant record must carry a real image to render.
 */
export function buildMockupVariantImageSnapshot(
    records: readonly MockupVariantImageRecord[],
    options: BuildVariantSnapshotOptions = {},
): MockupVariantImageSnapshot {
    const maxImageBytes = options.maxImageBytes ?? MAX_VARIANT_IMAGE_BYTES;
    const maxTotalBytes = options.maxTotalBytes ?? MAX_VARIANT_SNAPSHOT_TOTAL_BYTES;
    const maxHistory = options.maxHistory ?? MAX_VARIANT_SNAPSHOT_HISTORY;

    const out: MockupVariantImageSnapshotRecord[] = [];
    const warnings: string[] = [];
    let skippedCount = 0;
    let historyEntryCount = 0;
    let totalApproxBytes = 0;

    const label = (r: MockupVariantImageRecord) =>
        `${r.stateName || r.variantId} (${r.viewport}) on ${r.screenId}`;

    for (const record of records) {
        const source = classifySource(record);

        // Base metadata carried by every serialized record.
        const base: MockupVariantImageSnapshotRecord = {
            key: record.key,
            versionId: record.versionId,
            screenId: record.screenId,
            variantId: record.variantId,
            quality: record.quality,
            projectId: record.projectId,
            artifactId: record.artifactId,
            viewport: record.viewport,
            stateName: record.stateName,
            prompt: record.prompt || undefined,
            manifest: record.coverageManifest,
            sourceSignature: record.sourceSignature as MockupVariantSourceSignature | undefined,
            generatedFrom: record.generatedFrom,
            generatedAt: record.generatedAt,
            source,
        };

        if (source === 'default_sidecar') {
            // Metadata-only. Include only if it actually carries coverage /
            // freshness metadata worth restoring.
            if (!hasUsefulMetadata(record)) {
                skippedCount += 1;
                continue;
            }
            out.push(base);
            continue;
        }

        // Non-default variant: needs a safe, in-size image to be portable.
        const parsed = parseImageDataUrl(record.dataUrl);
        if (!parsed) {
            skippedCount += 1;
            if (hasUsefulMetadata(record)) {
                warnings.push(`Skipped a mockup variant with no restorable image: ${label(record)}.`);
            }
            continue;
        }
        if (parsed.approxBytes > maxImageBytes) {
            skippedCount += 1;
            warnings.push(`A mockup variant image was too large to include: ${label(record)}.`);
            continue;
        }
        if (totalApproxBytes + parsed.approxBytes > maxTotalBytes) {
            skippedCount += 1;
            warnings.push(`Reached the snapshot size limit; some mockup variant images were left out (starting with ${label(record)}).`);
            continue;
        }

        totalApproxBytes += parsed.approxBytes;

        // History — size-guard each entry; drop (with a warning) any that are
        // too large / unsafe. History is non-critical, so a dropped entry never
        // skips the record itself.
        const historyOut: MockupVariantImageSnapshotHistoryEntry[] = [];
        for (const entry of (record.history ?? []).slice(0, maxHistory)) {
            const hp = parseImageDataUrl(entry.dataUrl);
            if (!hp) continue;
            if (hp.approxBytes > maxImageBytes
                || totalApproxBytes + hp.approxBytes > maxTotalBytes) {
                warnings.push(`A previous render of ${label(record)} was too large to include in history.`);
                continue;
            }
            totalApproxBytes += hp.approxBytes;
            historyEntryCount += 1;
            historyOut.push({
                imageDataUrl: entry.dataUrl,
                imageMimeType: hp.mime,
                imageByteLength: hp.approxBytes,
                quality: entry.quality,
                prompt: entry.prompt,
                manifest: entry.coverageManifest,
                sourceSignature: entry.sourceSignature as MockupVariantSourceSignature | undefined,
                generatedAt: entry.generatedAt,
                reason: entry.reason,
            });
        }

        out.push({
            ...base,
            imageDataUrl: record.dataUrl,
            imageMimeType: parsed.mime,
            imageByteLength: parsed.approxBytes,
            ...(historyOut.length ? { history: historyOut } : {}),
        });
    }

    return {
        schemaVersion: MOCKUP_VARIANT_SNAPSHOT_SCHEMA_VERSION,
        projectId: options.projectId,
        exportedAt: options.exportedAt ?? new Date().toISOString(),
        records: out,
        summary: {
            recordCount: out.length,
            historyEntryCount,
            totalApproxBytes,
            ...(skippedCount ? { skippedCount } : {}),
            ...(warnings.length ? { warnings } : {}),
        },
    };
}

// --- Validation --------------------------------------------------------------

export interface VariantSnapshotValidationResult {
    /** Envelope is a usable snapshot object (schema + records array). Per-record
     * image-safety problems do NOT flip this — they are reported in `errors`
     * and skipped at restore, so one bad image never blocks the whole section. */
    valid: boolean;
    errors: string[];
    warnings: string[];
    recordCount: number;
    /** Records whose current image is a safe, in-size raster payload. */
    safeImageCount: number;
}

/** Validate a value claiming to be a MockupVariantImageSnapshot. Envelope-level
 * problems (not an object, unsupported schema, records not an array) make the
 * result `invalid`. Individual records with unsafe/malformed images are flagged
 * in `errors` for visibility but leave the envelope usable — restore skips them
 * individually rather than failing wholesale. */
export function validateMockupVariantImageSnapshot(
    input: unknown,
): VariantSnapshotValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!input || typeof input !== 'object') {
        return { valid: false, errors: ['Not a snapshot object.'], warnings, recordCount: 0, safeImageCount: 0 };
    }
    const snap = input as Partial<MockupVariantImageSnapshot>;
    if (snap.schemaVersion !== MOCKUP_VARIANT_SNAPSHOT_SCHEMA_VERSION) {
        return {
            valid: false,
            errors: [`Unsupported variant snapshot schema version: ${String(snap.schemaVersion)}.`],
            warnings,
            recordCount: 0,
            safeImageCount: 0,
        };
    }
    if (!Array.isArray(snap.records)) {
        return { valid: false, errors: ['Snapshot has no records array.'], warnings, recordCount: 0, safeImageCount: 0 };
    }

    let safeImageCount = 0;
    for (let i = 0; i < snap.records.length; i++) {
        const r = snap.records[i] as Partial<MockupVariantImageSnapshotRecord> | null;
        if (!r || typeof r !== 'object') {
            errors.push(`Record ${i} is malformed.`);
            continue;
        }
        if (typeof r.key !== 'string' || typeof r.versionId !== 'string'
            || typeof r.screenId !== 'string' || typeof r.variantId !== 'string') {
            errors.push(`Record ${i} is missing required identity fields.`);
            continue;
        }
        if (r.quality !== undefined && !VALID_QUALITIES.includes(r.quality)) {
            warnings.push(`Record ${r.key} has an unexpected quality; defaulting to "low".`);
        }
        if (r.viewport !== undefined && !VALID_VIEWPORTS.includes(r.viewport)) {
            warnings.push(`Record ${r.key} has an unexpected viewport.`);
        }
        if (r.imageDataUrl !== undefined) {
            if (isSafeVariantImageDataUrl(r.imageDataUrl)) {
                safeImageCount += 1;
            } else {
                errors.push(`Record ${r.key} has an unsafe or malformed image payload; it will be skipped.`);
            }
        }
    }

    return { valid: true, errors, warnings, recordCount: snap.records.length, safeImageCount };
}

// --- Size estimation ---------------------------------------------------------

/** Approximate the serialized byte cost of a snapshot: the decoded image bytes
 * (the dominant term) plus a rough allowance for the JSON metadata. */
export function estimateMockupVariantSnapshotSize(
    snapshot: MockupVariantImageSnapshot,
): number {
    let bytes = 0;
    for (const r of snapshot.records ?? []) {
        bytes += r.imageByteLength ?? parseImageDataUrl(r.imageDataUrl)?.approxBytes ?? 0;
        for (const h of r.history ?? []) {
            bytes += h.imageByteLength ?? parseImageDataUrl(h.imageDataUrl)?.approxBytes ?? 0;
        }
    }
    // Metadata overhead: manifests + signatures are small; a flat per-record
    // allowance keeps the estimate an honest upper-ish bound without stringifying
    // megabytes of base64.
    const metadataOverhead = (snapshot.records?.length ?? 0) * 2048;
    return bytes + metadataOverhead;
}

// --- Wire split / join (image bytes out of the JSON envelope) ----------------

export interface SplitVariantSnapshot {
    /** Snapshot with every `imageDataUrl` removed and replaced by an `imageRef`
     * key; safe to embed in the (size-limited) bundle POST. */
    snapshot: MockupVariantImageSnapshot;
    /** The extracted image blobs, ready for the existing per-image upload
     * channel. Keys are prefixed `vimg:` so they never collide with mockup or
     * screen-inventory image keys (the server hashes the key anyway). */
    images: Array<{ key: string; dataUrl: string }>;
}

const currentImageRefKey = (recordKey: string): string => `vimg:${recordKey}`;
const historyImageRefKey = (recordKey: string, index: number): string =>
    `vimg:${recordKey}#h${index}`;

/** Move image bytes out of the snapshot into a flat `{key,dataUrl}` list. The
 * returned snapshot carries `imageRef` keys instead of `imageDataUrl`, so it is
 * small enough to ride inside the bundle POST while the bytes travel through the
 * per-image blob channel. Metadata-only records (default sidecars) are left
 * untouched. */
export function splitVariantSnapshotImages(
    snapshot: MockupVariantImageSnapshot,
): SplitVariantSnapshot {
    const images: Array<{ key: string; dataUrl: string }> = [];
    const records = snapshot.records.map((record) => {
        const next: MockupVariantImageSnapshotRecord = { ...record };
        if (typeof next.imageDataUrl === 'string' && next.imageDataUrl.length > 0) {
            const refKey = currentImageRefKey(record.key);
            images.push({ key: refKey, dataUrl: next.imageDataUrl });
            next.imageRef = refKey;
            delete next.imageDataUrl;
        }
        if (next.history && next.history.length > 0) {
            next.history = next.history.map((entry, i) => {
                if (typeof entry.imageDataUrl !== 'string' || entry.imageDataUrl.length === 0) return entry;
                const refKey = historyImageRefKey(record.key, i);
                images.push({ key: refKey, dataUrl: entry.imageDataUrl });
                const nextEntry = { ...entry, imageRef: refKey };
                delete nextEntry.imageDataUrl;
                return nextEntry;
            });
        }
        return next;
    });
    return { snapshot: { ...snapshot, records }, images };
}

/** Collect the `imageRef` keys a split snapshot references, so the loader knows
 * which per-image blobs to fetch. */
export function collectVariantSnapshotImageRefs(
    snapshot: MockupVariantImageSnapshot | undefined,
): string[] {
    if (!snapshot || !Array.isArray(snapshot.records)) return [];
    const keys: string[] = [];
    for (const r of snapshot.records) {
        if (typeof r.imageRef === 'string') keys.push(r.imageRef);
        for (const h of r.history ?? []) {
            if (typeof h.imageRef === 'string') keys.push(h.imageRef);
        }
    }
    return keys;
}

/** Re-attach image bytes fetched via the per-image channel. A ref missing from
 * the map (a failed fetch) drops that image — the record/history entry is left
 * without bytes and will be skipped on restore, never restored broken. */
export function joinVariantSnapshotImages(
    snapshot: MockupVariantImageSnapshot,
    dataUrlByKey: Map<string, string>,
): MockupVariantImageSnapshot {
    const records = snapshot.records.map((record) => {
        const next: MockupVariantImageSnapshotRecord = { ...record };
        if (typeof next.imageRef === 'string') {
            const dataUrl = dataUrlByKey.get(next.imageRef);
            if (dataUrl) next.imageDataUrl = dataUrl;
            delete next.imageRef;
        }
        if (next.history && next.history.length > 0) {
            next.history = next.history.map((entry) => {
                if (typeof entry.imageRef !== 'string') return entry;
                const nextEntry = { ...entry };
                const dataUrl = dataUrlByKey.get(entry.imageRef);
                if (dataUrl) nextEntry.imageDataUrl = dataUrl;
                delete nextEntry.imageRef;
                return nextEntry;
            });
        }
        return next;
    });
    return { ...snapshot, records };
}

// --- Restore (portable snapshot -> store records) ----------------------------

const historyDedupeKey = (entry: { dataUrl?: string; imageDataUrl?: string; generatedAt?: number }): string =>
    `${entry.dataUrl ?? entry.imageDataUrl ?? ''}|${entry.generatedAt ?? 0}`;

/** Convert a portable history entry into a store history entry, inheriting the
 * parent record's quality when the entry omits one. Returns null when the entry
 * carries no safe image (a store history entry requires a real dataUrl). */
function toStoreHistoryEntry(
    entry: MockupVariantImageSnapshotHistoryEntry,
    fallbackQuality: MockupImageQuality,
): MockupVariantImageHistoryEntry | null {
    if (!isSafeVariantImageDataUrl(entry.imageDataUrl)) return null;
    return {
        dataUrl: entry.imageDataUrl as string,
        quality: entry.quality ?? fallbackQuality,
        prompt: entry.prompt,
        coverageManifest: entry.manifest,
        sourceSignature: entry.sourceSignature,
        generatedAt: entry.generatedAt ?? 0,
        reason: entry.reason,
    };
}

/** Convert a portable record into a store record. Returns null when the record
 * cannot be safely restored (a non-default variant with no safe image). Default
 * sidecars are metadata-only and always restorable when their identity is
 * valid. */
function toStoreRecord(
    snap: MockupVariantImageSnapshotRecord,
    maxHistory: number,
): MockupVariantImageRecord | null {
    if (typeof snap.key !== 'string' || typeof snap.versionId !== 'string'
        || typeof snap.screenId !== 'string' || typeof snap.variantId !== 'string') {
        return null;
    }
    const quality = VALID_QUALITIES.includes(snap.quality) ? snap.quality : 'low';
    const isDefault = snap.variantId === 'default';
    const parsed = parseImageDataUrl(snap.imageDataUrl);

    if (!isDefault && !parsed) {
        // A non-default variant with no safe image would render as a broken
        // <img>. Its metadata has nowhere safe to live, so skip it.
        return null;
    }

    const history = (snap.history ?? [])
        .slice(0, maxHistory)
        .map((e) => toStoreHistoryEntry(e, quality))
        .filter((e): e is MockupVariantImageHistoryEntry => e !== null);

    return {
        key: snap.key,
        projectId: snap.projectId ?? '',
        artifactId: snap.artifactId ?? '',
        versionId: snap.versionId,
        screenId: snap.screenId,
        variantId: snap.variantId,
        viewport: snap.viewport ?? 'desktop',
        stateName: snap.stateName ?? 'Default',
        // Default sidecars carry no owned image (the legacy path renders it).
        dataUrl: parsed ? (snap.imageDataUrl as string) : '',
        quality,
        prompt: snap.prompt ?? '',
        coverageManifest: snap.manifest,
        sourceSignature: snap.sourceSignature,
        generatedFrom: snap.generatedFrom,
        ...(history.length ? { history } : {}),
        generatedAt: snap.generatedAt ?? 0,
    };
}

const recordHasImage = (r: MockupVariantImageRecord): boolean =>
    typeof r.dataUrl === 'string' && r.dataUrl.length > 0;

const signatureHash = (sig: unknown): string => {
    if (!sig || typeof sig !== 'object') return '';
    const s = sig as MockupVariantSourceSignature;
    return `${s.screenContractHash ?? ''}|${s.designSystemHash ?? ''}|${s.prdContextHash ?? ''}|${s.createdAt ?? ''}`;
};

/** True when two records represent the same render (no merge needed). */
const isDuplicateRecord = (
    a: MockupVariantImageRecord,
    b: MockupVariantImageRecord,
): boolean =>
    a.generatedAt === b.generatedAt
    && a.dataUrl === b.dataUrl
    && signatureHash(a.sourceSignature) === signatureHash(b.sourceSignature);

/** Merge two variant history lists: union, dedupe by (image, generatedAt),
 * newest-first, capped. */
const mergeHistories = (
    ...lists: Array<MockupVariantImageHistoryEntry[] | undefined>
): MockupVariantImageHistoryEntry[] => {
    const seen = new Set<string>();
    const merged: MockupVariantImageHistoryEntry[] = [];
    for (const list of lists) {
        for (const entry of list ?? []) {
            const k = historyDedupeKey(entry);
            if (seen.has(k)) continue;
            seen.add(k);
            merged.push(entry);
        }
    }
    merged.sort((a, b) => (b.generatedAt ?? 0) - (a.generatedAt ?? 0));
    return merged.slice(0, MAX_VARIANT_SNAPSHOT_HISTORY);
};

/** Fold a record's own current image into a history entry, so it survives when
 * the OTHER record wins the "current" slot. */
const asHistoryEntry = (
    record: MockupVariantImageRecord,
): MockupVariantImageHistoryEntry | null => {
    if (!recordHasImage(record)) return null;
    return {
        dataUrl: record.dataUrl,
        quality: record.quality,
        prompt: record.prompt,
        coverageManifest: record.coverageManifest,
        sourceSignature: record.sourceSignature,
        generatedAt: record.generatedAt,
        reason: 'replaced',
    };
};

export interface VariantMergeOutcome {
    /** The record to persist (undefined = keep local unchanged, no write). */
    record?: MockupVariantImageRecord;
    /** 'restored' new, 'updated' snapshot won, 'kept_local' local won,
     * 'duplicate' identical, 'skipped' incoming unusable. */
    action: 'restored' | 'updated' | 'kept_local' | 'duplicate' | 'skipped';
    warning?: string;
}

/**
 * Conservative per-key merge. Pure so it can be unit-tested exhaustively.
 *   - no local        → restore incoming.
 *   - duplicate       → keep local, no write.
 *   - incoming newer  → incoming becomes current; local's image folds to history.
 *   - local newer     → keep local current; incoming's image folds to history.
 *   - unclear         → keep local current; add incoming image to history; warn.
 * A failed/imageless incoming never replaces a successful local image.
 */
export function mergeVariantRecords(
    local: MockupVariantImageRecord | undefined,
    incoming: MockupVariantImageRecord,
): VariantMergeOutcome {
    if (!local) return { record: incoming, action: 'restored' };

    if (isDuplicateRecord(local, incoming)) {
        return { action: 'duplicate' };
    }

    const localImg = recordHasImage(local);
    const incomingImg = recordHasImage(incoming);
    const isDefault = incoming.variantId === 'default';

    // Never let an imageless incoming clobber a real local image (only relevant
    // to non-default variants; default sidecars are metadata-only by design).
    if (!isDefault && localImg && !incomingImg) {
        return { action: 'skipped', warning: `Kept the local mockup variant for ${incoming.screenId} — the snapshot copy had no image.` };
    }

    const lt = local.generatedAt ?? 0;
    const it = incoming.generatedAt ?? 0;

    if (it > lt) {
        // Snapshot is newer → it wins the current slot; local folds to history.
        const localAsHist = asHistoryEntry(local);
        const record: MockupVariantImageRecord = {
            ...incoming,
            history: mergeHistories(
                incoming.history,
                localAsHist ? [localAsHist] : undefined,
                local.history,
            ),
        };
        if (record.history && record.history.length === 0) delete record.history;
        return { record, action: 'updated' };
    }

    if (lt > it) {
        // Local is newer → keep it; snapshot's image joins history.
        const incomingAsHist = asHistoryEntry(incoming);
        const record: MockupVariantImageRecord = {
            ...local,
            history: mergeHistories(
                local.history,
                incomingAsHist ? [incomingAsHist] : undefined,
                incoming.history,
            ),
        };
        if (record.history && record.history.length === 0) delete record.history;
        return { record, action: 'kept_local' };
    }

    // Equal (or missing) timestamps but different content → keep local, preserve
    // the snapshot render in history, and flag the ambiguity.
    const incomingAsHist = asHistoryEntry(incoming);
    const record: MockupVariantImageRecord = {
        ...local,
        history: mergeHistories(
            local.history,
            incomingAsHist ? [incomingAsHist] : undefined,
            incoming.history,
        ),
    };
    if (record.history && record.history.length === 0) delete record.history;
    return {
        record,
        action: 'kept_local',
        warning: `Kept the local mockup variant for ${incoming.screenId}; the snapshot copy was saved as history (timestamps were inconclusive).`,
    };
}

export interface RestoreVariantSnapshotOptions {
    /** Read the existing local records for one artifact version. */
    listExisting: (versionId: string) => Promise<MockupVariantImageRecord[]>;
    /** Persist one record (IndexedDB put). */
    put: (record: MockupVariantImageRecord) => Promise<void>;
    /** Called once with every record written, so the reactive cache can update. */
    notify?: (records: MockupVariantImageRecord[]) => void;
    maxHistory?: number;
}

export interface RestoreVariantSnapshotResult {
    restored: number;
    updated: number;
    keptLocal: number;
    duplicates: number;
    skipped: number;
    warnings: string[];
    writtenRecords: MockupVariantImageRecord[];
}

const emptyRestoreResult = (warnings: string[] = []): RestoreVariantSnapshotResult => ({
    restored: 0, updated: 0, keptLocal: 0, duplicates: 0, skipped: 0, warnings, writtenRecords: [],
});

/**
 * Hydrate a portable variant snapshot into the local store. Validates the
 * envelope first and NEVER throws on a malformed section — a bad snapshot yields
 * an empty result with a warning so the surrounding project restore is
 * unaffected. Per-record merges are conservative (see `mergeVariantRecords`).
 */
export async function restoreMockupVariantImageSnapshot(
    snapshot: MockupVariantImageSnapshot | undefined | null,
    options: RestoreVariantSnapshotOptions,
): Promise<RestoreVariantSnapshotResult> {
    if (!snapshot) return emptyRestoreResult();

    const validation = validateMockupVariantImageSnapshot(snapshot);
    if (!validation.valid) {
        return emptyRestoreResult(['Mockup variant images could not be restored (unrecognized format).']);
    }

    const maxHistory = options.maxHistory ?? MAX_VARIANT_SNAPSHOT_HISTORY;
    const result = emptyRestoreResult();
    result.warnings.push(...validation.warnings);

    // Group incoming records by version and load the local set once per version.
    const byVersion = new Map<string, MockupVariantImageSnapshotRecord[]>();
    for (const r of snapshot.records) {
        if (typeof r.versionId !== 'string') { result.skipped += 1; continue; }
        const list = byVersion.get(r.versionId) ?? [];
        list.push(r);
        byVersion.set(r.versionId, list);
    }

    for (const [versionId, incomingRecords] of byVersion) {
        let localList: MockupVariantImageRecord[] = [];
        try {
            localList = await options.listExisting(versionId);
        } catch {
            // Treat an unreadable local set as empty — we still restore, and a
            // later merge can't lose data it couldn't read.
            localList = [];
        }
        const localByKey = new Map(localList.map((r) => [r.key, r]));

        for (const snapRecord of incomingRecords) {
            const incoming = toStoreRecord(snapRecord, maxHistory);
            if (!incoming) {
                result.skipped += 1;
                continue;
            }
            const outcome = mergeVariantRecords(localByKey.get(incoming.key), incoming);
            if (outcome.warning) result.warnings.push(outcome.warning);
            switch (outcome.action) {
                case 'restored': result.restored += 1; break;
                case 'updated': result.updated += 1; break;
                case 'kept_local': result.keptLocal += 1; break;
                case 'duplicate': result.duplicates += 1; break;
                case 'skipped': result.skipped += 1; break;
            }
            if (outcome.record) {
                try {
                    await options.put(outcome.record);
                    localByKey.set(outcome.record.key, outcome.record);
                    result.writtenRecords.push(outcome.record);
                } catch {
                    result.warnings.push(`Failed to save a restored mockup variant for ${incoming.screenId}.`);
                }
            }
        }
    }

    if (options.notify && result.writtenRecords.length > 0) {
        options.notify(result.writtenRecords);
    }
    return result;
}

// --- Namespacing helper (for restore under a different project id) -----------

/**
 * Rewrite a variant snapshot's ids for restore under a DIFFERENT project id
 * (the demo path). Mirrors `namespaceSnapshotForRestore` in snapshotClient:
 * every artifact-version id in `idMap` is remapped and each record's composite
 * `key` is rebuilt from the remapped fields (variant image keys embed the
 * versionId). Pure. */
export function namespaceVariantSnapshot(
    snapshot: MockupVariantImageSnapshot,
    idMap: Map<string, string>,
    targetProjectId: string,
): MockupVariantImageSnapshot {
    if (idMap.size === 0) return snapshot;
    const remap = (id: string | undefined): string | undefined =>
        id && idMap.has(id) ? idMap.get(id) : id;

    const records = snapshot.records.map((record) => {
        const versionId = remap(record.versionId) ?? record.versionId;
        const generatedFrom = record.generatedFrom
            ? {
                prdVersionId: remap(record.generatedFrom.prdVersionId),
                screenVersionId: remap(record.generatedFrom.screenVersionId),
                designSystemVersionId: remap(record.generatedFrom.designSystemVersionId),
            }
            : undefined;
        return {
            ...record,
            projectId: targetProjectId,
            versionId,
            key: buildVariantImageKey(
                versionId,
                record.screenId,
                record.variantId,
                (VALID_QUALITIES.includes(record.quality) ? record.quality : 'low'),
            ),
            generatedFrom,
        };
    });
    return { ...snapshot, projectId: targetProjectId, records };
}
