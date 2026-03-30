(() => {
  "use strict";

  // Persistence is implemented in `db.js` (IndexedDB).
  // This file only reads/writes via `window.VideoDB`.

  const el = (id) => document.getElementById(id);

  const dom = {
    monthText: el("monthText"),
    monthCompletion: el("monthCompletion"),
    weekCoins: el("weekCoins"),
    datesList: el("datesList"),

    addForm: el("addForm"),
    dateInput: el("dateInput"),
    nameInput: el("nameInput"),
    levelInput: el("levelInput"),
    coinsInput: el("coinsInput"),
    completedInput: el("completedInput"),
    resetBtn: el("resetBtn"),
    reuseBtn: el("reuseBtn"),
    showAllToggle: el("showAllToggle"),
  };

  const state = {
    showAllDates: false,
  };

  const pad2 = (n) => String(n).padStart(2, "0");
  const toISODate = (d) => {
    const year = d.getFullYear();
    const month = pad2(d.getMonth() + 1);
    const day = pad2(d.getDate());
    return `${year}-${month}-${day}`;
  };

  const monthKeyFromISODate = (isoDate) => isoDate.slice(0, 7); // YYYY-MM

  const parseISODateToLocalMidnight = (isoDate) => {
    // isoDate: YYYY-MM-DD
    const [y, m, d] = isoDate.split("-").map((x) => Number(x));
    const dt = new Date(y, (m || 1) - 1, d || 1);
    dt.setHours(0, 0, 0, 0);
    return dt;
  };

  const startOfWeekMonday = (date) => {
    // Monday = 0 ... Sunday = 6 mapping
    const day = date.getDay(); // 0..6 with 0=Sunday
    const diff = (day + 6) % 7; // 0 if Monday, 6 if Sunday
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - diff);
    return start;
  };

  const weekRange = (anchorDate) => {
    const start = startOfWeekMonday(anchorDate);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  };

  const formatHumanDate = (isoDate) => {
    const dt = parseISODateToLocalMidnight(isoDate);
    return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  };

  const formatMonthText = (monthKey) => {
    const [y, m] = monthKey.split("-").map(Number);
    const dt = new Date(y, (m || 1) - 1, 1);
    return dt.toLocaleDateString(undefined, { year: "numeric", month: "long" });
  };

  const uid = () =>
    (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `id_${Date.now()}_${Math.random()}`);

  /**
   * @typedef {Object} VideoEntry
   * @property {string} id
   * @property {string} date ISO string YYYY-MM-DD
   * @property {string} videoName
   * @property {string} accountLevel
   * @property {number} coins
   * @property {boolean} completed
   * @property {number} createdAt epoch ms
   */

  /** @param {VideoEntry} entry */
  const addEntry = async (entry) => window.VideoDB.addEntry(entry);

  /** @param {string} id */
  const deleteEntry = async (id) => window.VideoDB.deleteEntry(id);

  const clearAllEntries = async () => window.VideoDB.clearAll();

  const getTodayKeys = () => {
    const now = new Date();
    const todayISO = toISODate(now);
    const currentMonthKey = monthKeyFromISODate(todayISO);
    const { start, end } = weekRange(now);
    return { todayISO, currentMonthKey, weekStart: start, weekEnd: end };
  };

  const groupByDateKey = (entries) => {
    /** @type {Record<string, VideoEntry[]>} */
    const map = {};
    for (const e of entries) {
      (map[e.date] ||= []).push(e);
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => b.createdAt - a.createdAt);
    }
    return map;
  };

  const renderDates = (entries) => {
    const { currentMonthKey } = getTodayKeys();
    const filtered = state.showAllDates ? entries : entries.filter((e) => monthKeyFromISODate(e.date) === currentMonthKey);

    if (filtered.length === 0) {
      dom.datesList.innerHTML = `
        <div class="empty">
          本月暂无记录（${formatMonthText(currentMonthKey)}）。
          <div class="emptyHint">请在上方添加第一条视频剪辑记录。</div>
        </div>
      `;
      return;
    }

    const groups = groupByDateKey(filtered);
    const dateKeys = Object.keys(groups).sort((a, b) => (a > b ? -1 : a < b ? 1 : 0));

    const parts = [];
    for (const dateKey of dateKeys) {
      const list = groups[dateKey];
      const total = list.length;
      const completed = list.filter((x) => x.completed).length;
      const completedPct = total === 0 ? 0 : Math.round((completed / total) * 100);

      parts.push(`
        <div class="dateGroup" data-date="${dateKey}">
          <div class="dateHeader">
            <div class="dateTitle">${formatHumanDate(dateKey)}</div>
            <div class="dateMeta">${completed}/${total} 已完成（${completedPct}%）</div>
          </div>
          <div class="dateRows">
      `);

      for (const entry of list) {
        const statusClass = entry.completed ? "tag done" : "tag todo";
        const coins = Number.isFinite(entry.coins) ? entry.coins : 0;
        parts.push(`
          <div class="row">
            <div class="rowMain">
              <div class="videoName">${escapeHtml(entry.videoName)}</div>
              <div class="rowSub">
                <span class="pill">等级：${escapeHtml(entry.accountLevel || "-")}</span>
                <span class="pill">金币：${coins}</span>
              </div>
            </div>
            <div class="rowSide">
              <span class="${statusClass}">${entry.completed ? "已完成" : "未完成"}</span>
              <button class="ghost dangerBtn" type="button" data-action="delete" data-id="${entry.id}">删除</button>
            </div>
          </div>
        `);
      }

      parts.push(`</div></div>`);
    }

    dom.datesList.innerHTML = parts.join("");
  };

  const escapeHtml = (s) =>
    String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  const renderAll = async () => {
    const { currentMonthKey, weekStart, weekEnd } = getTodayKeys();

    // 本月统计只拉取本月数据，周度酬劳用区间查询（仅已完成）。
    const monthEntries = await window.VideoDB.getEntriesByMonth(currentMonthKey);
    const weekCoins = await window.VideoDB.getWeekCompletedCoins(weekStart, weekEnd);

    const monthTotal = monthEntries.length;
    const monthCompleted = monthEntries.filter((e) => e.completed).length;

    // 列表展示：如果勾选“显示所有日期”，就拉取全库；否则只展示本月。
    const listEntries = state.showAllDates ? await window.VideoDB.getAllEntries() : monthEntries;

    dom.monthText.textContent = formatMonthText(currentMonthKey);
    dom.monthCompletion.textContent = `本月已完成 ${monthCompleted}/${monthTotal}`;
    dom.weekCoins.textContent = String(weekCoins);

    renderDates(listEntries);
  };

  const setDefaultFormValues = () => {
    dom.dateInput.value = toISODate(new Date());
    dom.coinsInput.value = "0";
    dom.levelInput.value = "";
    dom.completedInput.value = "false";
  };

  const readForm = () => {
    const date = dom.dateInput.value;
    const videoName = dom.nameInput.value.trim();
    const accountLevel = dom.levelInput.value.trim();
    const coins = Number(dom.coinsInput.value);
    const completed = dom.completedInput.value === "true";

    if (!date) throw new Error("请选择日期。");
    if (!videoName) throw new Error("请输入视频名称。");
    if (!Number.isFinite(coins) || coins < 0) throw new Error("金币必须 >= 0。");

    return { date, videoName, accountLevel, coins, completed };
  };

  const init = async () => {
    setDefaultFormValues();
    await window.VideoDB.ready();
    await renderAll();

    dom.showAllToggle.addEventListener("change", () => {
      state.showAllDates = Boolean(dom.showAllToggle.checked);
      void renderAll();
    });

    dom.addForm.addEventListener("submit", async (e) => {
      e.preventDefault();

      try {
        const { date, videoName, accountLevel, coins, completed } = readForm();
        /** @type {VideoEntry} */
        const entry = {
          id: uid(),
          date,
          videoName,
          accountLevel,
          coins,
          completed,
          createdAt: Date.now(),
        };
        await addEntry(entry);
        dom.addForm.reset();
        setDefaultFormValues();
        await renderAll();
      } catch (err) {
        alert(err?.message ? `添加失败：${err.message}` : "添加失败");
      }
    });

    dom.datesList.addEventListener("click", async (e) => {
      const btn = e.target?.closest?.("button[data-action='delete']");
      if (!btn) return;
      const id = btn.getAttribute("data-id");
      if (!id) return;

      const ok = confirm("确认删除此条记录？");
      if (!ok) return;

      try {
        await deleteEntry(id);
        await renderAll();
      } catch (err) {
        alert(err?.message ? `删除失败：${err.message}` : "删除失败");
      }
    });

    dom.resetBtn.addEventListener("click", async () => {
      const ok = confirm("确认清空所有已保存记录？（此操作会删除数据库中的全部条目）");
      if (!ok) return;
      try {
        await clearAllEntries();
        await renderAll();
      } catch (err) {
        alert(err?.message ? `清空失败：${err.message}` : "清空失败");
      }
    });

    dom.reuseBtn.addEventListener("click", async () => {
      try {
        const entries = await window.VideoDB.getAllEntries();
        const last = entries?.[0];
        if (!last) {
          alert("暂无可复用的记录。");
          return;
        }

        dom.dateInput.value = String(last.date || "");
        dom.nameInput.value = String(last.videoName || "");
        dom.levelInput.value = /^L[1-8]$/.test(String(last.accountLevel || "")) ? String(last.accountLevel) : "";
        dom.coinsInput.value = String(Number.isFinite(Number(last.coins)) ? last.coins : 0);
        dom.completedInput.value = Boolean(last.completed) ? "true" : "false";

        dom.nameInput.focus();
        dom.nameInput.select();
      } catch (err) {
        alert(err?.message ? `读取失败：${err.message}` : "读取失败");
      }
    });
  };

  init().catch((err) => alert(err?.message ? `初始化失败：${err.message}` : "初始化失败"));
})();

