/*
 * Crash-safe mobile recording storage.
 * Adapted from Tributary's MIT-licensed recorder invariants:
 * persist before upload; delete only after a confirmed server ACK.
 */

const DB_NAME = 'ai616-recorder';
const DB_VERSION = 1;
let dbPromise;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    const timer = setTimeout(() => reject(new Error('Local recording storage timed out')), 5000);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('sessions')) {
        db.createObjectStore('sessions', { keyPath: 'sessionId' });
      }
      if (!db.objectStoreNames.contains('chunks')) {
        const store = db.createObjectStore('chunks', { keyPath: ['sessionId', 'index'] });
        store.createIndex('bySession', 'sessionId');
      }
    };
    request.onsuccess = () => { clearTimeout(timer); resolve(request.result); };
    request.onerror = () => { clearTimeout(timer); reject(request.error); };
  }).catch(error => { dbPromise = null; throw error; });
  return dbPromise;
}

async function request(storeName, mode, operation) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const result = operation(transaction.objectStore(storeName));
    const timer = setTimeout(() => {
      transaction.abort();
      reject(new Error('Local recording storage timed out'));
    }, 5000);
    transaction.oncomplete = () => { clearTimeout(timer); resolve(result.result); };
    transaction.onabort = transaction.onerror = () => { clearTimeout(timer); reject(transaction.error || new Error('Local recording storage failed')); };
  });
}

export const resilientRecordingStore = {
  putSession(meta) {
    return request('sessions', 'readwrite', store => store.put(meta));
  },
  async updateSession(sessionId, patch) {
    const current = await request('sessions', 'readonly', store => store.get(sessionId));
    if (!current) return null;
    const updated = { ...current, ...patch };
    await request('sessions', 'readwrite', store => store.put(updated));
    return updated;
  },
  listSessions() {
    return request('sessions', 'readonly', store => store.getAll());
  },
  putChunk(sessionId, index, blob) {
    return request('chunks', 'readwrite', store => store.put({ sessionId, index, blob, size: blob.size }));
  },
  async listChunks(sessionId) {
    const rows = await request('chunks', 'readonly', store => store.index('bySession').getAll(sessionId));
    return rows.sort((left, right) => left.index - right.index);
  },
  deleteChunk(sessionId, index) {
    return request('chunks', 'readwrite', store => store.delete([sessionId, index]));
  },
  async deleteSession(sessionId) {
    const rows = await this.listChunks(sessionId);
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(['sessions', 'chunks'], 'readwrite');
      const timer = setTimeout(() => {
        transaction.abort();
        reject(new Error('Local recording cleanup timed out'));
      }, 5000);
      transaction.objectStore('sessions').delete(sessionId);
      rows.forEach(row => transaction.objectStore('chunks').delete([sessionId, row.index]));
      transaction.oncomplete = () => { clearTimeout(timer); resolve(); };
      transaction.onabort = transaction.onerror = () => { clearTimeout(timer); reject(transaction.error || new Error('Local recording cleanup failed')); };
    });
  },
};
