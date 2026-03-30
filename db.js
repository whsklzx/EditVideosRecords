(() => {
  "use strict";

  const DB_NAME = "videoEditTrackerDB";
  const DB_VERSION = 1;
  const STORE_NAME = "entries";
  const STORAGE_KEY_LEGACY = "videoEditTracker:v1";
  const MIGRATED_FLAG_KEY = "videoEditTracker:migratedToIndexedDB:v1";

  const normalizeEntry = (x) => {
    const createdAt = Number.isFinite(Number(x?.createdAt)) ? Number(x.createdAt) : Date.now();
    const date = String(x?.date ?? "");
    const monthKey = String(x?.monthKey ?? (date.length >= 7 ? date.slice(0, 7) : ""));

    return {
      id: String(x?.id ?? `id_${Date.now()}_${Math.random()}`),
      date,
      monthKey,
      videoName: String(x?.videoName ?? ""),
      accountLevel: String(x?.accountLevel ?? ""),
      coins: Number.isFinite(Number(x?.coins)) ? Number(x.coins) : 0,
      completed: Boolean(x?.completed),
      createdAt,
    };
  };

  const openDB = () =>
    new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("此浏览器不支持 IndexedDB。"));
        return;
      }

      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("monthKey", "monthKey", { unique: false });
          store.createIndex("date", "date", { unique: false });
          // createdAt isn't indexed because we typically query by month/date.
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () =>
        reject(req.error || new Error("无法打开 IndexedDB。"));
    });

  /** @type {Promise<IDBDatabase> | null} */
  let dbPromise = null;

  const getDB = () => {
    if (!dbPromise) dbPromise = openDB();
    return dbPromise;
  };

  const safeLocalGet = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const safeLocalSet = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // ignore
    }
  };

  const safeLocalRemove = (key) => {
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  };

  const migrateFromLocalStorageIfNeeded = async (db) => {
    if (safeLocalGet(MIGRATED_FLAG_KEY) === "true") return;

    const raw = safeLocalGet(STORAGE_KEY_LEGACY);
    if (!raw) {
      safeLocalSet(MIGRATED_FLAG_KEY, "true");
      return;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      safeLocalSet(MIGRATED_FLAG_KEY, "true");
      return;
    }

    if (!Array.isArray(parsed) || parsed.length === 0) {
      safeLocalSet(MIGRATED_FLAG_KEY, "true");
      return;
    }

    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    for (const item of parsed) {
      const normalized = normalizeEntry({
        ...item,
        // Legacy entries don't have monthKey; compute from date if present.
        monthKey: String(item?.date ?? "").slice(0, 7),
      });
      if (!normalized.videoName || !normalized.date || normalized.monthKey.length !== 7) continue;
      store.put(normalized);
    }

    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("数据迁移失败。"));
      tx.onabort = () => reject(tx.error || new Error("数据迁移被中断。"));
    });

    // Keep flag only; we can also remove legacy data to avoid double import.
    safeLocalRemove(STORAGE_KEY_LEGACY);
    safeLocalSet(MIGRATED_FLAG_KEY, "true");
  };

  const ready = async () => {
    const db = await getDB();
    await migrateFromLocalStorageIfNeeded(db);
    return db;
  };

  const addEntry = async (entry) => {
    const db = await getDB();
    const normalized = normalizeEntry(entry);
    if (!normalized.videoName || !normalized.date) throw new Error("Missing date or videoName.");
    if (normalized.monthKey.length !== 7) normalized.monthKey = normalized.date.slice(0, 7);

    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put(normalized);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("写入失败。"));
      tx.onabort = () => reject(tx.error || new Error("写入被中断。"));
    });

    return normalized;
  };

  const deleteEntry = async (id) => {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(String(id));
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("删除失败。"));
      tx.onabort = () => reject(tx.error || new Error("删除被中断。"));
    });
  };

  const clearAll = async () => {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.clear();
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error || new Error("清空失败。"));
      tx.onabort = () => reject(tx.error || new Error("清空被中断。"));
    });
  };

  const getAllEntries = async () => {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    return await new Promise((resolve, reject) => {
      req.onsuccess = () => {
        const entries = Array.isArray(req.result) ? req.result : [];
        entries.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.createdAt - a.createdAt);
        resolve(entries);
      };
      req.onerror = () => reject(req.error || new Error("读取记录失败。"));
    });
  };

  const getEntriesByMonth = async (monthKey) => {
    const db = await getDB();
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("monthKey");
    const key = String(monthKey).slice(0, 7);

    const req = index.getAll(key);
    return await new Promise((resolve, reject) => {
      req.onsuccess = () => {
        const entries = Array.isArray(req.result) ? req.result : [];
        entries.sort((a, b) => String(b.date).localeCompare(String(a.date)) || b.createdAt - a.createdAt);
        resolve(entries);
      };
      req.onerror = () => reject(req.error || new Error("读取月份记录失败。"));
    });
  };

  window.VideoDB = {
    ready,
    addEntry,
    deleteEntry,
    clearAll,
    getAllEntries,
    getEntriesByMonth,
  };
})();

