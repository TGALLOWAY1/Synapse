import { describe, expect, it } from 'vitest';
import { deriveDefaultImagePresence } from '../mockupImagePresence';

describe('deriveDefaultImagePresence (SYN-003)', () => {
    it("returns 'present' when an AI mockup record exists, short-circuiting an un-settled other store", () => {
        expect(deriveDefaultImagePresence({
            mockupImagesLoaded: true,
            hasMockupRecord: true,
            // The uploaded store hasn't hydrated yet — an existing image still wins.
            inventoryHydrated: false,
            hasUploadedRecord: false,
        })).toBe('present');
    });

    it("returns 'present' when an uploaded record exists, short-circuiting an un-settled mockup store", () => {
        expect(deriveDefaultImagePresence({
            mockupImagesLoaded: false,
            hasMockupRecord: false,
            inventoryHydrated: true,
            hasUploadedRecord: true,
        })).toBe('present');
    });

    it("returns 'absent' only when BOTH stores are settled and neither holds an image", () => {
        expect(deriveDefaultImagePresence({
            mockupImagesLoaded: true,
            hasMockupRecord: false,
            inventoryHydrated: true,
            hasUploadedRecord: false,
        })).toBe('absent');
    });

    it("returns 'checking' while either store is still hydrating with no record found", () => {
        expect(deriveDefaultImagePresence({
            mockupImagesLoaded: false,
            hasMockupRecord: false,
            inventoryHydrated: true,
            hasUploadedRecord: false,
        })).toBe('checking');
        expect(deriveDefaultImagePresence({
            mockupImagesLoaded: true,
            hasMockupRecord: false,
            inventoryHydrated: false,
            hasUploadedRecord: false,
        })).toBe('checking');
        expect(deriveDefaultImagePresence({
            mockupImagesLoaded: false,
            hasMockupRecord: false,
            inventoryHydrated: false,
            hasUploadedRecord: false,
        })).toBe('checking');
    });
});
