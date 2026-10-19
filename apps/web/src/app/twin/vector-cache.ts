/**
 * Vector cache, keyed by the bundle hash.
 *
 * Embedding 38 chunks takes seconds, not milliseconds, so a visitor who reloads
 * should not pay it again. The cache is invalidated wholesale when the corpus
 * changes: `bundleHash` is part of the key, so a new bundle simply misses and
 * the old entry is dropped.
 */

export interface VectorCache {
  read(bundleHash: string): Promise<Map<string, Float32Array> | null>;
  write(bundleHash: string, vectors: Map<string, Float32Array>): Promise<void>;
}

const DB_NAME = 'twin-vectors';
const STORE = 'corpora';
const VERSION = 1;

interface StoredCorpus {
  readonly bundleHash: string;
  readonly vectors: Record<string, number[]>;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: 'bundleHash' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('indexedDB.open failed'));
  });
}

export class IndexedDbVectorCache implements VectorCache {
  async read(bundleHash: string): Promise<Map<string, Float32Array> | null> {
    let database: IDBDatabase | null = null;
    try {
      database = await openDatabase();
      const stored = await new Promise<StoredCorpus | undefined>((resolve, reject) => {
        const request = database
          ?.transaction(STORE, 'readonly')
          .objectStore(STORE)
          .get(bundleHash) as IDBRequest<StoredCorpus | undefined>;
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('read failed'));
      });
      if (stored === undefined) return null;

      const vectors = new Map<string, Float32Array>();
      for (const [chunkId, values] of Object.entries(stored.vectors)) {
        vectors.set(chunkId, Float32Array.from(values));
      }
      return vectors;
    } catch {
      // A cache that cannot be read is a cache miss, never a broken page.
      return null;
    } finally {
      database?.close();
    }
  }

  async write(bundleHash: string, vectors: Map<string, Float32Array>): Promise<void> {
    const serialised: Record<string, number[]> = {};
    for (const [chunkId, values] of vectors) {
      serialised[chunkId] = Array.from(values);
    }

    let database: IDBDatabase | null = null;
    try {
      database = await openDatabase();
      await new Promise<void>((resolve, reject) => {
        const transaction = database?.transaction(STORE, 'readwrite');
        transaction?.objectStore(STORE).put({ bundleHash, vectors: serialised } satisfies StoredCorpus);
        if (transaction === undefined) {
          resolve();
          return;
        }
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error ?? new Error('write failed'));
      });
    } catch {
      // Storage may be full or blocked in private mode; the page keeps working.
    } finally {
      database?.close();
    }
  }
}

/** In-memory cache, used by tests and by a browser where IndexedDB is blocked. */
export class MemoryVectorCache implements VectorCache {
  private entry: { hash: string; vectors: Map<string, Float32Array> } | null = null;

  async read(bundleHash: string): Promise<Map<string, Float32Array> | null> {
    return this.entry?.hash === bundleHash ? this.entry.vectors : null;
  }

  async write(bundleHash: string, vectors: Map<string, Float32Array>): Promise<void> {
    this.entry = { hash: bundleHash, vectors };
  }
}
