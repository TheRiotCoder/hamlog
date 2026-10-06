/* HamLog – tiny promise wrapper around IndexedDB. Stores: qsos (keyPath id), meta (keyPath key). */
(function (root) {
  'use strict';
  const DB_NAME = 'hamlog';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in root)) { reject(new Error('IndexedDB is not available in this browser')); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('qsos')) {
          const s = db.createObjectStore('qsos', { keyPath: 'id' });
          s.createIndex('call', 'call', { unique: false });
          s.createIndex('qso_date', 'qso_date', { unique: false });
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); };
        resolve(db);
      };
      req.onerror = () => reject(req.error || new Error('Could not open database'));
      req.onblocked = () => reject(new Error('Database upgrade blocked – close other HamLog tabs'));
    });
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
  }

  function tx(storeName, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const store = t.objectStore(storeName);
      let result;
      const req = fn(store);
      if (req && typeof req === 'object' && 'onsuccess' in req) req.onsuccess = () => { result = req.result; };
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error || new Error('Transaction failed'));
      t.onabort = () => reject(t.error || new Error('Transaction aborted'));
    }));
  }

  root.HamDB = {
    open,
    getAll: () => tx('qsos', 'readonly', s => s.getAll()).then(r => r || []),
    put: q => tx('qsos', 'readwrite', s => s.put(q)),
    putMany: list => tx('qsos', 'readwrite', s => { for (const q of list) s.put(q); }),
    del: id => tx('qsos', 'readwrite', s => s.delete(id)),
    clear: () => tx('qsos', 'readwrite', s => s.clear()),
    getMeta: key => tx('meta', 'readonly', s => s.get(key)).then(r => (r ? r.value : undefined)),
    setMeta: (key, value) => tx('meta', 'readwrite', s => s.put({ key, value }))
  };
})(typeof self !== 'undefined' ? self : this);
