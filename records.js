(() => {
  "use strict";

  const el = (id) => document.getElementById(id);

  const dom = {
    monthInput: el("monthInput"),
    refreshBtn: el("refreshBtn"),
    monthTotal: el("monthTotal"),
    monthCompleted: el("monthCompleted"),
    monthCoins: el("monthCoins"),
    monthHint: el("monthHint"),
    recordsList: el("recordsList"),
  };

  const pad2 = (n) => String(n).padStart(2, "0");

  const toCurrentMonthKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
  };

  const formatMonthText = (monthKey) => {
    const [y, m] = monthKey.split("-").map(Number);
    const dt = new Date(y, (m || 1) - 1, 1);
    return dt.toLocaleDateString(undefined, { year: "numeric", month: "long" });
  };

  const parseISODateToLocalMidnight = (isoDate) => {
    const [y, m, d] = isoDate.split("-").map((x) => Number(x));
    const dt = new Date(y, (m || 1) - 1, d || 1);
    dt.setHours(0, 0, 0, 0);
    return dt;
  };

  const formatHumanDate = (isoDate) => {
    const dt = parseISODateToLocalMidnight(isoDate);
    return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  };

  const monthKeyFromISODate = (isoDate) => String(isoDate).slice(0, 7);

  const escapeHtml = (s) =>
    String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  /**
   * @param {import("./db.js").VideoEntry} _entry
   */
  const groupByDateKey = (entries) => {
    /** @type {Record<string, any[]>} */
    const map = {};
    for (const e of entries) (map[e.date] ||= []).push(e);
    for (const k of Object.keys(map)) map[k].sort((a, b) => b.createdAt - a.createdAt);
    return map;
  };

  const computeMonthSummary = (entries) => {
    const total = entries.length;
    const completed = entries.filter((e) => e.completed).length;
    const coinsEarned = entries
      .filter((e) => e.completed)
      .reduce((sum, e) => sum + (Number.isFinite(e.coins) ? e.coins : 0), 0);
    return { total, completed, coinsEarned };
  };

  const render = async () => {
    const monthKey = dom.monthInput.value;
    if (!monthKey || monthKey.length !== 7) return;

    const entries = await window.VideoDB.getEntriesByMonth(monthKey);
    // Some older DB rows might be missing monthKey; ensure month filtering by date.
    const filtered = entries.filter((e) => monthKeyFromISODate(e.date) === monthKey);

    const sum = computeMonthSummary(filtered);

    dom.monthHint.textContent = `${formatMonthText(monthKey)} • 已完成 ${sum.completed}/${sum.total}`;
    dom.monthTotal.textContent = String(sum.total);
    dom.monthCompleted.textContent = String(sum.completed);
    dom.monthCoins.textContent = String(sum.coinsEarned);

    if (filtered.length === 0) {
      dom.recordsList.innerHTML = `
        <div class="empty">
          ${formatMonthText(monthKey)} 暂无记录。
          <div class="emptyHint">请先到仪表盘添加记录。</div>
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
      const pct = total === 0 ? 0 : Math.round((completed / total) * 100);

      parts.push(`
        <div class="dateGroup" data-date="${dateKey}">
          <div class="dateHeader">
            <div class="dateTitle">${formatHumanDate(dateKey)}</div>
            <div class="dateMeta">${completed}/${total} 已完成（${pct}%）</div>
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
            </div>
          </div>
        `);
      }

      parts.push(`</div></div>`);
    }

    dom.recordsList.innerHTML = parts.join("");
  };

  const init = async () => {
    dom.monthInput.value = toCurrentMonthKey();
    await window.VideoDB.ready();
    await render();

    dom.refreshBtn.addEventListener("click", async () => {
      try {
        await render();
      } catch (err) {
        alert(err?.message ? `加载失败：${err.message}` : "加载失败");
      }
    });
  };

  init().catch((err) => alert(err?.message ? `初始化失败：${err.message}` : "初始化失败"));
})();

