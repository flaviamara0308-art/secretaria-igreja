/**
 * IndexedDB Offline Database Engine for SECRETARIA DA IGREJA
 * Provides local storage for members, departments, events, users, audit logs,
 * backups, offline sync queue and conflict records.
 */

const DB_NAME = 'SecretariaIgreja_OfflineDB';
const DB_VERSION = 1;

export type StoreName = 
  | 'members' 
  | 'departments' 
  | 'events' 
  | 'users' 
  | 'auditLogs' 
  | 'backups' 
  | 'syncQueue' 
  | 'conflicts' 
  | 'sessionConfig';

let dbInstance: IDBDatabase | null = null;

export interface IIndexedDBService {
  getDB(): Promise<IDBDatabase>;
  getAll<T>(storeName: StoreName, churchId?: string): Promise<T[]>;
  getById<T>(storeName: StoreName, id: string): Promise<T | null>;
  put<T>(storeName: StoreName, item: T): Promise<void>;
  putMany<T>(storeName: StoreName, items: T[]): Promise<void>;
  delete(storeName: StoreName, id: string): Promise<void>;
  clearStore(storeName: StoreName): Promise<void>;
  clearAllStores(): Promise<void>;
}

export const IndexedDBService: IIndexedDBService = {
  async getDB(): Promise<IDBDatabase> {
    if (dbInstance) return dbInstance;

    return new Promise((resolve, reject) => {
      if (typeof window === 'undefined' || !window.indexedDB) {
        reject(new Error('IndexedDB não suportado no ambiente atual.'));
        return;
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Members store
        if (!db.objectStoreNames.contains('members')) {
          const store = db.createObjectStore('members', { keyPath: 'id' });
          store.createIndex('churchId', 'churchId', { unique: false });
          store.createIndex('status', 'status', { unique: false });
        }

        // Departments store
        if (!db.objectStoreNames.contains('departments')) {
          const store = db.createObjectStore('departments', { keyPath: 'id' });
          store.createIndex('churchId', 'churchId', { unique: false });
        }

        // Events store
        if (!db.objectStoreNames.contains('events')) {
          const store = db.createObjectStore('events', { keyPath: 'id' });
          store.createIndex('churchId', 'churchId', { unique: false });
        }

        // Users store
        if (!db.objectStoreNames.contains('users')) {
          const store = db.createObjectStore('users', { keyPath: 'id' });
          store.createIndex('churchId', 'churchId', { unique: false });
        }

        // Audit Logs store
        if (!db.objectStoreNames.contains('auditLogs')) {
          const store = db.createObjectStore('auditLogs', { keyPath: 'id' });
          store.createIndex('churchId', 'churchId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Backups store
        if (!db.objectStoreNames.contains('backups')) {
          const store = db.createObjectStore('backups', { keyPath: 'id' });
          store.createIndex('churchId', 'churchId', { unique: false });
        }

        // Sync Queue store
        if (!db.objectStoreNames.contains('syncQueue')) {
          const store = db.createObjectStore('syncQueue', { keyPath: 'id' });
          store.createIndex('churchId', 'churchId', { unique: false });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // Conflicts store
        if (!db.objectStoreNames.contains('conflicts')) {
          const store = db.createObjectStore('conflicts', { keyPath: 'id' });
          store.createIndex('churchId', 'churchId', { unique: false });
          store.createIndex('status', 'status', { unique: false });
        }

        // Session Config store
        if (!db.objectStoreNames.contains('sessionConfig')) {
          db.createObjectStore('sessionConfig', { keyPath: 'key' });
        }
      };

      request.onsuccess = (event) => {
        dbInstance = (event.target as IDBOpenDBRequest).result;
        resolve(dbInstance);
      };

      request.onerror = (event) => {
        reject((event.target as IDBOpenDBRequest).error);
      };
    });
  },

  async getAll<T>(storeName: StoreName, churchId?: string): Promise<T[]> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);

        if (churchId && store.indexNames.contains('churchId')) {
          const index = store.index('churchId');
          const request = index.getAll(churchId);
          request.onsuccess = () => resolve(request.result as T[]);
          request.onerror = () => reject(request.error);
        } else {
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result as T[]);
          request.onerror = () => reject(request.error);
        }
      });
    } catch (e) {
      console.warn(`IndexedDB getAll error on store ${storeName}:`, e);
      return [];
    }
  },

  async getById<T>(storeName: StoreName, id: string): Promise<T | null> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const store = tx.objectStore(storeName);
        const request = store.get(id);
        request.onsuccess = () => resolve((request.result as T) || null);
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.warn(`IndexedDB getById error on store ${storeName}:`, e);
      return null;
    }
  },

  async put<T>(storeName: StoreName, item: T): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const request = store.put(item);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.warn(`IndexedDB put error on store ${storeName}:`, e);
    }
  },

  async putMany<T>(storeName: StoreName, items: T[]): Promise<void> {
    if (items.length === 0) return;
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        items.forEach(item => store.put(item));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      console.warn(`IndexedDB putMany error on store ${storeName}:`, e);
    }
  },

  async delete(storeName: StoreName, id: string): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.warn(`IndexedDB delete error on store ${storeName}:`, e);
    }
  },

  async clearStore(storeName: StoreName): Promise<void> {
    try {
      const db = await this.getDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch (e) {
      console.warn(`IndexedDB clearStore error on store ${storeName}:`, e);
    }
  },

  async clearAllStores(): Promise<void> {
    const stores: StoreName[] = [
      'members',
      'departments',
      'events',
      'users',
      'auditLogs',
      'backups',
      'syncQueue',
      'conflicts',
      'sessionConfig',
    ];
    for (const store of stores) {
      await this.clearStore(store);
    }
  },
};
