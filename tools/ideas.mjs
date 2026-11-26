#!/usr/bin/env node
// Solo Leveling 想法收件匣：給 Claude Code（或你自己）在終端機使用的工具。
// 需要 Node.js 18 以上，不需要安裝任何套件。
//
// 第一次使用（請自己在終端機執行，密碼不要交給 Claude）：
//   node ideas.mjs login
// 之後：
//   node ideas.mjs list                     列出「等 Claude 寫成筆記」的想法（預設）
//   node ideas.mjs list --status inbox      列出收件匣（未整理）；也可用 note / noted / action / archived / all
//   node ideas.mjs list --json              以 JSON 輸出
//   node ideas.mjs noted <id> --ref "<筆記位置>"     標記已寫進記憶庫
//   node ideas.mjs task <id> --title "<任務名稱>" [--next "<下一步>"] [--area career|invest|life|body] [--est 25|50|90] [--week]
//                                           把想法轉成行動項目（建立任務，並把想法標記為已轉成行動項目）
//   node ideas.mjs archive <id>             封存
//   node ideas.mjs logout                   刪除本機的登入憑證
//
// 安全性：login 只把 Supabase 發的 refresh token 存在 ~/.solo-leveling/session.json（權限 600），不存密碼。
// 這個檔案等同登入狀態，不要分享或上傳。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const URL_ = process.env.SOLO_SUPABASE_URL || "https://kyjgjifjoqkhbcicyamc.supabase.co";
const KEY = process.env.SOLO_SUPABASE_KEY || "sb_publishable_0LcsmxBZB0596d0uHyC0UQ_YpCxlTR3";
const DIR = process.env.SOLO_HOME || path.join(os.homedir(), ".solo-leveling");
const SESSION = path.join(DIR, "session.json");
const AREAS = { career: "職涯", invest: "投資", life: "生活", body: "身體" };
const STATUS = { inbox: "未整理", note: "等 Claude 寫成筆記", noted: "已寫進記憶庫", action: "已轉成行動項目", archived: "已封存" };

function die(msg, code = 1) { console.error(msg); process.exit(code); }
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2), next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) out[k] = true; else { out[k] = next; i++; }
    } else out._.push(a);
  }
  return out;
}
// 邏輯日期：台北時間，凌晨 4 點前算前一天（和網站相同）
function logicalDate(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now - 4 * 3600e3));
}
function fmtTime(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

async function http(method, url, { token, body, prefer } = {}) {
  const headers = { apikey: KEY, "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (prefer) headers.Prefer = prefer;
  let res;
  try { res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
  catch (e) { die(`連不上 Supabase（${URL_}）：${e.message}。確認網路後再試一次。`); }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = text; }
  if (!res.ok) {
    const m = (data && (data.msg || data.message || data.error_description || data.error)) || text || res.statusText;
    const err = new Error(`${res.status} ${m}`); err.status = res.status; err.data = data; throw err;
  }
  return data;
}

function readSession() {
  try { return JSON.parse(fs.readFileSync(SESSION, "utf8")); } catch (e) { return null; }
}
function writeSession(s) {
  fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(SESSION, JSON.stringify(s, null, 2), { mode: 0o600 });
  try { fs.chmodSync(SESSION, 0o600); } catch (e) {}
}

function promptHidden(question) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    if (!stdin.isTTY) return reject(new Error("需要在終端機互動執行"));
    process.stdout.write(question);
    let value = "";
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding("utf8");
    const onData = ch => {
      for (const c of ch) {
        if (c === "\r" || c === "\n") { stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData); process.stdout.write("\n"); return resolve(value); }
        if (c === "\u0003") { stdin.setRawMode(false); process.stdout.write("\n"); process.exit(130); }
        if (c === "\u007f" || c === "\b") { if (value) { value = value.slice(0, -1); process.stdout.write("\b \b"); } continue; }
        value += c; process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
  });
}
function promptLine(question) {
  return new Promise(resolve => {
    process.stdout.write(question);
    let buf = "";
    process.stdin.resume(); process.stdin.setEncoding("utf8");
    const onData = d => {
      buf += d;
      const i = buf.indexOf("\n");
      if (i >= 0) { process.stdin.off("data", onData); process.stdin.pause(); resolve(buf.slice(0, i).replace(/\r$/, "").trim()); }
    };
    process.stdin.on("data", onData);
  });
}

async function login() {
  if (!process.stdin.isTTY) die("login 需要在你自己的終端機執行（要輸入密碼）。請不要讓 Claude 代為輸入密碼。");
  const email = await promptLine("Email：");
  const password = await promptHidden("密碼（不會顯示，也不會存檔）：");
  let r;
  try { r = await http("POST", `${URL_}/auth/v1/token?grant_type=password`, { body: { email, password } }); }
  catch (e) { die(/invalid/i.test(e.message) ? "Email 或密碼不正確。" : `登入失敗：${e.message}`); }
  writeSession({ refresh_token: r.refresh_token, user_id: r.user.id, email: r.user.email, saved_at: new Date().toISOString() });
  console.log(`登入成功（${r.user.email}）。憑證存在 ${SESSION}，之後的指令不用再輸入密碼。`);
}

// 每次執行用 refresh token 換一組新的 access token；Supabase 的 refresh token 用過就換新，所以要存回去。
async function auth() {
  const s = readSession();
  if (!s || !s.refresh_token) die(`還沒登入。請在你自己的終端機執行：node ${process.argv[1] ? path.basename(process.argv[1]) : "ideas.mjs"} login`, 2);
  let r;
  try { r = await http("POST", `${URL_}/auth/v1/token?grant_type=refresh_token`, { body: { refresh_token: s.refresh_token } }); }
  catch (e) { die(`登入憑證已失效（${e.message}）。請重新執行 login。`, 2); }
  writeSession(Object.assign({}, s, { refresh_token: r.refresh_token, saved_at: new Date().toISOString() }));
  return { token: r.access_token, uid: r.user.id };
}

const rest = p => `${URL_}/rest/v1/${p}`;
const enc = encodeURIComponent;
async function getIdea(a, id) {
  const rows = await http("GET", rest(`ideas?select=*&id=eq.${enc(id)}`), { token: a.token });
  if (!rows || !rows.length) die(`找不到 id 為 ${id} 的想法。`);
  return rows[0];
}
async function patchIdea(a, id, patch) {
  const rows = await http("PATCH", rest(`ideas?id=eq.${enc(id)}`), { token: a.token, body: patch, prefer: "return=representation" });
  if (!rows || !rows.length) die(`更新失敗：找不到 id 為 ${id} 的想法。`);
  return rows[0];
}

function printIdeas(rows, status) {
  if (!rows.length) { console.log(`沒有${status === "all" ? "" : `「${STATUS[status] || status}」的`}想法。`); return; }
  console.log(`# Solo Leveling 想法：${status === "all" ? "全部" : STATUS[status] || status}（${rows.length} 則）\n`);
  for (const r of rows) {
    const meta = [fmtTime(r.captured_at), r.area ? AREAS[r.area] : null, status === "all" ? STATUS[r.status] : null].filter(Boolean).join("｜");
    console.log(`## id: ${r.id}｜${meta}`);
    console.log(`內容：\n${r.body.split("\n").map(l => "> " + l).join("\n")}`);
    if (r.hint) console.log(`筆記方向：${r.hint}`);
    if (r.note_ref) console.log(`筆記位置：${r.note_ref}`);
    if (r.task_ids && r.task_ids.length) console.log(`行動項目 id：${r.task_ids.join(", ")}`);
    console.log("");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || cmd === "help" || args.help) {
    const head = fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").filter(l => l.startsWith("//")).slice(0, 18).map(l => l.slice(3)).join("\n");
    console.log(head); return;
  }
  if (cmd === "login") return login();
  if (cmd === "logout") { try { fs.unlinkSync(SESSION); } catch (e) {} console.log("已刪除本機登入憑證。"); return; }

  const a = await auth();
  if (cmd === "list") {
    const status = typeof args.status === "string" ? args.status : "note";
    if (status !== "all" && !STATUS[status]) die(`--status 只能是 ${Object.keys(STATUS).join(" / ")} / all`);
    const filter = status === "all" ? "" : `&status=eq.${status}`;
    const rows = await http("GET", rest(`ideas?select=*${filter}&order=captured_at.asc`), { token: a.token });
    if (args.json) console.log(JSON.stringify(rows, null, 2)); else printIdeas(rows, status);
    return;
  }
  const id = args._[1];
  if (!id) die("請提供想法的 id，例如：node ideas.mjs noted i1abc --ref \"notes/xxx.md\"");
  if (cmd === "noted") {
    const ref = typeof args.ref === "string" ? args.ref : "";
    if (!ref) die("請用 --ref 說明筆記放在哪裡（檔名、路徑或標題）。");
    await getIdea(a, id);
    const r = await patchIdea(a, id, { status: "noted", note_ref: ref, processed_at: new Date().toISOString() });
    console.log(`已標記為寫進記憶庫：${r.id} → ${ref}`);
    return;
  }
  if (cmd === "archive") {
    await getIdea(a, id);
    await patchIdea(a, id, { status: "archived", processed_at: new Date().toISOString() });
    console.log(`已封存：${id}`);
    return;
  }
  if (cmd === "task") {
    const idea = await getIdea(a, id);
    const title = typeof args.title === "string" ? args.title.trim() : "";
    if (!title) die("請用 --title 提供任務名稱。");
    const area = typeof args.area === "string" ? args.area : (idea.area || "life");
    if (!AREAS[area]) die("--area 只能是 career / invest / life / body");
    const est = args.est ? Number(args.est) : 25;
    if (![25, 50, 90].includes(est)) die("--est 只能是 25 / 50 / 90");
    const tid = "t" + Date.now().toString(36) + crypto.randomBytes(2).toString("hex");
    const today = logicalDate();
    await http("POST", rest("tasks"), { token: a.token, prefer: "return=minimal", body: {
      user_id: a.uid, id: tid, title, area, status: args.week ? "week" : "backlog", next_step: typeof args.next === "string" ? args.next : null,
      est_min: est, source: "想法收件匣", note: idea.body, created_date: today, touched_date: today
    } });
    await http("POST", rest("task_events"), { token: a.token, prefer: "return=minimal", body: {
      user_id: a.uid, task_id: tid, log_date: today, kind: "create", xp: 0, detail: "來自想法收件匣（Claude Code）"
    } });
    await patchIdea(a, id, { status: idea.status === "noted" ? "noted" : "action", task_ids: [...(idea.task_ids || []), tid], processed_at: new Date().toISOString() });
    console.log(`已建立行動項目：「${title}」（${AREAS[area]}，${est} 分鐘，放在${args.week ? "本週清單" : "任務庫"}），任務 id ${tid}`);
    return;
  }
  die(`不認得的指令：${cmd}。執行 node ideas.mjs help 看用法。`);
}

main().catch(e => die(`發生錯誤：${e.message}`));
