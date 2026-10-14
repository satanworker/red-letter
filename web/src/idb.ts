// One IndexedDB database for browser-side copies: open docs ("docs") and GitHub responses ("http").
// Everything here is a copy; GitHub stays the source of truth. So no failure is fatal: without IndexedDB
// (private windows, quota, a broken database) every read misses and every write is dropped.
// Safari drops connections (backgrounded tab, storage process restart): reopen once and retry.
type Store = "docs" | "http";
let db: Promise<IDBDatabase | null> | undefined;

function open(): Promise<IDBDatabase | null> {
  if (db) return db;
  const { promise, resolve } = Promise.withResolvers<IDBDatabase | null>();
  db = promise;
  try {
    const req = indexedDB.open("red-letter", 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore("docs");
      req.result.createObjectStore("http");
    };
    req.onsuccess = () => {
      const d = req.result;
      d.onclose = () => (db = undefined); // closed by the browser: the next call reopens
      d.onversionchange = () => {
        d.close();
        db = undefined;
      };
      resolve(d);
    };
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  } catch {
    resolve(null); // no indexedDB at all
  }
  return promise;
}

async function run<T>(store: Store, mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>, retry = true): Promise<T | undefined> {
  const d = await open();
  if (!d) return undefined;
  try {
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    const tx = d.transaction(store, mode);
    const req = op(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error ?? req.error);
    tx.onabort = () => reject(tx.error ?? req.error);
    return await promise;
  } catch (e) {
    // a dead connection throws InvalidStateError from transaction(), or fails the transaction with UnknownError
    if (retry && e instanceof DOMException && (e.name === "InvalidStateError" || e.name === "UnknownError")) {
      db = undefined;
      return run(store, mode, op, false);
    }
    console.warn("indexeddb:", e);
    return undefined;
  }
}

export const idbGet = <T>(store: Store, key: string): Promise<T | undefined> => run<T>(store, "readonly", (s) => s.get(key));
export const idbPut = (store: Store, key: string, value: unknown) => run(store, "readwrite", (s) => s.put(value, key));
export const idbDelete = (store: Store, key: string) => run(store, "readwrite", (s) => s.delete(key));
export const idbClear = (store: Store) => run(store, "readwrite", (s) => s.clear());
