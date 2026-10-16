// 資料存取層：網站畫面只透過這個檔案讀寫資料。
// 要換資料庫（例如改用別的服務），只需要改這個檔案。
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js?v=2026-10-16.1";
import { demoState } from "./demo-data.js?v=2026-10-16.1";

// 同一筆資料的寫入依序執行，避免後送出的寫入先到。
const chains = new Map();
function serial(key, fn) {
  const prev = chains.get(key) || Promise.resolve();
  const p = prev.catch(() => {}).then(fn);
  chains.set(key, p);
  return p;
}
function check(res) {
  if (res.error) throw res.error;
  return res.data;
}
const hhmm = v => (v ? String(v).slice(0, 5) : "");

export function createStore() {
  if (SUPABASE_URL && SUPABASE_KEY && window.supabase && window.supabase.createClient) return new SupabaseStore();
  return new DemoStore();
}

export function isAuthError(err) {
  if (!err) return false;
  const s = `${err.code || ""} ${err.status || ""} ${err.message || ""}`;
  return /PGRST301|PGRST302|401|JWT|jwt|not authenticated/i.test(s);
}

/* ---------------- 展示模式：只在記憶體裡，不儲存 ---------------- */
class DemoStore {
  constructor() { this.mode = "demo"; this.reviewReady = true; }
  async session() { return { user: { id: "demo" } }; }
  async signIn() { return this.session(); }
  async signOut() {}
  async loadAll() { return demoState(); }
  async putTask() {} async addEvent() {} async putQuest() {} async putMeta() {}
  async putGoal() {} async delGoal() {} async putCounter() {} async addCounterEvent() {}
  async putReview() {} async putQuarter() {} async putConfig() {}
}

/* ---------------- Supabase ---------------- */
class SupabaseStore {
  constructor() {
    this.mode = "supabase";
    this.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    });
    this.uid = null;
  }
  async session() {
    const { data } = await this.sb.auth.getSession();
    this.uid = (data.session && data.session.user && data.session.user.id) || null;
    return data.session;
  }
  async signIn(email, password) {
    const { data, error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this.uid = data.user.id;
    return data.session;
  }
  async signOut() { await this.sb.auth.signOut(); this.uid = null; }
  onAuthChange(fn) { this.sb.auth.onAuthStateChange((event, s) => fn(event, s)); }

  async all(table) {
    const out = [];
    const size = 1000;
    for (let from = 0; ; from += size) {
      const rows = check(await this.sb.from(table).select("*").range(from, from + size - 1));
      out.push(...rows);
      if (rows.length < size) break;
    }
    return out;
  }

  async loadAll() {
    const names = ["settings", "tasks", "task_events", "daily_quests", "day_meta", "goals", "counters", "reviews", "quarters"];
    const [settings, tasks, events, dq, meta, goals, counters, reviews, quarters, probe] = await Promise.all([
      ...names.map(n => this.all(n)),
      // 確認「每日覆盤」欄位是否已建立（supabase/migrations/2026-10-13-day-review.sql）
      this.sb.from("day_meta").select("summary,reflection,blockers,satisfaction").limit(1)
    ]);
    this.reviewReady = !probe.error;
    const S = { config: null, tasks: {}, events: [], days: {}, meta: {}, goals: {}, counters: {}, reviews: {}, quarters: {} };
    if (settings[0]) S.config = settings[0].config;
    for (const r of tasks) S.tasks[r.id] = {
      title: r.title, area: r.area, status: r.status, next: r.next_step || "", estMin: r.est_min, due: r.due,
      plannedDate: r.planned_date, source: r.source, tags: r.tags || [], note: r.note || "", flag: r.flag,
      deferCount: r.defer_count, extDate: r.ext_date, startedAt: r.started_at, accumMin: r.accum_min || 0,
      doneDate: r.done_date, dropReason: r.drop_reason, dropDate: r.drop_date, createdDate: r.created_date, touchedDate: r.touched_date
    };
    S.events = events.map(r => ({
      taskId: r.task_id, at: r.at, logDate: r.log_date, kind: r.kind, xp: r.xp, estMin: r.est_min,
      actualMin: r.actual_min, toDate: r.to_date, detail: r.detail
    })).sort((a, b) => (a.at < b.at ? -1 : 1));
    for (const r of dq) { (S.days[r.log_date] = S.days[r.log_date] || { dq: {} }).dq[r.quest_id] = r.value; }
    for (const r of meta) S.meta[r.log_date] = {
      bed: hhmm(r.bed_time), wake: hhmm(r.wake_time), energy: r.energy, note: r.note || "",
      summary: r.summary || "", reflection: r.reflection || "", blockers: r.blockers || [], satisfaction: r.satisfaction ?? null
    };
    for (const r of goals) S.goals[r.id] = { scope: r.scope, periodKey: r.period_key, area: r.area, text: r.text, done: r.done, suggested: r.suggested, doneAt: r.done_at, createdAt: r.created_at };
    for (const r of counters) S.counters[`${r.scope}|${r.period_key}|${r.target_id}`] = r.value;
    for (const r of reviews) S.reviews[r.week_key] = { steps: r.steps || [], done: r.done, note: r.note || "", doneAt: r.done_at };
    for (const r of quarters) S.quarters[r.quarter_key] = { interest: r.interest || "", done: r.done };
    return S;
  }

  putTask(id, t) {
    const row = {
      user_id: this.uid, id, title: t.title, area: t.area, status: t.status, next_step: t.next || null,
      est_min: t.estMin || 25, due: t.due || null, planned_date: t.plannedDate || null, source: t.source || null,
      tags: t.tags || [], note: t.note || null, flag: t.flag || null, defer_count: t.deferCount || 0,
      ext_date: t.extDate || null, started_at: t.startedAt || null, accum_min: Math.round(t.accumMin || 0),
      done_date: t.doneDate || null, drop_reason: t.dropReason || null, drop_date: t.dropDate || null,
      created_date: t.createdDate || undefined, touched_date: t.touchedDate || null
    };
    return serial(`task:${id}`, async () => check(await this.sb.from("tasks").upsert(row, { onConflict: "user_id,id" })));
  }
  addEvent(ev) {
    const row = {
      user_id: this.uid, task_id: ev.taskId, at: ev.at, log_date: ev.logDate, kind: ev.kind, xp: ev.xp || 0,
      est_min: ev.estMin ?? null, actual_min: ev.actualMin ?? null, to_date: ev.toDate || null, detail: ev.detail || null
    };
    return serial(`task:${ev.taskId}`, async () => check(await this.sb.from("task_events").insert(row)));
  }
  putQuest(date, questId, value) {
    return serial(`dq:${date}:${questId}`, async () => check(await this.sb.from("daily_quests")
      .upsert({ user_id: this.uid, log_date: date, quest_id: questId, value }, { onConflict: "user_id,log_date,quest_id" })));
  }
  putMeta(date, m) {
    const row = { user_id: this.uid, log_date: date, bed_time: m.bed || null, wake_time: m.wake || null, energy: m.energy || null, note: m.note || null };
    if (this.reviewReady) Object.assign(row, { summary: m.summary || null, reflection: m.reflection || null, blockers: m.blockers || [], satisfaction: m.satisfaction || null });
    return serial(`meta:${date}`, async () => check(await this.sb.from("day_meta").upsert(row, { onConflict: "user_id,log_date" })));
  }
  putGoal(id, g) {
    const row = { user_id: this.uid, id, scope: g.scope, period_key: g.periodKey, area: g.area, text: g.text, done: !!g.done, suggested: !!g.suggested, done_at: g.doneAt || null };
    return serial(`goal:${id}`, async () => check(await this.sb.from("goals").upsert(row, { onConflict: "user_id,id" })));
  }
  delGoal(id) {
    return serial(`goal:${id}`, async () => check(await this.sb.from("goals").delete().eq("user_id", this.uid).eq("id", id)));
  }
  putCounter(scope, periodKey, targetId, value) {
    return serial(`ctr:${scope}:${periodKey}:${targetId}`, async () => check(await this.sb.from("counters")
      .upsert({ user_id: this.uid, scope, period_key: periodKey, target_id: targetId, value }, { onConflict: "user_id,scope,period_key,target_id" })));
  }
  addCounterEvent(e) {
    return serial("ctr-events", async () => check(await this.sb.from("counter_events").insert({
      user_id: this.uid, at: e.at, log_date: e.logDate, scope: e.scope, period_key: e.periodKey, target_id: e.targetId, delta: e.delta
    })));
  }
  putReview(key, r) {
    const row = { user_id: this.uid, week_key: key, steps: r.steps || [], done: !!r.done, note: r.note || null, done_at: r.doneAt || null };
    return serial(`review:${key}`, async () => check(await this.sb.from("reviews").upsert(row, { onConflict: "user_id,week_key" })));
  }
  putQuarter(key, q) {
    return serial(`q:${key}`, async () => check(await this.sb.from("quarters")
      .upsert({ user_id: this.uid, quarter_key: key, interest: q.interest || null, done: !!q.done }, { onConflict: "user_id,quarter_key" })));
  }
  putConfig(cfg) {
    return serial("settings", async () => check(await this.sb.from("settings").upsert({ user_id: this.uid, config: cfg }, { onConflict: "user_id" })));
  }
}
