import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRecordStore } from '../idbRecordStore';

// jsdom (this repo's test environment) does not implement IndexedDB, so every
// `createRecordStore` op here exercises the in-memory fallback path — the
// same path the three real image stores fall back to in private browsing.
// This is the shared skeleton that used to be duplicated three times; none of
// the three modules had a direct (non-mocked) test of this behavior before.

interface TestRecord {
    key: string;
    groupId: string;
    value: string;
}

const makeStore = () =>
    createRecordStore<TestRecord>({
        dbName: 'test-db',
        storeName: 'test-store',
        keyPath: 'key',
        indexField: 'groupId',
        logLabel: 'test-store',
        lossNote: 'Test records will be lost on reload.',
    });

describe('idbRecordStore createRecordStore (in-memory fallback path)', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('put/get round-trips a record by key', async () => {
        const store = makeStore();
        const record: TestRecord = { key: 'a:1', groupId: 'a', value: 'hello' };

        await store.put(record);
        await expect(store.get('a:1')).resolves.toEqual(record);
        await expect(store.get('missing')).resolves.toBeUndefined();
    });

    it('listByIndex returns only records matching the index value', async () => {
        const store = makeStore();
        await store.put({ key: 'a:1', groupId: 'a', value: 'one' });
        await store.put({ key: 'a:2', groupId: 'a', value: 'two' });
        await store.put({ key: 'b:1', groupId: 'b', value: 'three' });

        const groupA = await store.listByIndex('a');
        expect(groupA).toHaveLength(2);
        expect(groupA.map(r => r.key).sort()).toEqual(['a:1', 'a:2']);

        const groupB = await store.listByIndex('b');
        expect(groupB).toHaveLength(1);
        expect(groupB[0].value).toBe('three');

        expect(await store.listByIndex('c')).toEqual([]);
    });

    it('deleteByIndex removes only records matching the index value', async () => {
        const store = makeStore();
        await store.put({ key: 'a:1', groupId: 'a', value: 'one' });
        await store.put({ key: 'a:2', groupId: 'a', value: 'two' });
        await store.put({ key: 'b:1', groupId: 'b', value: 'three' });

        await store.deleteByIndex('a');

        expect(await store.listByIndex('a')).toEqual([]);
        expect(await store.listByIndex('b')).toHaveLength(1);
    });

    it('getMemoryFallback exposes the same records the ops mutate', async () => {
        const store = makeStore();
        const record: TestRecord = { key: 'a:1', groupId: 'a', value: 'hello' };
        await store.put(record);

        expect(store.getMemoryFallback().get('a:1')).toEqual(record);
    });

    it('iterateIndex rejects when IndexedDB is unavailable, for the caller to handle its own fallback', async () => {
        const store = makeStore();
        await expect(
            store.iterateIndex('readwrite', 'a', () => {}),
        ).rejects.toThrow();
    });

    it('warns once (not repeatedly) when falling back to memory', async () => {
        const store = makeStore();
        await store.put({ key: 'a:1', groupId: 'a', value: 'one' });
        await store.put({ key: 'a:2', groupId: 'a', value: 'two' });
        await store.get('a:1');

        const fallbackWarnings = warnSpy.mock.calls.filter(
            (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('[test-store]'),
        );
        expect(fallbackWarnings).toHaveLength(1);
        expect(fallbackWarnings[0][0]).toContain('Test records will be lost on reload.');
    });

    it('two independently-created stores never share records (mirrors separate DB/store names)', async () => {
        const storeOne = makeStore();
        const storeTwo = makeStore();

        await storeOne.put({ key: 'a:1', groupId: 'a', value: 'from-one' });

        expect(await storeTwo.get('a:1')).toBeUndefined();
    });
});
