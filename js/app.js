// Solo Leveling（Rex 的任務面板）：畫面與操作邏輯。資料讀寫都交給 store.js。
import { createStore, isAuthError } from "./store.js?v=2026-10-14.1";
import { DEFAULT_CONFIG } from "./demo-data.js?v=2026-10-14.1";
import { VERSION } from "./version.js?v=2026-10-14.1";

/* ================= constants ================= */
const AREAS = {
  career: { name: "職涯", code: "INT", c: "var(--a-career)" },
  invest: { name: "投資", code: "WIS", c: "var(--a-invest)" },
  life: { name: "生活", code: "SPR", c: "var(--a-life)" },
  body: { name: "身體", code: "STR", c: "var(--a-body)" }
};
const AREA_ORDER = ["career", "invest", "life", "body"];
const DOW = ["日", "一", "二", "三", "四", "五", "六"];
const STEP_XP = { 25: 20, 50: 40, 90: 70 };
const DAY_ROLLOVER_HOURS = 4;
const STALE_DAYS = 7;
const EXTEND_MIN = 25;
// 每日覆盤「卡住的原因」。代碼會存進資料庫供統計：顯示文字可以改，代碼不要改。
const BLOCKERS = [
  ["long_list", "清單太長，不知道從哪開始"],
  ["too_big", "事情太大，沒拆小"],
  ["no_slot", "沒排進具體時段"],
  ["low_energy", "精神或體力不好"],
  ["interrupted", "被工作或臨時的事打斷"],
  ["perfection", "想做到完美而拖延"],
  ["forgot", "忘記回來看"],
  ["other", "其他（寫在感想裡）"]
];
const BLOCKER_LABEL = Object.fromEntries(BLOCKERS);
const REVIEW_STEPS = [
  "把這週冒出來的新事情全部加進任務庫，包括 Notion 裡還沒搬過來的待辦",
  "處理「待處理」和「停滯」的任務：拆小、排日期，或放棄",
  "每個領域選本週目標：主攻領域各 1–2 個，維持領域各最多 1 個",
  "把本週清單排進每一天，不超過每日上限",
  "確認本週固定行程：健身、皮拉提斯、家人出遊、遊戲時間"
];

/* ================= state ================= */
const store = createStore();
let S = emptyState();
let loaded = false, loadError = null, lastLoad = 0, pending = 0, lastLevel = null;
const UI = { tab: "today", panel: null, weekOffset: 0, monthOffset: 0, fArea: "all", fStatus: "open", justCleared: false, overNotified: new Set() };
try { const t = localStorage.getItem("rex-tab"); if (t) UI.tab = t; } catch (e) {}
if (/^#(today|week|month|backlog|rules)$/.test(location.hash)) UI.tab = location.hash.slice(1);

function emptyState() { return { config: null, tasks: {}, events: [], days: {}, meta: {}, goals: {}, counters: {}, reviews: {}, quarters: {} }; }

/* ================= utils ================= */
const $ = (s, r = document) => r.querySelector(s);
const esc = v => String(v ?? "").replace(/[&<>"']/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const diffDays = (a, b) => Math.round((parseYmd(a) - parseYmd(b)) / 86400000);
const todayKey = () => ymd(new Date(Date.now() - DAY_ROLLOVER_HOURS * 3600 * 1000));
const dowOf = s => parseYmd(s).getDay();
const md = s => { const d = parseYmd(s); return `${d.getMonth() + 1}/${d.getDate()}`; };
const mdw = s => `${md(s)}（${DOW[dowOf(s)]}）`;
const weekStart = s => { const d = parseYmd(s); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); };
function isoWeek(s) {
  const d = parseYmd(s);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const w = Math.ceil(((t - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${pad(w)}`;
}
const quarterKeyOf = s => `${s.slice(0, 4)}-Q${Math.floor((+s.slice(5, 7) - 1) / 3) + 1}`;
const uid = () => "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const areaStyle = a => `--c:${(AREAS[a] || AREAS.life).c}`;
const areaChip = a => `<span class="chip area" style="${areaStyle(a)}">${esc((AREAS[a] || {}).name || a)}</span>`;
const nowIso = () => new Date().toISOString();
const minsOf = hm => { const [h, m] = hm.split(":").map(Number); return h * 60 + m; };
const bedMins = hm => { const v = minsOf(hm); return v < 12 * 60 ? v + 24 * 60 : v; };

function C() {
  const c = Object.assign({}, DEFAULT_CONFIG, S.config || {});
  if (!Array.isArray(c.dailies) || !c.dailies.length) c.dailies = DEFAULT_CONFIG.dailies;
  return c;
}

/* ================= writes ================= */
function track(p) {
  pending++;
  Promise.resolve(p).catch(reportErr).finally(() => { pending--; });
}
function reportErr(err) {
  console.error(err);
  if (isAuthError(err)) { toast("需要重新登入", "登入已過期，這次的變更沒有儲存。請重新登入。", "bad"); showLogin(); return; }
  const m = `${(err && err.code) || ""} ${(err && err.message) || ""}`;
  const msg = /fetch|network/i.test(m) ? "網路連線有問題，變更沒有儲存。恢復連線後重新整理再試一次。"
    : /PGRST204|column/i.test(m) ? "資料庫缺少新欄位，變更沒有儲存。請先在 Supabase 執行最新的 SQL 更新檔。"
    : "變更沒有儲存成功，請重新整理後再試一次。";
  toast("儲存失敗", msg, "bad");
}
function logEvent(taskId, e) {
  const ev = Object.assign({ taskId, at: nowIso(), logDate: todayKey(), xp: 0 }, e);
  S.events.push(ev);
  track(store.addEvent(ev));
}
function saveTask(id, patch, ev) {
  const cur = S.tasks[id] || {};
  const t = Object.assign({}, cur, patch, { touchedDate: todayKey() });
  S.tasks[id] = t;
  track(store.putTask(id, t));
  if (ev) logEvent(id, ev);
}
function setQuest(date, qid, value) {
  const d = S.days[date] = S.days[date] || { dq: {} };
  d.dq[qid] = value;
  track(store.putQuest(date, qid, value));
}
function getDay(k) { return S.days[k] || { dq: {} }; }
function getMeta(k) { return Object.assign({ bed: "", wake: "", energy: null, note: "", summary: "", reflection: "", blockers: [], satisfaction: null }, S.meta[k] || {}); }
function setMeta(k, patch) {
  const m = S.meta[k] = Object.assign({}, getMeta(k), patch);
  track(store.putMeta(k, m));
}
function goalsFor(scope, key) { return Object.entries(S.goals).filter(([, g]) => g.scope === scope && g.periodKey === key).map(([id, g]) => Object.assign({ id }, g)).sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || "") || a.id.localeCompare(b.id)); }
function putGoal(id, g) { S.goals[id] = g; track(store.putGoal(id, g)); }
function delGoal(id) { delete S.goals[id]; track(store.delGoal(id)); }
const ctrKey = (scope, key, tid) => `${scope}|${key}|${tid}`;
function countsFor(scope, key) { const out = {}; for (const [k, v] of Object.entries(S.counters)) { const [s, p, t] = k.split("|"); if (s === scope && p === key) out[t] = v; } return out; }
function getReview(key) { return S.reviews[key] || { steps: [], done: false, note: "", doneAt: null }; }
function putReview(key, r) { S.reviews[key] = r; track(store.putReview(key, r)); }
function getQuarter(k) { return S.quarters[k] || { interest: "", done: false }; }
function putQuarter(k, q) { S.quarters[k] = q; track(store.putQuarter(k, q)); }

/* ================= scoring ================= */
function dayScore(day, cfg) {
  const dq = (day && day.dq) || {};
  let xp = 0, done = 0, coreAll = true, hasCore = false;
  const by = {};
  for (const q of cfg.dailies) {
    const v = dq[q.id];
    let ok = false, got = 0;
    if (q.type === "sets") { const n = +v || 0; ok = n >= (q.min || 1); if (ok) got = q.xp + (n >= (q.sets || 3) ? 5 : 0); }
    else { ok = !!v; if (ok) got = q.xp; }
    if (q.core) { hasCore = true; if (!ok) coreAll = false; }
    if (ok) done++;
    xp += got; by[q.area] = (by[q.area] || 0) + got;
  }
  if (!hasCore) coreAll = false;
  if (coreAll) { xp += 20; by.life = (by.life || 0) + 20; }
  return { xp, by, done, total: cfg.dailies.length, coreAll };
}
function totals() {
  const cfg = C();
  let xp = 0; const by = { career: 0, invest: 0, life: 0, body: 0 };
  const add = (a, n) => { xp += n; if (by[a] != null) by[a] += n; else by.life += n; };
  for (const d of Object.values(S.days)) { const s = dayScore(d, cfg); for (const a in s.by) add(a, s.by[a]); }
  for (const ev of S.events) if (ev.xp) { const t = S.tasks[ev.taskId]; add(t ? t.area : "life", ev.xp); }
  for (const g of Object.values(S.goals)) if (g.done) add(g.area, g.scope === "month" ? 100 : 50);
  for (const [k, v] of Object.entries(S.counters)) {
    const [scope, , tid] = k.split("|");
    const t = ((scope === "week" ? cfg.weekTargets : cfg.monthTargets) || []).find(x => x.id === tid);
    if (t && v >= t.target) add(t.area || "life", scope === "week" ? 30 : 50);
  }
  for (const r of Object.values(S.reviews)) if (r.done) add("life", 40);
  for (const q of Object.values(S.quarters)) if (q.done) add("life", 80);
  return { xp, by };
}
function levelOf(xp) { let L = 1; while (50 * (L + 1) * L <= xp) L++; return { L, base: 50 * L * (L - 1), next: 50 * (L + 1) * L }; }
function rankOf(L) { return L < 5 ? "E" : L < 10 ? "D" : L < 20 ? "C" : L < 35 ? "B" : L < 50 ? "A" : "S"; }
function streak() {
  const cfg = C(); let d = todayKey(), s = 0;
  if (!dayScore(getDay(d), cfg).coreAll) d = addDays(d, -1);
  while (s < 3660 && dayScore(getDay(d), cfg).coreAll) { s++; d = addDays(d, -1); }
  return s;
}

/* ================= task helpers ================= */
const isOpen = t => t && (t.status === "backlog" || t.status === "week");
function tasksList() { return Object.entries(S.tasks).map(([id, t]) => Object.assign({ id }, t)); }
function capOf(dateKey) { const c = C().caps || {}; const v = c[String(dowOf(dateKey))]; return v == null ? 2 : +v; }
function plannedOn(dateKey) { return tasksList().filter(t => isOpen(t) && t.plannedDate === dateKey); }
const isStepEvent = e => e.kind === "step" || e.kind === "split";
function stepsDoneOn(dateKey) { return S.events.filter(e => e.logDate === dateKey && isStepEvent(e)).length; }
function stepsOf(id) { return S.events.filter(e => e.taskId === id && isStepEvent(e)).length; }
function isStale(t) {
  if (!isOpen(t)) return false;
  if ((t.deferCount || 0) >= 3) return true;
  return t.status === "week" && t.touchedDate && diffDays(todayKey(), t.touchedDate) >= STALE_DAYS;
}
function sleepTarget(dateKey) {
  const plan = (C().sleepPlan || []).slice().sort((a, b) => (a.from < b.from ? -1 : 1));
  let cur = null; for (const p of plan) if (p.from <= dateKey) cur = p;
  return cur;
}
// 計時
function elapsedMin(t) { return (t.accumMin || 0) + (t.startedAt ? (Date.now() - Date.parse(t.startedAt)) / 60000 : 0); }
function limitMin(t) { return (t.estMin || 25) + (t.extDate === todayKey() ? EXTEND_MIN : 0); }
function hasTime(t) { return !!t.startedAt || (t.accumMin || 0) > 0; }
function settleMin(t) { return hasTime(t) ? Math.max(1, Math.round(elapsedMin(t))) : null; }
function pauseTimer(t) { return t.startedAt ? { startedAt: null, accumMin: Math.round(elapsedMin(t)) } : {}; }

/* ================= toast ================= */
function toast(title, body, kind) {
  const box = $("#toasts"); const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  el.innerHTML = `<span class="tt">${esc(title)}</span>${esc(body)}`;
  box.appendChild(el);
  setTimeout(() => el.remove(), kind === "lvl" ? 5200 : 3600);
}

/* ================= render plumbing ================= */
let renderQueued = false, renderDeferred = false;
function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => { renderQueued = false; render(); });
}
function typing() {
  const a = document.activeElement;
  return a && $("#view").contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName);
}
document.addEventListener("focusout", () => { if (renderDeferred) setTimeout(() => { if (!typing() && renderDeferred) { renderDeferred = false; render(true); } }, 0); });

function render(force) {
  if ($("#app").hidden) return;
  renderHeader();
  if (!force && typing()) { renderDeferred = true; return; }
  const v = UI.tab;
  for (const b of document.querySelectorAll(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.v === v));
  renderBanner();
  $("#view").innerHTML = !loaded ? "" : v === "week" ? viewWeek() : v === "month" ? viewMonth() : v === "backlog" ? viewBacklog() : v === "rules" ? viewRules() : viewToday();
}
function renderBanner() {
  const b = $("#banner");
  const upd = UI.newVersion ? `<div class="banner" style="margin-bottom:8px">網站有新版本。<button class="btn sm" data-act="update" style="margin-left:6px">重新載入</button></div>` : "";
  renderBannerBody(b);
  if (upd) b.innerHTML = upd + b.innerHTML;
}
function renderBannerBody(b) {
  if (loadError) b.innerHTML = `<div class="banner">資料讀取失敗：${esc(loadError)}。確認網路連線後重新整理頁面。</div>`;
  else if (!loaded) b.innerHTML = `<div class="banner">正在讀取資料…</div>`;
  else if (store.mode === "demo") b.innerHTML = `<div class="banner">展示模式：畫面上是範例資料，所有變更都不會儲存。在 js/config.js 填入 Supabase 設定後，就會改用你自己的資料。</div>`;
  else if (!S.config && !Object.keys(S.tasks).length) b.innerHTML = `<div class="banner">已登入，但資料庫還是空的。到 Supabase 執行資料搬移 SQL，或在「任務庫」新增第一件事。</div>`;
  else b.innerHTML = "";
}
function renderHeader() {
  const cfg = C(), tk = todayKey();
  const { xp, by } = totals();
  const lv = levelOf(xp);
  $("#lvNum").textContent = lv.L;
  $("#pName").textContent = cfg.playerName || "PLAYER";
  $("#pRank").textContent = `${rankOf(lv.L)} 級`;
  const pct = Math.max(0, Math.min(100, (xp - lv.base) / (lv.next - lv.base) * 100));
  $("#xpBar").style.width = pct.toFixed(1) + "%";
  $("#xpMeta").textContent = loaded ? `XP ${xp.toLocaleString()} ／ 下一級 ${lv.next.toLocaleString()}（還差 ${(lv.next - xp).toLocaleString()}）` : "正在讀取資料…";
  $("#streakNum").textContent = streak();
  $("#stats").innerHTML = AREA_ORDER.map(a => {
    const focus = (cfg.focus || []).includes(a);
    return `<div class="stat" style="${areaStyle(a)}"><div class="k"><span>${AREAS[a].name}${focus ? " · 主攻" : ""}</span><em>${AREAS[a].code}</em></div><div class="v num">${Math.floor(by[a] / 10)}</div></div>`;
  }).join("");
  let reset = `<span>今天 ${mdw(tk)}</span>`;
  if (cfg.startDate) {
    const n = diffDays(tk, cfg.startDate) + 1, total = cfg.resetDays || 14;
    if (n >= 1 && n <= total) reset += `<span class="chip">重整計畫 第 ${n} 天 ／ ${total} 天</span>`;
    else if (n > total) reset += `<span class="chip ok">重整期已完成，持續運作中</span>`;
  }
  const note = (cfg.dayNotes || {})[String(dowOf(tk))];
  if (note) reset += `<span class="chip">${esc(note)}</span>`;
  $("#resetLine").innerHTML = reset;
  if (loaded) {
    if (lastLevel != null && lv.L > lastLevel) toast("等級提升", `Lv.${lastLevel} → Lv.${lv.L}　目前評級：${rankOf(lv.L)} 級`, "lvl");
    lastLevel = lv.L;
  }
}
function win(title, en, body, opts = {}) {
  return `<section class="win${opts.warn ? " warn" : ""}"${opts.id ? ` id="${opts.id}"` : ""}>
    <div class="win-h"><h2>${title}</h2><span class="en">${en}</span><span class="rule"></span>${opts.side ? `<span class="side">${opts.side}</span>` : ""}</div>
    ${opts.sub ? `<p class="win-sub">${opts.sub}</p>` : ""}${body}</section>`;
}

/* ================= TODAY ================= */
function viewToday() {
  const cfg = C(), tk = todayKey();
  const day = getDay(tk), sc = dayScore(day, cfg), meta = getMeta(tk);
  const sleep = sleepTarget(tk);
  const rows = cfg.dailies.map(q => {
    let detail = q.detail || "";
    if (q.id === "sleep" && sleep) detail = `目標：${sleep.bed} 前上床`;
    if (q.id === "wake" && sleep) detail = `目標：${sleep.wake} 前起床`;
    const v = (day.dq || {})[q.id];
    if (q.type === "sets") {
      const n = +v || 0, ok = n >= (q.min || 1);
      const pips = Array.from({ length: q.sets || 3 }, (_, i) => `<button class="pip${i < n ? " on" : ""}" data-act="dq-set" data-id="${esc(q.id)}" data-n="${i + 1}" aria-label="${esc(q.label)} 第 ${i + 1} 組">${i + 1}</button>`).join("");
      return `<div class="dq${ok ? " done" : ""}"><span class="box">${ok ? "✓" : ""}</span><span class="lbl"><b>${esc(q.label)}</b><small>${esc(detail)}　完成 ${n} 組</small></span><span class="pips">${pips}</span></div>`;
    }
    return `<button class="dq${v ? " done" : ""}" data-act="dq-toggle" data-id="${esc(q.id)}" aria-pressed="${!!v}"><span class="box">${v ? "✓" : ""}</span><span class="lbl"><b>${esc(q.label)}</b>${detail ? `<small>${esc(detail)}</small>` : ""}</span><span class="xp">+${q.xp}</span></button>`;
  }).join("");
  const coreNames = cfg.dailies.filter(q => q.core).map(q => q.label).join("、");
  const clear = sc.coreAll
    ? `<div class="clear${UI.justCleared ? " fresh" : ""}">【完成】今日核心每日任務已達成，額外 +20 XP。連續天數 +1。</div>`
    : `<div class="clear pending">核心項目：${esc(coreNames)}。全部完成才算進連續天數。</div>`;
  UI.justCleared = false;
  const metaRow = `<div class="meta-row">
      <label class="fld" for="m-bed">昨晚上床時間<input type="time" id="m-bed" value="${esc(meta.bed)}" data-change="meta" data-f="bed"></label>
      <label class="fld" for="m-wake">今早起床時間<input type="time" id="m-wake" value="${esc(meta.wake)}" data-change="meta" data-f="wake"></label>
      <div class="fld"><span>今天精神（1 很差 – 5 很好）</span><div class="energy" role="group" aria-label="今天精神">${[1, 2, 3, 4, 5].map(n => `<button data-act="energy" data-v="${n}" aria-pressed="${meta.energy === n}">${n}</button>`).join("")}</div></div>
    </div><p class="hint" style="margin:6px 0 0">時間和精神分數是選填，會留著做之後的分析，例如睡眠和完成率的關係。填了時間會自動勾作息兩項。</p>`;
  const hr = new Date().getHours(), evening = hr >= 20 || hr < DAY_ROLLOVER_HOURS;
  const jump = `<div class="inline" style="margin-top:10px"><a class="btn sm" href="#review-win">${hasReview(getMeta(tk)) ? "查看今天的每日覆盤" : "寫今天的每日覆盤"}</a><span class="hint">${evening ? "就在下方" : "在頁面下方"}</span></div>`;
  let html = win("每日任務", "Daily Quest", `<div class="list">${rows}</div>${clear}${metaRow}${jump}`, { side: `${sc.done} / ${sc.total}` });
  if (evening) html += reviewWindow(tk);

  const carry = tasksList().filter(t => isOpen(t) && t.plannedDate && t.plannedDate < tk);
  if (carry.length) html += win("待處理", "Unresolved", `<div class="list">${carry.map(t => taskCard(t, { mode: "carry" })).join("")}</div>`,
    { warn: true, side: String(carry.length), sub: "排了日期但沒有完成的任務。每件都要選一個去處，不能放著。" });

  const cap = capOf(tk), planned = plannedOn(tk), doneSteps = stepsDoneOn(tk);
  let body = "";
  if (planned.length > cap) body += `<p class="hint" style="color:var(--bad);margin:0 0 8px">今天排了 ${planned.length} 件，超過上限 ${cap} 件。建議改期其中 ${planned.length - cap} 件。</p>`;
  body += planned.length ? `<div class="list">${planned.map(t => taskCard(t, { mode: "today" })).join("")}</div>`
    : `<div class="empty">今天還沒有排主線任務。從下方本週清單挑一件，或到「任務庫」把事情加入本週。</div>`;
  const pool = tasksList().filter(t => t.status === "week" && !t.plannedDate);
  if (pool.length && planned.length < cap) {
    body += `<div class="sec-label">從本週清單加入今天</div><div class="list">${pool.slice(0, 6).map(t =>
      `<div class="inline" style="justify-content:space-between;gap:8px">${areaChip(t.area)}<span style="flex:1;min-width:0;overflow-wrap:anywhere">${esc(t.title)}</span><span class="chip num">${t.estMin || 25} 分</span><button class="btn sm" data-act="plan-today" data-id="${t.id}">加入今天</button></div>`).join("")}</div>`;
  }
  html += win("今日主線", "Main Quest", body, { side: `${planned.length} / ${cap}`, sub: doneSteps ? `今天已完成 ${doneSteps} 個步驟。` : "按「開始計時」再動手，時間到會提醒你處理。" });

  const stale = tasksList().filter(isStale);
  if (stale.length) html += win("停滯警告", "Stalled", `<div class="list">${stale.map(t => taskCard(t, { mode: "stale" })).join("")}</div>`,
    { warn: true, side: String(stale.length), sub: `在本週清單 ${STALE_DAYS} 天沒有動，或已改期 3 次。拆小、排日期，或放棄。` });

  if (!evening) html += reviewWindow(tk);
  html += win("今日行程", "Schedule", scheduleFor(tk));
  return html;
}
function daySystemLine(dk) {
  const sc = dayScore(getDay(dk), C());
  const evs = S.events.filter(e => e.logDate === dk);
  const steps = evs.filter(isStepEvent);
  const mins = steps.reduce((s, e) => s + (e.actualMin || 0), 0);
  const defers = evs.filter(e => e.kind === "defer").length;
  const drops = evs.filter(e => e.kind === "drop" || e.kind === "flag_drop").length;
  return `每日任務 ${sc.done}/${sc.total} · 主線步驟 ${steps.length} 個${mins ? `（計時 ${mins} 分）` : ""} · 改期 ${defers} 件 · 放棄 ${drops} 件`;
}
const hasReview = m => !!(m.summary || m.reflection || m.satisfaction || (m.blockers || []).length);
function reviewWindow(dk) {
  const m = getMeta(dk), can = store.reviewReady !== false, dis = can ? "" : " disabled";
  const chips = BLOCKERS.map(([code, label]) => `<label class="chipbox"><input type="checkbox" name="rv-blk" value="${code}"${(m.blockers || []).includes(code) ? " checked" : ""}${dis}><span>${esc(label)}</span></label>`).join("");
  const sat = [1, 2, 3, 4, 5].map(n => `<label class="chipbox sat"><input type="radio" name="rv-sat" value="${n}"${m.satisfaction === n ? " checked" : ""}${dis}><span class="num">${n}</span></label>`).join("");
  return win("每日覆盤", "Daily Review", `
    ${can ? "" : `<div class="banner" style="margin-bottom:10px">資料庫還沒有覆盤用的欄位。請先在 Supabase SQL Editor 執行 2026-10-13-day-review.sql，再重新整理這個頁面。</div>`}
    <div class="sysline num">系統紀錄：${esc(daySystemLine(dk))}</div>
    <form id="reviewForm" class="list" autocomplete="off" data-date="${dk}">
      <label class="fld" for="rv-summary">一句話總結今天的執行狀況<input type="text" id="rv-summary" maxlength="140" value="${esc(m.summary)}" placeholder="例如：主線做完一步，晚上被會議資料拖住，投資流程沒做"${dis}></label>
      <div class="fld"><span>今天滿意度（1 很差 – 5 很好，選填）</span><div class="chips">${sat}</div></div>
      <div class="fld"><span>卡住的原因（可複選，選填）</span><div class="chips">${chips}</div></div>
      <label class="fld" for="rv-reflect">感想與觀察（選填）<textarea id="rv-reflect" rows="3" placeholder="什麼有效、什麼沒效、明天想調整什麼"${dis}>${esc(m.reflection)}</textarea></label>
      <div class="inline"><button class="btn pri" type="submit"${dis}>${hasReview(m) ? "更新覆盤" : "儲存覆盤"}</button><span class="hint">儲存後會自動勾選每日任務的「晚間覆盤」。</span></div>
    </form>`, { id: "review-win", side: mdw(dk), sub: "睡前 5 分鐘寫完。凌晨 4 點前寫的都算今天。晚上 8 點後這區會移到每日任務正下方。" });
}
function saveReview(form) {
  const dk = form.dataset.date;
  const summary = val("rv-summary"), reflection = val("rv-reflect");
  const blockers = [...form.querySelectorAll('input[name="rv-blk"]:checked')].map(i => i.value);
  const satEl = form.querySelector('input[name="rv-sat"]:checked');
  const satisfaction = satEl ? +satEl.value : null;
  if (!summary && !reflection && !blockers.length && !satisfaction) { toast("還差一步", "至少寫一句總結，或選一個滿意度。", "bad"); return; }
  setMeta(dk, { summary, reflection, blockers, satisfaction });
  const cfg = C(), q = cfg.dailies.find(x => x.id === "review");
  if (q && !getDay(dk).dq.review) {
    const before = dayScore(getDay(dk), cfg).coreAll;
    setQuest(dk, "review", 1);
    toast("覆盤已儲存", `${q.label} 完成，+${q.xp} XP`);
    afterQuest(before);
  } else toast("通知", "覆盤已儲存。");
  render(true);
}
function weekReviewDigest(days) {
  const rows = [], counts = {};
  const sats = [];
  for (const d of days) {
    const m = getMeta(d);
    if (!hasReview(m)) continue;
    for (const b of (m.blockers || [])) counts[b] = (counts[b] || 0) + 1;
    if (m.satisfaction) sats.push(m.satisfaction);
    rows.push(`<div class="dr"><span class="dr-h num">週${DOW[dowOf(d)]} ${md(d)}${m.satisfaction ? ` · 滿意度 ${m.satisfaction}` : ""}</span>
      <span>${esc(m.summary || "（沒寫總結）")}</span>
      ${(m.blockers || []).length ? `<span class="hint">卡住：${m.blockers.map(b => esc(BLOCKER_LABEL[b] || b)).join("、")}</span>` : ""}
      ${m.reflection ? `<span class="hint">${esc(m.reflection)}</span>` : ""}</div>`);
  }
  if (!rows.length) return `<div class="sec-label">這週的每日覆盤</div><div class="empty">這週還沒有寫過每日覆盤。</div>`;
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b, n]) => `${esc(BLOCKER_LABEL[b] || b)} ${n} 天`).join("、");
  const avg = sats.length ? (sats.reduce((s, x) => s + x, 0) / sats.length).toFixed(1) : null;
  return `<div class="sec-label">這週的每日覆盤（${rows.length} 天）</div>
    <p class="hint" style="margin:0 0 8px">${avg ? `平均滿意度 ${avg}（${sats.length} 天有評分）` : "這週沒有評滿意度"}${top ? `；最常卡住：${top}` : ""}</p>
    <div class="list">${rows.join("")}</div>`;
}
function scheduleFor(dk) {
  const cfg = C(), dw = dowOf(dk);
  const fixed = (cfg.fixed || []).filter(f => (f.dow || []).includes(dw));
  const blocks = [];
  for (const b of (cfg.timeBlocks || [])) if ((b.dow || []).includes(dw)) blocks.push(...(b.items || []));
  if (!fixed.length && !blocks.length) return `<div class="empty">這天沒有固定行程。</div>`;
  let h = `<div class="sched">`;
  h += fixed.map(f => `<div class="it"><span class="tm">${esc(f.time)}</span><span>${esc(f.label)}${f.note ? `<br><span class="hint">${esc(f.note)}</span>` : ""}</span></div>`).join("");
  if (blocks.length) {
    h += `<div class="sec-label" style="margin-top:10px">建議時段（照你的作息推算，可再調整）</div>`;
    h += blocks.map(b => `<div class="it sugg"><span class="tm">${esc(b.time)}</span><span>${esc(b.label)}</span></div>`).join("");
  }
  return h + `</div>`;
}

/* ================= task card ================= */
function taskCard(t, o = {}) {
  const mode = o.mode || "list";
  const open = UI.panel && UI.panel.id === t.id ? UI.panel.kind : null;
  const est = t.estMin || 25;
  const meta = [areaChip(t.area)];
  let cls = "";
  if (isOpen(t)) meta.push(`<span class="chip num">${est} 分 · +${STEP_XP[est] || 20} XP</span>`);
  if (t.startedAt) {
    const el = Math.floor(elapsedMin(t)), lim = limitMin(t);
    meta.push(`<span class="chip run num">計時中 ${el} ／ ${lim} 分</span>`);
    cls += " running";
    if (el >= lim) { meta.push(`<span class="chip over">已到預估時間：按「超時／卡住」選一個處理方式</span>`); cls += " overtime"; }
  } else if ((t.accumMin || 0) > 0 && isOpen(t)) meta.push(`<span class="chip num">這一步已累積 ${t.accumMin} 分</span>`);
  if (t.plannedDate && isOpen(t)) meta.push(`<span class="chip">排在 ${mdw(t.plannedDate)}</span>`);
  if (t.status === "week" && !t.plannedDate) meta.push(`<span class="chip">本週清單</span>`);
  if (t.due) meta.push(`<span class="chip${t.due < todayKey() && isOpen(t) ? " flag" : ""}">期限 ${md(t.due)}</span>`);
  for (const tag of (t.tags || [])) meta.push(`<span class="chip">${esc(tag)}</span>`);
  if ((t.deferCount || 0) >= 1) meta.push(`<span class="chip${t.deferCount >= 3 ? " flag" : ""}">已改期 ${t.deferCount} 次</span>`);
  const steps = stepsOf(t.id);
  if (steps) meta.push(`<span class="chip ok">完成 ${steps} 步</span>`);
  if (t.status === "done") meta.push(`<span class="chip ok">已完成 ${t.doneDate ? md(t.doneDate) : ""}</span>`);
  if (t.status === "dropped") meta.push(`<span class="chip">已放棄</span>`);
  if (t.flag) meta.push(`<span class="chip flag">${esc(t.flag)}</span>`);

  let actions = "";
  if (mode === "today") {
    actions = `${t.startedAt ? `<button class="btn sm" data-act="timer-stop" data-id="${t.id}">停止計時</button>` : `<button class="btn sm" data-act="timer-start" data-id="${t.id}">開始計時</button>`}
      <button class="btn pri sm" data-act="panel" data-id="${t.id}" data-kind="step">完成這一步</button>
      <button class="btn sm" data-act="panel" data-id="${t.id}" data-kind="stuck">超時／卡住</button>
      <button class="btn ghost sm" data-act="unplan" data-id="${t.id}">移出今天</button>`;
  } else if (mode === "carry") {
    actions = `<button class="btn pri sm" data-act="plan-today" data-id="${t.id}">移到今天</button>
      <button class="btn sm" data-act="panel" data-id="${t.id}" data-kind="defer">改期</button>
      <button class="btn sm" data-act="to-backlog" data-id="${t.id}">放回任務庫</button>
      <button class="btn danger sm" data-act="panel" data-id="${t.id}" data-kind="drop">放棄</button>`;
  } else if (mode === "stale") {
    actions = `<button class="btn sm" data-act="panel" data-id="${t.id}" data-kind="split">拆小</button>
      <button class="btn sm" data-act="panel" data-id="${t.id}" data-kind="defer">排日期</button>
      <button class="btn sm" data-act="to-backlog" data-id="${t.id}">放回任務庫</button>
      <button class="btn danger sm" data-act="panel" data-id="${t.id}" data-kind="drop">放棄</button>`;
  } else if (mode === "flag") {
    actions = `<button class="btn sm" data-act="flag-keep" data-id="${t.id}">保留</button>
      <button class="btn danger sm" data-act="flag-drop" data-id="${t.id}">放棄</button>`;
  } else {
    if (t.status === "backlog") actions += `<button class="btn sm" data-act="to-week" data-id="${t.id}">加入本週</button>`;
    if (t.status === "week") actions += `<button class="btn sm" data-act="to-backlog" data-id="${t.id}">移回任務庫</button>`;
    if (isOpen(t)) actions += `<button class="btn sm" data-act="panel" data-id="${t.id}" data-kind="defer">排日期</button>
      <button class="btn sm" data-act="panel" data-id="${t.id}" data-kind="step">完成這一步</button>
      <button class="btn ghost sm" data-act="panel" data-id="${t.id}" data-kind="edit">編輯</button>
      <button class="btn danger sm" data-act="panel" data-id="${t.id}" data-kind="drop">放棄</button>`;
    if (t.status === "dropped" || t.status === "done") actions += `<button class="btn ghost sm" data-act="restore" data-id="${t.id}">放回任務庫</button>`;
  }
  return `<article class="task${t.status === "done" ? " done" : ""}${t.status === "dropped" ? " dropped" : ""}${cls}" style="${areaStyle(t.area)}">
    <div class="t1"><span class="title">${esc(t.title)}</span></div>
    ${t.next && isOpen(t) ? `<div class="next">${esc(t.next)}</div>` : ""}
    <div class="meta">${meta.join("")}</div>
    ${t.note && (mode === "list" || mode === "flag") ? `<div class="note">${esc(t.note)}</div>` : ""}
    ${t.source && mode === "list" ? `<div class="note">來源：${esc(t.source)}</div>` : ""}
    ${t.dropReason && t.status === "dropped" ? `<div class="note">放棄原因：${esc(t.dropReason)}</div>` : ""}
    <div class="row-actions">${actions}</div>
    ${open ? taskPanel(t, open) : ""}
  </article>`;
}
function estSelect(id, val) {
  return `<select id="${id}">${[25, 50, 90].map(n => `<option value="${n}"${+val === n ? " selected" : ""}>${n} 分鐘</option>`).join("")}</select>`;
}
function taskPanel(t, kind) {
  const id = t.id, xp = STEP_XP[t.estMin || 25] || 20;
  const cancel = `<div class="inline"><button class="btn ghost sm" data-act="panel-close">取消</button></div>`;
  if (kind === "step") return `<div class="panel-in">
    <div class="opt"><h4>完成這一步，換下一步（+${xp} XP）</h4>
      <input type="text" id="nx-${id}" placeholder="新的下一步：具體到可以直接開始">
      <div class="inline">${estSelect("ne-" + id, t.estMin || 25)}<button class="btn pri sm" data-act="step-next" data-id="${id}">記錄並換下一步</button></div>
      <span class="hint">完成後任務回到本週清單，晚間覆盤時再排日期。${hasTime(t) ? `這一步計時 ${Math.round(elapsedMin(t))} 分鐘，會一起記錄。` : ""}</span></div>
    <div class="opt"><h4>整個任務完成（+${xp + 30} XP）</h4>
      <div class="inline"><button class="btn pri sm" data-act="step-finish" data-id="${id}">標記整個任務完成</button><button class="btn ghost sm" data-act="panel-close">取消</button></div></div>
  </div>`;
  if (kind === "stuck") {
    const extended = t.extDate === todayKey();
    return `<div class="panel-in">
      <div class="opt"><h4>延長 ${EXTEND_MIN} 分鐘</h4><span class="hint">每件任務每天只能延長一次。</span>
        <div class="inline"><button class="btn sm" data-act="extend" data-id="${id}"${extended ? " disabled" : ""}>${extended ? "今天已延長過" : `延長 ${EXTEND_MIN} 分鐘`}</button></div></div>
      ${splitOpt(t)}${deferOpt(t)}${dropOpt(t)}${cancel}</div>`;
  }
  if (kind === "split") return `<div class="panel-in">${splitOpt(t)}${cancel}</div>`;
  if (kind === "defer") return `<div class="panel-in">${deferOpt(t)}${cancel}</div>`;
  if (kind === "drop") return `<div class="panel-in">${dropOpt(t)}${cancel}</div>`;
  if (kind === "edit") return `<div class="panel-in"><div class="opt"><h4>編輯任務</h4>
      <label class="fld" for="et-${id}">任務名稱<input type="text" id="et-${id}" value="${esc(t.title)}"></label>
      <label class="fld" for="en-${id}">下一步<input type="text" id="en-${id}" value="${esc(t.next || "")}"></label>
      <div class="grid2">
        <label class="fld" for="ea-${id}">領域<select id="ea-${id}">${AREA_ORDER.map(a => `<option value="${a}"${t.area === a ? " selected" : ""}>${AREAS[a].name}</option>`).join("")}</select></label>
        <label class="fld" for="ee-${id}">下一步預估時間${estSelect("ee-" + id, t.estMin || 25)}</label>
        <label class="fld" for="ed-${id}">期限（可空白）<input type="date" id="ed-${id}" value="${esc(t.due || "")}"></label>
      </div>
      <label class="fld" for="eo-${id}">備註<textarea id="eo-${id}">${esc(t.note || "")}</textarea></label>
      <div class="inline"><button class="btn pri sm" data-act="edit-save" data-id="${id}">儲存</button><button class="btn ghost sm" data-act="panel-close">取消</button></div>
    </div></div>`;
  return "";
}
function splitOpt(t) {
  const id = t.id, half = Math.round((STEP_XP[t.estMin || 25] || 20) / 2);
  return `<div class="opt"><h4>拆分（已完成的部分 +${half} XP）</h4>
    <input type="text" id="sd-${id}" placeholder="已經完成的部分（可空白）">
    <input type="text" id="sn-${id}" placeholder="剩下的下一步：比原本更小">
    <div class="inline">${estSelect("se-" + id, 25)}<button class="btn sm" data-act="split" data-id="${id}">拆分</button></div></div>`;
}
function deferOpt(t) {
  const id = t.id, tomorrow = addDays(todayKey(), 1);
  return `<div class="opt"><h4>改期（一定要填日期）</h4>
    <div class="inline"><input type="date" id="dd-${id}" value="${t.plannedDate && t.plannedDate > todayKey() ? t.plannedDate : tomorrow}"><button class="btn sm" data-act="defer" data-id="${id}">改到這天</button></div>
    ${(t.deferCount || 0) >= 2 ? `<span class="hint" style="color:var(--warn)">已改期 ${t.deferCount} 次，再改一次會被標成停滯。建議拆小。</span>` : ""}</div>`;
}
function dropOpt(t) {
  const id = t.id;
  return `<div class="opt"><h4>放棄</h4>
    <input type="text" id="dr-${id}" placeholder="一句話原因（例如：不再重要、已被別的任務取代）">
    <div class="inline"><button class="btn danger sm" data-act="drop" data-id="${id}">確定放棄</button></div></div>`;
}

/* ================= WEEK ================= */
function goalsBlock(scope, key, goals) {
  const focus = C().focus || [];
  const order = AREA_ORDER.slice().sort((a, b) => focus.includes(b) - focus.includes(a));
  let h = "";
  for (const a of order) {
    const gs = goals.filter(g => g.area === a);
    const isF = focus.includes(a), limit = isF ? 2 : 1;
    h += `<div class="ga"><div class="ga-h">${areaChip(a)}<span>${isF ? `主攻 · 建議 1–${limit} 個` : `維持 · 建議最多 ${limit} 個`}</span>${gs.length > limit ? `<span class="chip flag">超過建議數量</span>` : ""}</div>`;
    h += gs.length ? gs.map(g => `<div class="goal${g.done ? " done" : ""}">
        <button class="box" data-act="goal-toggle" data-gid="${esc(g.id)}" aria-pressed="${!!g.done}" aria-label="切換完成">${g.done ? "✓" : ""}</button>
        <span class="txt">${esc(g.text)} ${g.suggested ? `<span class="chip sug">建議，待你確認</span>` : ""}</span>
        <span class="row-actions">${g.suggested ? `<button class="btn sm" data-act="goal-confirm" data-gid="${esc(g.id)}">確認</button>` : ""}<button class="btn ghost sm" data-act="goal-del" data-gid="${esc(g.id)}" aria-label="刪除目標">刪除</button></span>
      </div>`).join("") : `<div class="hint" style="padding:4px 0 2px 34px">還沒有目標</div>`;
    h += `</div>`;
  }
  const fid = `${scope}-goal`;
  h += `<div class="sec-label">新增目標</div><div class="inline">
    <select id="${fid}-area" aria-label="目標領域">${order.map(a => `<option value="${a}">${AREAS[a].name}</option>`).join("")}</select>
    <input type="text" id="${fid}-text" placeholder="寫成做得到、看得出完成與否的一句話">
    <button class="btn sm" data-act="goal-add" data-scope="${scope}" data-key="${key}">新增</button></div>`;
  return h;
}
function countersBlock(scope, key, targets) {
  if (!targets.length) return `<div class="empty">還沒有設定固定指標。</div>`;
  const counts = countsFor(scope, key);
  return targets.map(t => {
    const n = +counts[t.id] || 0, met = n >= t.target;
    const goalTxt = t.stretch ? `${t.target}–${t.stretch}` : `${t.target}`;
    const pct = Math.min(100, n / (t.stretch || t.target) * 100);
    return `<div class="ctr${met ? " met" : ""}">
      <span class="nm">${esc(t.label)}<small>目標 ${goalTxt} ${esc(t.unit || "次")}${met ? " · 達成 +" + (scope === "week" ? 30 : 50) + " XP" : ""}</small></span>
      <span class="ctl"><button class="sq" data-act="count" data-scope="${scope}" data-key="${key}" data-tid="${esc(t.id)}" data-d="-1" aria-label="減少">−</button><b>${n} / ${goalTxt}</b><button class="sq" data-act="count" data-scope="${scope}" data-key="${key}" data-tid="${esc(t.id)}" data-d="1" aria-label="增加">＋</button></span>
      <div class="bar"><i style="width:${pct}%"></i></div></div>`;
  }).join("");
}
function viewWeek() {
  const cfg = C(), tk = todayKey();
  const ws = addDays(weekStart(tk), UI.weekOffset * 7), key = isoWeek(ws);
  const label = UI.weekOffset === 0 ? "本週" : UI.weekOffset === 1 ? "下週" : UI.weekOffset === -1 ? "上週" : (UI.weekOffset > 0 ? `${UI.weekOffset} 週後` : `${-UI.weekOffset} 週前`);
  const nav = `<div class="nav3"><button class="btn sm" data-act="nav-week" data-d="-1">‹ 前一週</button>
    <span class="num">${label} · ${key.replace("-W", " 第 ")} 週 · ${md(ws)} – ${md(addDays(ws, 6))}</span>
    <button class="btn sm" data-act="nav-week" data-d="1">下一週 ›</button></div>`;
  let html = win("週目標", "Weekly Goals", nav + `<div style="margin-top:12px">${goalsBlock("week", key, goalsFor("week", key))}</div>`, { sub: "週目標完成一個 +50 XP。" });
  html += win("每週指標", "Weekly Targets", countersBlock("week", key, cfg.weekTargets || []), { sub: "做完就按 ＋。" });

  const days = Array.from({ length: 7 }, (_, i) => addDays(ws, i));
  const strip = days.map(d => {
    const pl = plannedOn(d), cap = capOf(d), dw = dowOf(d);
    const fx = (cfg.fixed || []).filter(f => (f.dow || []).includes(dw) && f.strip);
    const capCls = pl.length > cap ? " over" : pl.length === cap ? " full" : "";
    return `<div class="d7${d === tk ? " today" : ""}"><div class="dh"><span>週${DOW[dw]}</span><b>${md(d)}</b></div>
      <span class="cap${capCls}">主線 ${pl.length} / ${cap}</span>
      ${pl.map(t => `<span class="tt" style="${areaStyle(t.area)}">${esc(t.title)}</span>`).join("")}
      ${fx.map(f => `<span class="fx">${esc(f.short || f.label)}</span>`).join("")}</div>`;
  }).join("");
  const pool = tasksList().filter(t => t.status === "week" && (!t.plannedDate || t.plannedDate < ws));
  const opts = days.map(x => `<option value="${x}">週${DOW[dowOf(x)]} ${md(x)}（${plannedOn(x).length}/${capOf(x)}）</option>`).join("");
  const poolHtml = pool.length ? pool.map(t => `<div class="inline" style="gap:8px;padding:6px 0;border-bottom:1px solid var(--edge-soft)">
      ${areaChip(t.area)}<span style="flex:1 1 160px;min-width:0;overflow-wrap:anywhere">${esc(t.title)}</span>
      <select id="pd-${t.id}" data-change="plan-date" data-id="${t.id}" aria-label="排到哪一天"><option value="">排到哪一天…</option>${opts}</select></div>`).join("")
    : `<div class="empty">本週清單都排好了。要加新的，到「任務庫」按「加入本週」。</div>`;
  html += win("任務排程", "Schedule", `<div class="days7">${strip}</div><div class="sec-label">本週清單：還沒排日期</div>${poolHtml}`, { sub: "每天的數字是「已排主線 / 上限」。紅色代表超過上限。" });

  const rv = getReview(key);
  const stepsHtml = REVIEW_STEPS.map((s, i) => `<div class="goal${rv.steps && rv.steps[i] ? " done" : ""}">
      <button class="box" data-act="review-step" data-key="${key}" data-i="${i}" aria-pressed="${!!(rv.steps && rv.steps[i])}" aria-label="切換步驟">${rv.steps && rv.steps[i] ? "✓" : ""}</button>
      <span class="txt"><span class="num" style="color:var(--glow);margin-right:6px">${i + 1}</span>${esc(s)}</span><span></span></div>`).join("");
  html += win("週回顧", "Weekly Review", `${weekReviewDigest(days)}<div class="sec-label">回顧步驟</div>${stepsHtml}
    <label class="fld" for="rv-note-${key}" style="margin-top:10px">這週的觀察（什麼有效、什麼卡住）<textarea id="rv-note-${key}">${esc(rv.note || "")}</textarea></label>
    <div class="inline" style="margin-top:10px"><button class="btn sm" data-act="review-note" data-key="${key}">儲存觀察</button>
    <button class="btn ${rv.done ? "ghost" : "pri"} sm" data-act="review-done" data-key="${key}">${rv.done ? "已完成週回顧（點擊取消）" : "完成週回顧 +40 XP"}</button></div>`,
    { sub: "每週日 30 分鐘，照順序走。週日做回顧時，用上方的「下一週」切到下週來排。", side: rv.done ? "已完成" : "" });
  return html;
}

/* ================= MONTH ================= */
function viewMonth() {
  const cfg = C(), tk = todayKey();
  const base = parseYmd(tk); base.setDate(1); base.setMonth(base.getMonth() + UI.monthOffset);
  const mk = ymd(base).slice(0, 7);
  const qk = quarterKeyOf(ymd(base)), q = getQuarter(qk);
  const nav = `<div class="nav3"><button class="btn sm" data-act="nav-month" data-d="-1">‹ 上個月</button>
    <span class="num">${base.getFullYear()} 年 ${base.getMonth() + 1} 月</span>
    <button class="btn sm" data-act="nav-month" data-d="1">下個月 ›</button></div>`;
  let html = win("月目標", "Monthly Goals", nav + `<div style="margin-top:12px">${goalsBlock("month", mk, goalsFor("month", mk))}</div>`, { sub: "月目標完成一個 +100 XP。" });
  html += win("每月指標", "Monthly Targets", countersBlock("month", mk, cfg.monthTargets || []) +
    `<div class="sec-label">本季新興趣（${qk.replace("-", " ")}）</div>
     <div class="inline"><input type="text" id="qi-${qk}" value="${esc(q.interest || "")}" placeholder="這一季要接觸的新興趣或新領域">
     <button class="btn sm" data-act="interest-save" data-key="${qk}">儲存</button>
     <button class="btn ${q.done ? "ghost" : ""} sm" data-act="interest-done" data-key="${qk}">${q.done ? "已接觸 ✓" : "標記已接觸 +80 XP"}</button></div>`);
  const y = base.getFullYear(), mo = base.getMonth();
  const nDays = new Date(y, mo + 1, 0).getDate();
  const lead = (base.getDay() + 6) % 7;
  let cells = ["一", "二", "三", "四", "五", "六", "日"].map(d => `<div class="hd">${d}</div>`).join("");
  for (let i = 0; i < lead; i++) cells += `<div class="c blank"></div>`;
  let cleared = 0;
  for (let d = 1; d <= nDays; d++) {
    const k = `${mk}-${pad(d)}`, day = S.days[k];
    let cls = "";
    if (day) { const sc = dayScore(day, cfg); if (sc.done === sc.total) cls = "l3"; else if (sc.coreAll) cls = "l2"; else if (sc.done > 0) cls = "l1"; if (sc.coreAll) cleared++; }
    cells += `<div class="c ${cls}${k === tk ? " td" : ""}" title="${k}">${d}</div>`;
  }
  html += win("每日任務紀錄", "Daily Log", `<div class="cal">${cells}</div>
    <div class="legend"><span><i style="background:rgba(92,200,255,.12)"></i>做了一部分</span><span><i style="background:rgba(92,200,255,.32)"></i>核心項目完成</span><span><i style="background:rgba(92,200,255,.6)"></i>全部完成</span><span><i style="border-color:var(--warn)"></i>今天</span></div>`,
    { side: `${cleared} 天達成` });
  const lg = cfg.longGoals || [];
  html += win("三年目標", "Long Goals", lg.length ? `<div class="list">${lg.map(g => `<div class="task" style="${areaStyle(g.area)}"><div class="meta">${areaChip(g.area)}</div><div class="title">${esc(g.text)}</div></div>`).join("")}</div>`
    : `<div class="empty">還沒有設定長期目標。</div>`);
  return html;
}

/* ================= BACKLOG ================= */
function viewBacklog() {
  const all = tasksList();
  const flagged = all.filter(t => t.flag && isOpen(t));
  let html = win("新增任務", "New Quest", `<form id="addForm" class="list" autocomplete="off">
      <label class="fld" for="na-title">任務名稱<input type="text" id="na-title" placeholder="例如：完成交易系統每日流程草稿" required></label>
      <label class="fld" for="na-next">下一步（具體到可以直接開始的動作）<input type="text" id="na-next" placeholder="例如：列出每天要看的 5 個資訊來源"></label>
      <div class="grid2">
        <label class="fld" for="na-area">領域<select id="na-area">${AREA_ORDER.map(a => `<option value="${a}">${AREAS[a].name}</option>`).join("")}</select></label>
        <label class="fld" for="na-est">下一步預估時間${estSelect("na-est", 25)}</label>
        <label class="fld" for="na-due">期限（可空白）<input type="date" id="na-due"></label>
        <label class="fld" for="na-where">放到哪裡<select id="na-where"><option value="backlog">任務庫</option><option value="week">本週清單</option></select></label>
      </div>
      <div class="inline"><button class="btn pri" type="submit">加入</button><span class="hint">超過 90 分鐘的事，先寫成第一個小步驟。</span></div>
    </form>`);
  if (flagged.length) html += win("需要你決定", "Decide", `<div class="list">${flagged.map(t => taskCard(t, { mode: "flag" })).join("")}</div>`,
    { warn: true, side: String(flagged.length), sub: "從舊清單搬過來時標記的項目。保留或放棄，選一個。" });
  const st = UI.fStatus;
  const fA = `<div class="filters" role="group" aria-label="依領域篩選">${["all", ...AREA_ORDER].map(a => `<button class="f" data-act="f-area" data-v="${a}" aria-pressed="${UI.fArea === a}">${a === "all" ? "全部" : AREAS[a].name}</button>`).join("")}</div>`;
  const fS = `<div class="filters" role="group" aria-label="依狀態篩選" style="margin-top:6px">${[["open", "進行中（任務庫＋本週）"], ["week", "本週"], ["backlog", "任務庫"], ["done", "已完成"], ["dropped", "已放棄"]].map(([v, l]) => `<button class="f" data-act="f-status" data-v="${v}" aria-pressed="${st === v}">${l}</button>`).join("")}</div>`;
  const list = all.filter(t => (UI.fArea === "all" || t.area === UI.fArea) && (st === "open" ? isOpen(t) : t.status === st));
  list.sort((a, b) => (a.status === "week" ? 0 : 1) - (b.status === "week" ? 0 : 1) || (a.createdDate || "").localeCompare(b.createdDate || "") || a.id.localeCompare(b.id));
  let body = fA + fS;
  if (!all.length) body += `<div class="empty" style="margin-top:12px">任務庫是空的。用上方表單新增第一件事。</div>`;
  else if (!list.length) body += `<div class="empty" style="margin-top:12px">這個篩選條件下沒有任務。</div>`;
  else for (const a of AREA_ORDER) {
    const g = list.filter(t => t.area === a); if (!g.length) continue;
    body += `<div class="sec-label" style="margin-top:16px">${AREAS[a].name} · ${g.length} 件</div><div class="list">${g.map(t => taskCard(t)).join("")}</div>`;
  }
  html += win("任務庫", "Quest Log", body, { side: `${all.filter(isOpen).length} 件進行中` });
  return html;
}

/* ================= RULES ================= */
function viewRules() {
  const cfg = C(), caps = cfg.caps || {};
  const capLine = [1, 2, 3, 4, 5, 6, 0].map(d => `週${DOW[d]} ${caps[String(d)] ?? 2} 件`).join("、");
  const sp = (cfg.sleepPlan || []).slice().sort((a, b) => (a.from < b.from ? -1 : 1)).map(p => `${md(p.from)} 起：${p.bed} 前上床、${p.wake} 前起床`).join("；");
  const rules = [
    ["單一入口", "所有待辦以 Solo Leveling 的任務庫為準。通勤時可以先記在 Notion，但當天晚間覆盤要把待辦開進任務庫，並在 Notion 標記已搬移。Notion 只留想法和筆記。"],
    ["每件任務都有下一步", "主線任務一定要寫「下一步」和預估時間（25、50 或 90 分鐘）。超過 90 分鐘的事，先拆成第一個小步驟。"],
    ["每日主線上限", `${capLine}。每日任務不算在上限內。超過上限時面板會用紅字提醒。`],
    ["先計時再動手", "按「開始計時」再開始做。到了預估時間，卡片會變紅，提醒你用超時協議處理。計時紀錄會留著，之後可以分析預估準不準。"],
    ["超時協議", `做到預估時間還沒完成，按「超時／卡住」，四選一：延長 ${EXTEND_MIN} 分鐘（每件每天一次）、拆分、改期（一定要填日期）、放棄（寫一句原因）。不能直接放著。`],
    ["沒做完的不會消失", "排了日期卻沒完成的任務，隔天會出現在「待處理」，要選移到今天、改期、放回任務庫或放棄。"],
    ["停滯規則", `在本週清單 ${STALE_DAYS} 天沒動的任務、或已改期 3 次的任務，會出現在「停滯警告」。週回顧時一定要處理。`],
    ["晚間覆盤", "每天睡前 5–10 分鐘：勾完成、把 Notion 記的待辦開進任務庫、處理沒做完的、排明天的主線，最後在「今日 › 每日覆盤」寫一句總結。儲存覆盤會自動勾選這一項每日任務。"],
    ["週回顧", "每週日 30 分鐘，照「本週 › 週回顧」的 5 個步驟走，並切到下一週把任務排進每一天。"],
    ["一天的分界", `凌晨 ${DAY_ROLLOVER_HOURS} 點前做的事算前一天，所以半夜覆盤不會被算到隔天。`],
    ["作息調整", sp || "依設定逐步調整就寢與起床時間。"]
  ];
  let html = win("系統規則", "Rules", rules.map((r, i) => `<div class="rule-item"><h3><span>${pad(i + 1)}</span>${esc(r[0])}</h3><p>${esc(r[1])}</p></div>`).join(""));
  const xpRows = [
    ["每日任務（閱讀、覆盤）", "各 +15"], ["徒手訓練（每項做滿 2 組）", "各 +10，做滿 3 組再 +5"], ["作息（準時上床、準時起床）", "各 +10"],
    ["核心每日任務全部完成", "+20，連續天數 +1"], ["主線步驟（25／50／90 分鐘）", "+20／+40／+70"], ["拆分時已完成的部分", "該步驟的一半"],
    ["整個任務完成", "再 +30"], ["週目標完成", "+50"], ["每週指標達成", "各 +30"], ["完成週回顧", "+40"], ["月目標完成", "+100"], ["每月指標達成", "各 +50"], ["本季新興趣接觸", "+80"]
  ];
  html += win("經驗值", "XP Table", `<div class="tblwrap"><table class="tbl"><thead><tr><th>行動</th><th>經驗值</th></tr></thead><tbody>${xpRows.map(r => `<tr><td>${esc(r[0])}</td><td class="num">${esc(r[1])}</td></tr>`).join("")}</tbody></table></div>
    <p class="hint" style="margin-top:10px">升級門檻：Lv.N 升到 Lv.N+1 需要的累積經驗值是 50 × N × (N+1)。領域數值＝該領域累積經驗值 ÷ 10。評級：Lv.1–4 E 級、5–9 D 級、10–19 C 級、20–34 B 級、35–49 A 級、50 以上 S 級。</p>`);
  const sync = lastLoad ? new Date(lastLoad) : null;
  html += win("資料", "Data", `<div class="foot">
      <span>版本 ${VERSION} · ${store.mode === "demo" ? "展示模式（不儲存）" : `已連線 Supabase${sync ? ` · 上次同步 ${pad(sync.getHours())}:${pad(sync.getMinutes())}` : ""}`}</span>
      <span class="row-actions"><button class="btn sm" data-act="reload">重新同步</button><button class="btn sm" data-act="export">匯出全部資料（JSON）</button>${store.mode === "demo" ? "" : `<button class="btn ghost sm" data-act="signout">登出</button>`}</span>
    </div><p class="hint" style="margin-top:8px">每日任務、上限、固定行程這些設定存在 Supabase 的 settings 表（config 欄位）。</p>`);
  return html;
}

/* ================= actions ================= */
const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
function closePanel() { UI.panel = null; }
function afterQuest(before) { const after = dayScore(getDay(todayKey()), C()).coreAll; if (!before && after) { UI.justCleared = true; toast("每日任務完成", "核心每日任務全部達成，額外 +20 XP"); } }

const ACT = {
  tab(el) { UI.tab = el.dataset.v; UI.panel = null; try { localStorage.setItem("rex-tab", UI.tab); } catch (e) {} window.scrollTo({ top: 0 }); },
  "dq-toggle"(el) {
    const tk = todayKey(), id = el.dataset.id, cfg = C();
    const before = dayScore(getDay(tk), cfg).coreAll;
    const on = getDay(tk).dq[id] ? 0 : 1;
    setQuest(tk, id, on);
    const q = cfg.dailies.find(x => x.id === id);
    if (on && q) toast("通知", `${q.label} 完成，+${q.xp} XP`);
    afterQuest(before);
  },
  "dq-set"(el) {
    const tk = todayKey(), id = el.dataset.id, n = +el.dataset.n, cfg = C();
    const before = dayScore(getDay(tk), cfg).coreAll;
    const cur = +getDay(tk).dq[id] || 0;
    const next = cur === n ? n - 1 : n;
    setQuest(tk, id, next);
    const q = cfg.dailies.find(x => x.id === id);
    if (q && next >= (q.min || 1) && cur < (q.min || 1)) toast("通知", `${q.label} 達標，+${q.xp} XP`);
    afterQuest(before);
  },
  energy(el) { const n = +el.dataset.v, tk = todayKey(); setMeta(tk, { energy: getMeta(tk).energy === n ? null : n }); },
  panel(el) { const { id, kind } = el.dataset; UI.panel = (UI.panel && UI.panel.id === id && UI.panel.kind === kind) ? null : { id, kind }; },
  "panel-close"() { closePanel(); },
  "timer-start"(el) { const id = el.dataset.id; UI.overNotified.delete(id); saveTask(id, { startedAt: nowIso() }, { kind: "start", estMin: S.tasks[id].estMin }); },
  "timer-stop"(el) { const id = el.dataset.id, t = S.tasks[id]; const m = Math.round(elapsedMin(t)); saveTask(id, { startedAt: null, accumMin: m }, { kind: "stop", detail: `這一步累積 ${m} 分` }); },
  "plan-today"(el) {
    const id = el.dataset.id, tk = todayKey();
    const n = plannedOn(tk).filter(t => t.id !== id).length;
    saveTask(id, { plannedDate: tk, status: "week" }, { kind: "plan", toDate: tk });
    if (n >= capOf(tk)) toast("提醒", `今天已經排了 ${n} 件，超過上限 ${capOf(tk)} 件。`, "bad");
  },
  unplan(el) { const id = el.dataset.id; saveTask(id, Object.assign({ plannedDate: null }, pauseTimer(S.tasks[id])), { kind: "unplan" }); },
  "to-week"(el) { saveTask(el.dataset.id, { status: "week" }, { kind: "to_week" }); toast("通知", "已加入本週清單。到「本週 › 任務排程」排日期。"); },
  "to-backlog"(el) { const id = el.dataset.id; saveTask(id, Object.assign({ status: "backlog", plannedDate: null }, pauseTimer(S.tasks[id])), { kind: "to_backlog" }); closePanel(); },
  restore(el) { saveTask(el.dataset.id, { status: "backlog", plannedDate: null, dropReason: null, doneDate: null }, { kind: "restore" }); },
  "flag-keep"(el) { saveTask(el.dataset.id, { flag: null }, { kind: "flag_keep" }); },
  "flag-drop"(el) { saveTask(el.dataset.id, { flag: null, status: "dropped", plannedDate: null, dropReason: "清單整理時放棄", dropDate: todayKey() }, { kind: "flag_drop" }); },
  "step-next"(el) {
    const id = el.dataset.id, t = S.tasks[id]; if (!t) return;
    const nx = val("nx-" + id);
    if (!nx) { toast("還差一步", "請先寫下新的下一步，或選「整個任務完成」。", "bad"); return; }
    const xp = STEP_XP[t.estMin || 25] || 20;
    const ev = { kind: "step", xp, estMin: t.estMin || 25, actualMin: settleMin(t), detail: t.next || "" };
    saveTask(id, { next: nx, estMin: +val("ne-" + id) || 25, plannedDate: null, status: "week", deferCount: 0, flag: null, startedAt: null, accumMin: 0 }, ev);
    closePanel(); toast("步驟完成", `+${xp} XP　下一步已更新，任務回到本週清單。`);
  },
  "step-finish"(el) {
    const id = el.dataset.id, t = S.tasks[id]; if (!t) return;
    const xp = STEP_XP[t.estMin || 25] || 20, tk = todayKey();
    const ev = { kind: "step", xp, estMin: t.estMin || 25, actualMin: settleMin(t), detail: t.next || "" };
    saveTask(id, { status: "done", doneDate: tk, plannedDate: null, flag: null, startedAt: null, accumMin: 0 }, ev);
    logEvent(id, { kind: "finish", xp: 30, detail: "任務完成" });
    closePanel(); toast("任務完成", `${t.title}　+${xp + 30} XP`);
  },
  extend(el) { saveTask(el.dataset.id, { extDate: todayKey() }, { kind: "extend" }); closePanel(); toast("通知", `已延長 ${EXTEND_MIN} 分鐘。時間到還沒完成，就拆分或改期。`); },
  split(el) {
    const id = el.dataset.id, t = S.tasks[id]; if (!t) return;
    const nx = val("sn-" + id);
    if (!nx) { toast("還差一步", "請寫下剩下的下一步。", "bad"); return; }
    const half = Math.round((STEP_XP[t.estMin || 25] || 20) / 2);
    const ev = { kind: "split", xp: half, estMin: t.estMin || 25, actualMin: settleMin(t), detail: val("sd-" + id) || t.next || "" };
    saveTask(id, { next: nx, estMin: +val("se-" + id) || 25, plannedDate: null, status: "week", deferCount: 0, startedAt: null, accumMin: 0 }, ev);
    closePanel(); toast("已拆分", `+${half} XP　剩下的步驟回到本週清單。`);
  },
  defer(el) {
    const id = el.dataset.id, t = S.tasks[id]; if (!t) return;
    const d = val("dd-" + id);
    if (!d) { toast("還差一步", "改期一定要選日期。", "bad"); return; }
    const dc = (t.deferCount || 0) + (t.plannedDate ? 1 : 0);
    saveTask(id, Object.assign({ plannedDate: d, status: "week", deferCount: dc }, pauseTimer(t)), { kind: t.plannedDate ? "defer" : "plan", toDate: d, detail: t.plannedDate ? `原本排在 ${t.plannedDate}` : null });
    closePanel();
    const n = plannedOn(d).filter(x => x.id !== id).length;
    toast("已排日期", `${mdw(d)}${n >= capOf(d) ? `　這天已有 ${n} 件，超過上限。` : ""}`, n >= capOf(d) ? "bad" : "");
  },
  drop(el) {
    const id = el.dataset.id, r = val("dr-" + id);
    if (!r) { toast("還差一步", "放棄前寫一句原因，之後回顧時用得到。", "bad"); return; }
    saveTask(id, { status: "dropped", plannedDate: null, dropReason: r, dropDate: todayKey(), flag: null, startedAt: null, accumMin: 0 }, { kind: "drop", detail: r });
    closePanel(); toast("已放棄", "任務移到「已放棄」，需要時可以放回任務庫。");
  },
  "edit-save"(el) {
    const id = el.dataset.id, title = val("et-" + id);
    if (!title) { toast("還差一步", "任務名稱不能空白。", "bad"); return; }
    saveTask(id, { title, next: val("en-" + id), area: val("ea-" + id), estMin: +val("ee-" + id) || 25, due: val("ed-" + id) || null, note: val("eo-" + id) }, { kind: "edit" });
    closePanel(); toast("通知", "已儲存。");
  },
  "goal-add"(el) {
    const { scope, key } = el.dataset;
    const text = val(`${scope}-goal-text`), area = val(`${scope}-goal-area`);
    if (!text) { toast("還差一步", "請先寫下目標內容。", "bad"); return; }
    putGoal(uid(), { scope, periodKey: key, area, text, done: false, suggested: false, doneAt: null, createdAt: nowIso() });
  },
  "goal-toggle"(el) {
    const id = el.dataset.gid, g = S.goals[id]; if (!g) return;
    const done = !g.done;
    putGoal(id, Object.assign({}, g, { done, suggested: false, doneAt: done ? nowIso() : null }));
    if (done) toast("目標達成", `+${g.scope === "month" ? 100 : 50} XP`);
  },
  "goal-confirm"(el) { const id = el.dataset.gid, g = S.goals[id]; if (g) putGoal(id, Object.assign({}, g, { suggested: false })); },
  "goal-del"(el) { delGoal(el.dataset.gid); },
  count(el) {
    const { scope, key, tid } = el.dataset, d = +el.dataset.d;
    const t = ((scope === "week" ? C().weekTargets : C().monthTargets) || []).find(x => x.id === tid);
    const k = ctrKey(scope, key, tid), before = +S.counters[k] || 0, after = Math.max(0, before + d);
    if (after === before) return;
    S.counters[k] = after;
    track(store.putCounter(scope, key, tid, after));
    track(store.addCounterEvent({ at: nowIso(), logDate: todayKey(), scope, periodKey: key, targetId: tid, delta: after - before }));
    if (t && before < t.target && after >= t.target) toast("指標達成", `${t.label}　+${scope === "week" ? 30 : 50} XP`);
  },
  "review-step"(el) { const key = el.dataset.key, i = +el.dataset.i, r = Object.assign({}, getReview(key)); r.steps = (r.steps || []).slice(); r.steps[i] = !r.steps[i]; putReview(key, r); },
  "review-note"(el) { const key = el.dataset.key; putReview(key, Object.assign({}, getReview(key), { note: val("rv-note-" + key) })); toast("通知", "觀察已儲存。"); },
  "review-done"(el) {
    const key = el.dataset.key, r = getReview(key), done = !r.done;
    putReview(key, Object.assign({}, r, { done, doneAt: done ? nowIso() : null }));
    if (done) toast("週回顧完成", "+40 XP");
  },
  "nav-week"(el) { UI.weekOffset += +el.dataset.d; },
  "nav-month"(el) { UI.monthOffset += +el.dataset.d; },
  "interest-save"(el) { const k = el.dataset.key; putQuarter(k, Object.assign({}, getQuarter(k), { interest: val("qi-" + k) })); toast("通知", "已儲存。"); },
  "interest-done"(el) { const k = el.dataset.key, q = getQuarter(k); putQuarter(k, Object.assign({}, q, { done: !q.done })); if (!q.done) toast("新興趣", "+80 XP"); },
  "f-area"(el) { UI.fArea = el.dataset.v; },
  "f-status"(el) { UI.fStatus = el.dataset.v; },
  reload() { load(true); },
  update() { location.reload(); },
  export() {
    const blob = new Blob([JSON.stringify({ exportedAt: nowIso(), ...S }, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `solo-leveling-${todayKey()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  async signout() { await store.signOut(); S = emptyState(); loaded = false; showLogin(); }
};

document.addEventListener("click", e => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const fn = ACT[el.dataset.act];
  if (!fn) return;
  e.preventDefault();
  const r = fn(el);
  if (r && r.then) r.then(() => render(true)); else render(true);
});
document.addEventListener("change", e => {
  const el = e.target.closest("[data-change]");
  if (!el) return;
  if (el.dataset.change === "plan-date" && el.value) {
    const id = el.dataset.id, d = el.value;
    const n = plannedOn(d).filter(t => t.id !== id).length;
    saveTask(id, { plannedDate: d, status: "week" }, { kind: "plan", toDate: d });
    if (n >= capOf(d)) toast("提醒", `${mdw(d)} 已有 ${n} 件，超過上限 ${capOf(d)} 件。`, "bad");
    render(true);
  }
  if (el.dataset.change === "meta") {
    const tk = todayKey(), f = el.dataset.f, v = el.value;
    setMeta(tk, { [f]: v });
    const target = sleepTarget(tk), cfg = C();
    const qid = f === "bed" ? "sleep" : "wake";
    if (v && target && cfg.dailies.some(q => q.id === qid)) {
      const before = dayScore(getDay(tk), cfg).coreAll;
      const ok = f === "bed" ? bedMins(v) <= bedMins(target.bed) : minsOf(v) <= minsOf(target.wake);
      if ((+getDay(tk).dq[qid] || 0) !== (ok ? 1 : 0)) setQuest(tk, qid, ok ? 1 : 0);
      afterQuest(before);
    }
    render(true);
  }
});
document.addEventListener("submit", async e => {
  e.preventDefault();
  if (e.target.id === "loginForm") return doLogin();
  if (e.target.id === "reviewForm") return saveReview(e.target);
  if (e.target.id !== "addForm") return;
  const title = val("na-title");
  if (!title) { toast("還差一步", "請先填任務名稱。", "bad"); return; }
  const id = uid(), tk = todayKey(), where = val("na-where") || "backlog";
  saveTask(id, { title, next: val("na-next"), area: val("na-area"), estMin: +val("na-est") || 25, due: val("na-due") || null,
    status: where, plannedDate: null, source: "面板新增", tags: [], deferCount: 0, flag: null, note: "", accumMin: 0, startedAt: null, createdDate: tk }, { kind: "create" });
  toast("通知", `已加入${where === "week" ? "本週清單" : "任務庫"}：${title}`);
  e.target.reset();
  render(true);
});
window.addEventListener("hashchange", () => { if (/^#(today|week|month|backlog|rules)$/.test(location.hash)) { UI.tab = location.hash.slice(1); render(true); } });

/* ================= auth & loading ================= */
function showLogin() { $("#app").hidden = true; $("#login").hidden = false; $("#li-err").textContent = ""; }
function showApp() { $("#login").hidden = true; $("#app").hidden = false; $("#modeTag").hidden = store.mode !== "demo"; }
async function doLogin() {
  const btn = $("#li-btn"), err = $("#li-err");
  btn.disabled = true; err.textContent = "";
  try {
    await store.signIn(val("li-email"), $("#li-pw").value);
    showApp(); await load(true);
  } catch (e) {
    const m = String((e && e.message) || "");
    err.textContent = /invalid/i.test(m) ? "Email 或密碼不正確。"
      : /fetch|network/i.test(m) ? "連不上資料庫。確認網路連線後再試一次。"
      : `登入失敗：${m || "請稍後再試"}`;
  } finally { btn.disabled = false; }
}
async function load(force) {
  if (!force && (pending > 0 || Date.now() - lastLoad < 15000)) return;
  if (store.mode === "demo" && loaded && !force) return;
  try {
    S = await store.loadAll();
    loaded = true; loadError = null; lastLoad = Date.now();
  } catch (e) {
    if (isAuthError(e)) { showLogin(); return; }
    loadError = (e && e.message) || "未知錯誤";
  }
  render(true);
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  checkVersion();
  if (!$("#app").hidden) load(false);
});
// 手機主畫面開著的頁面切回來時不會重新載入，所以主動比對 version.json，有新版就提示重新載入
async function checkVersion() {
  try {
    const r = await fetch(`version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!r.ok) return;
    const { version } = await r.json();
    if (version && version !== VERSION && UI.newVersion !== version) { UI.newVersion = version; renderBanner(); }
  } catch (e) {}
}

function tick() {
  const now = new Date();
  $("#clock").textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  if (!loaded) return;
  const running = tasksList().filter(t => t.startedAt && isOpen(t));
  for (const t of running) if (elapsedMin(t) >= limitMin(t) && !UI.overNotified.has(t.id)) {
    UI.overNotified.add(t.id);
    toast("時間到", `「${t.title}」已到預估時間。按「超時／卡住」選擇延長、拆分、改期或放棄。`, "bad");
  }
  if (running.length && UI.tab === "today") scheduleRender();
}
setInterval(tick, 30000);

(async function boot() {
  tick();
  checkVersion();
  if (store.mode === "demo") { showApp(); await load(true); return; }
  let s = null;
  try { s = await store.session(); } catch (e) { s = null; }
  if (s) { showApp(); render(true); await load(true); } else showLogin();
  if (store.onAuthChange) store.onAuthChange(ev => { if (ev === "SIGNED_OUT") showLogin(); });
})();
