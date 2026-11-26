// 展示模式用的範例資料（js/config.js 沒有填 Supabase 設定時才會用到）。
// 這個檔案會放在公開的 repo，所以只放通用範例，不放任何個人資料。

const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const DEFAULT_CONFIG = {
  playerName: "PLAYER",
  startDate: null,
  resetDays: 14,
  focus: [],
  dailies: [
    { id: "stretch", label: "伸展", detail: "10 分鐘", type: "check", xp: 15, area: "body", core: true },
    { id: "plank", label: "平板支撐", detail: "1 分鐘 × 2–3 組", type: "sets", sets: 3, min: 2, xp: 10, area: "body", core: true },
    { id: "learn", label: "學習", detail: "15 分鐘", type: "check", xp: 15, area: "career", core: true },
    { id: "review", label: "晚間覆盤", detail: "勾完成、整理想法收件匣、處理沒做完的、排明天（5–10 分鐘）", type: "check", xp: 15, area: "life", core: true }
  ],
  caps: { "0": 1, "1": 1, "2": 1, "3": 2, "4": 2, "5": 2, "6": 2 },
  dayNotes: {},
  fixed: [],
  timeBlocks: [],
  weekTargets: [],
  monthTargets: [],
  sleepPlan: [],
  longGoals: []
};

export function demoState() {
  const now = new Date(Date.now() - 4 * 3600 * 1000);
  const today = ymd(now);
  const config = Object.assign({}, DEFAULT_CONFIG, {
    playerName: "DEMO",
    startDate: today,
    focus: ["career", "life"],
    dailies: DEFAULT_CONFIG.dailies.concat([
      { id: "sleep", label: "昨晚準時上床", detail: "", type: "check", xp: 10, area: "body", core: false },
      { id: "wake", label: "今早準時起床", detail: "", type: "check", xp: 10, area: "body", core: false }
    ]),
    sleepPlan: [{ from: today, bed: "23:30", wake: "07:00" }],
    weekTargets: [
      { id: "walk", label: "散步 30 分鐘", target: 3, stretch: 5, unit: "次", area: "body" },
      { id: "friends", label: "和朋友見面", target: 1, unit: "次", area: "life" }
    ],
    monthTargets: [{ id: "book", label: "讀完一本書", target: 1, unit: "本", area: "career" }],
    fixed: [{ dow: [3], time: "19:00–20:00", label: "運動課（範例）", short: "運動", strip: true }],
    longGoals: [{ area: "body", text: "範例：建立固定的運動習慣" }]
  });
  const mk = (title, area, next, estMin, status, extra = {}) => Object.assign({
    title, area, next, estMin, status, plannedDate: null, due: null, source: "範例", tags: [], note: "", flag: null,
    deferCount: 0, extDate: null, startedAt: null, accumMin: 0, doneDate: null, dropReason: null, dropDate: null,
    createdDate: today, touchedDate: today
  }, extra);
  return {
    config,
    tasks: {
      d1: mk("範例：寫好提案第一版", "career", "列出要回答的三個問題", 50, "week", { plannedDate: today }),
      d2: mk("範例：整理每月預算表", "invest", "列出固定支出", 25, "week"),
      d3: mk("範例：找一堂想上的運動課", "body", "查兩個可以的時段", 25, "backlog"),
      d4: mk("範例：一個逾期很久的舊項目", "life", "決定是否保留", 25, "backlog", { flag: "建議刪除：範例標記" })
    },
    events: [],
    days: { [today]: { dq: { stretch: 1, plank: 2 } } },
    meta: {},
    goals: {},
    counters: {},
    reviews: {},
    quarters: {},
    ideas: {
      n1: { body: "範例：記帳可以先只分三大類，細項月底再整理", area: "invest", status: "inbox", hint: "", taskIds: [], noteRef: "", capturedAt: new Date(Date.now() - 3 * 3600e3).toISOString(), logDate: today, processedAt: null },
      n2: { body: "範例：開會前先寫下三個想問的問題，可以整理成一則筆記", area: "career", status: "inbox", hint: "", taskIds: [], noteRef: "", capturedAt: new Date(Date.now() - 26 * 3600e3).toISOString(), logDate: today, processedAt: null },
      n3: { body: "範例：番茄鐘 25 分鐘太短，試試 50 分鐘一段", area: "life", status: "note", hint: "寫成一則知識點，附一個例子", taskIds: [], noteRef: "", capturedAt: new Date(Date.now() - 50 * 3600e3).toISOString(), logDate: today, processedAt: new Date(Date.now() - 49 * 3600e3).toISOString() }
    }
  };
}
