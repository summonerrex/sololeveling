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
    { id: "read", label: "閱讀", detail: "至少 20 分鐘", type: "check", xp: 15, area: "life", core: true },
    { id: "pushup", label: "伏地挺身", detail: "30 下 × 2–3 組", type: "sets", sets: 3, min: 2, xp: 10, area: "body", core: true },
    { id: "crunch", label: "捲腹", detail: "20 下 × 2–3 組", type: "sets", sets: 3, min: 2, xp: 10, area: "body", core: true },
    { id: "squat", label: "深蹲", detail: "20 下 × 2–3 組", type: "sets", sets: 3, min: 2, xp: 10, area: "body", core: true },
    { id: "abwheel", label: "滾輪", detail: "1–2 組", type: "sets", sets: 2, min: 1, xp: 10, area: "body", core: true },
    { id: "review", label: "晚間覆盤", detail: "勾完成、處理沒做完的、排明天（5–10 分鐘）", type: "check", xp: 15, area: "life", core: true }
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
    focus: ["career", "invest"],
    dailies: DEFAULT_CONFIG.dailies.concat([
      { id: "sleep", label: "昨晚準時上床", detail: "", type: "check", xp: 10, area: "body", core: false },
      { id: "wake", label: "今早準時起床", detail: "", type: "check", xp: 10, area: "body", core: false }
    ]),
    sleepPlan: [{ from: today, bed: "01:00", wake: "07:30" }],
    weekTargets: [
      { id: "gym", label: "健身", target: 2, stretch: 3, unit: "次", area: "body" },
      { id: "game", label: "玩喜歡的遊戲 2 小時以上", target: 2, unit: "次", area: "life" }
    ],
    monthTargets: [{ id: "seminar", label: "研討會或講座", target: 2, unit: "場", area: "career" }],
    fixed: [{ dow: [1], time: "21:00–23:00", label: "健身（範例）", short: "健身", strip: true }],
    longGoals: [{ area: "body", text: "範例：三年內建立固定的運動習慣" }]
  });
  const mk = (title, area, next, estMin, status, extra = {}) => Object.assign({
    title, area, next, estMin, status, plannedDate: null, due: null, source: "範例", tags: [], note: "", flag: null,
    deferCount: 0, extDate: null, startedAt: null, accumMin: 0, doneDate: null, dropReason: null, dropDate: null,
    createdDate: today, touchedDate: today
  }, extra);
  return {
    config,
    tasks: {
      d1: mk("範例：寫一頁作品規格", "career", "列出問題、資料來源和分析方法", 50, "week", { plannedDate: today }),
      d2: mk("範例：整理每日交易流程", "invest", "寫下每天要看的 5 個資訊來源", 25, "week"),
      d3: mk("範例：預約健康檢查", "body", "查兩家診所的時段", 25, "backlog"),
      d4: mk("範例：一個逾期很久的舊項目", "life", "決定是否保留", 25, "backlog", { flag: "建議刪除：範例標記" })
    },
    events: [],
    days: { [today]: { dq: { read: 1, pushup: 2 } } },
    meta: {},
    goals: {},
    counters: {},
    reviews: {},
    quarters: {}
  };
}
