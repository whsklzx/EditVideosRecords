(() => {
  "use strict";

  const DB_NAME = "videoEditTrackerDB";
  const DB_VERSION = 1;
  const STORE_NAME = "entries";

  const uid = () =>
    (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `id_${Date.now()}_${Math.random()}`);

  const pad2 = (n) => String(n).padStart(2, "0");
  const toISODateLocal = (d) => {
    const year = d.getFullYear();
    const month = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    return `${year}-${month}-${day}`;
  };

  const monthKeyFromISODate = (isoDate) => String(isoDate).slice(0, 7); // YYYY-MM

  const parseISODateToLocalMidnight = (isoDate) => {
    // isoDate: YYYY-MM-DD
    const [y, m, d] = String(isoDate).split("-").map((x) => Number(x));
    const dt = new Date(y, (m || 1) - 1, d || 1);
    dt.setHours(0, 0, 0, 0);
    return dt;
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
          // monthKey: YYYY-MM
          store.createIndex("monthKey", "monthKey", { unique: false });
          // date: YYYY-MM-DD
          store.createIndex("date", "date", { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("无法打开 IndexedDB。"));
    });

  /** @type {Promise<IDBDatabase> | null} */
  let dbPromise = null;
  const getDB = () => {
    if (!dbPromise) dbPromise = openDB();
    return dbPromise;
  };

  /**
   * @param {any} entry
   * @returns {{id: string, date: string, monthKey: string, videoName: string, accountLevel: string, coins: number, completed: boolean, createdAt: number}}
   */
  const normalizeEntry = (entry) => {
    const date = String(entry?.date ?? "");
    const monthKey = String(entry?.monthKey ?? monthKeyFromISODate(date));
    const createdAt = Number.isFinite(Number(entry?.createdAt)) ? Number(entry.createdAt) : Date.now();
    const coins = Number.isFinite(Number(entry?.coins)) ? Number(entry.coins) : 0;
    const completed = Boolean(entry?.completed);
    return {
      id: String(entry?.id ?? uid()),
      date,
      monthKey,
      videoName: String(entry?.videoName ?? ""),
      accountLevel: String(entry?.accountLevel ?? ""),
      coins,
      completed,
      createdAt,
    };
  };

  const addEntry = async (entry) => {
    const db = await getDB();
    const normalized = normalizeEntry(entry);

    if (!normalized.date) throw new Error("缺少日期。");
    if (!normalized.videoName) throw new Error("请输入视频名称。");
    normalized.monthKey = monthKeyFromISODate(normalized.date);

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
        entries.sort(
          (a, b) => String(b.date).localeCompare(String(a.date)) || (b.createdAt ?? 0) - (a.createdAt ?? 0),
        );
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
        entries.sort(
          (a, b) => String(b.date).localeCompare(String(a.date)) || (b.createdAt ?? 0) - (a.createdAt ?? 0),
        );
        resolve(entries);
      };
      req.onerror = () => reject(req.error || new Error("读取月份记录失败。"));
    });
  };

  const getWeekCompletedCoins = async (weekStartDate, weekEndDate) => {
    const db = await getDB();

    const startISO = toISODateLocal(weekStartDate);
    const endISO = toISODateLocal(weekEndDate);

    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const index = store.index("date");
    const range = IDBKeyRange.bound(startISO, endISO);
    const req = index.getAll(range);

    const entries = await new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(Array.isArray(req.result) ? req.result : []);
      req.onerror = () => reject(req.error || new Error("读取周度记录失败。"));
    });

    let sum = 0;
    for (const e of entries) {
      if (!e.completed) continue;
      sum += Number.isFinite(Number(e.coins)) ? Number(e.coins) : 0;
    }
    return sum;
  };

  window.VideoDB = {
    ready: getDB,
    addEntry,
    deleteEntry,
    clearAll,
    getAllEntries,
    getEntriesByMonth,
    getWeekCompletedCoins,
  };
})();

