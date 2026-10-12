# Solo Leveling

Rex 的每日、每週、每月任務面板：每日任務、主線任務上限、計時與超時處理、週回顧、經驗值與等級。
網站是純靜態檔案（放在 GitHub Pages），資料存在 Supabase（PostgreSQL），用 email＋密碼登入。

## 資料夾結構

| 路徑 | 內容 |
| --- | --- |
| `index.html`、`styles.css` | 頁面骨架與樣式 |
| `js/app.js` | 畫面與操作邏輯 |
| `js/store.js` | 資料讀寫（只有這個檔案知道 Supabase 的存在；換資料庫只要改它） |
| `js/config.js` | Supabase 專案網址與 publishable key；留空會用範例資料跑「展示模式」 |
| `js/demo-data.js` | 展示模式的範例資料（只放通用範例） |
| `supabase/schema.sql` | 建表、權限（Row Level Security） |
| `vendor/supabase.js` | supabase-js 2.116.0 瀏覽器版（MIT，授權見 `vendor/supabase-LICENSE`） |

## 隱私規則

- 這個 repo 是公開的。**任何個人資料都不放進 repo**：資料搬移 SQL、匯出的 JSON 都放在 `private/`（已列在 `.gitignore`）。
- `js/config.js` 只放 publishable key（開頭 `sb_publishable_`）。它本來就是給瀏覽器用的，資料能不能讀到由資料庫的權限決定：每張表都開了 Row Level Security，登入的人只讀寫得到自己的列。
- secret key（開頭 `sb_secret_`）絕對不放在這裡或任何前端程式。
- Supabase 的 Authentication 要關掉「允許新使用者註冊」，只保留自己的帳號。

## 第一次設定

1. 在 Supabase 專案的 SQL Editor 貼上 `supabase/schema.sql` 執行。
2. 在 Authentication 建立自己的帳號，關掉新使用者註冊。
3. 把 Project URL 和 publishable key 填進 `js/config.js`。
4. 推到 GitHub，在 repo 的 Settings → Pages 選 `main` 分支、根目錄。網址會是 https://summonerrex.github.io/sololeveling/

## 資料表

狀態表（目前的樣子）：`settings`、`tasks`、`daily_quests`、`day_meta`、`goals`、`counters`、`reviews`、`quarters`
事件表（只新增、不修改，留給分析）：`task_events`、`counter_events`

`log_date` 是邏輯日期：凌晨 4 點前發生的事算前一天。`day_meta.bed_time` 是「這天早上之前那一晚」的上床時間。

`day_meta` 的每日覆盤欄位：`summary` 一句話總結、`reflection` 感想、`blockers` 卡住的原因代碼（`long_list` 清單太長、`too_big` 事情太大沒拆、`no_slot` 沒排時段、`low_energy` 精神體力不好、`interrupted` 被打斷、`perfection` 想做到完美而拖延、`forgot` 忘記回來看、`other` 其他）、`satisfaction` 滿意度 1–5。

## 資料庫更新紀錄

新增欄位時會在 `supabase/migrations/` 放一份 SQL，在 Supabase SQL Editor 執行一次即可。`schema.sql` 也會同步更新，新建專案只要跑 `schema.sql`。

| 日期 | 檔案 | 內容 |
| --- | --- | --- |
| 2026-10-13 | `migrations/2026-10-13-day-review.sql` | 每日覆盤欄位 |

## 分析範例（在 Supabase SQL Editor 執行）

預估時間準不準：

```sql
select est_min as 預估分鐘, count(*) as 步驟數,
       round(avg(actual_min)) as 平均實際分鐘,
       round(avg(actual_min::numeric / est_min), 2) as 實際除以預估
from task_events
where kind in ('step', 'split') and actual_min is not null
group by est_min order by est_min;
```

星期幾最容易做完每日任務：

```sql
with d as (
  select log_date, count(*) filter (where value > 0) as done
  from daily_quests group by log_date
)
select to_char(log_date, 'ID') as 星期, round(avg(done), 1) as 平均完成項數, count(*) as 天數
from d group by 1 order by 1;
```

睡眠、精神和當天完成的步驟數：

```sql
select m.log_date, m.bed_time, m.wake_time, m.energy,
       count(e.id) filter (where e.kind in ('step', 'split')) as 完成步驟
from day_meta m
left join task_events e on e.user_id = m.user_id and e.log_date = m.log_date
group by 1, 2, 3, 4 order by 1;
```

最常被改期的任務：

```sql
select t.title, count(*) as 改期次數
from task_events e
join tasks t on t.user_id = e.user_id and t.id = e.task_id
where e.kind = 'defer'
group by t.title order by 改期次數 desc limit 10;
```

最常卡住的原因：

```sql
select b as 原因代碼, count(*) as 天數
from day_meta, unnest(blockers) as b
group by b order by 天數 desc;
```

滿意度和當天完成的步驟數：

```sql
with s as (
  select user_id, log_date, count(*) filter (where kind in ('step', 'split')) as steps
  from task_events group by 1, 2
)
select m.satisfaction as 滿意度, count(*) as 天數, round(avg(coalesce(s.steps, 0)), 1) as 平均完成步驟
from day_meta m left join s using (user_id, log_date)
where m.satisfaction is not null
group by 1 order by 1;
```

匯出每日覆盤文字（做質化分析或交給 AI 歸納）：

```sql
select log_date, satisfaction, blockers, summary, reflection
from day_meta
where summary is not null or reflection is not null
order by log_date;
```
