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
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function request(storeName, mode, operation) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const result = operation(transaction.objectStore(storeName));
    result.onsuccess = () => resolve(result.result);
    result.onerror = () => reject(result.error);
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
      transaction.objectStore('sessions').delete(sessionId);
      rows.forEach(row => transaction.objectStore('chunks').delete([sessionId, row.index]));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
  },
};
