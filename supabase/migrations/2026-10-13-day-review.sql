-- 2026-10-13：新增「每日覆盤」欄位
-- 用法：在 Supabase SQL Editor 貼上整份，按 Run。重複執行是安全的。
-- 內容：在 day_meta（每天的作息與狀態）加 4 個欄位，不會動到既有資料。
--   summary       一句話總結今天的執行狀況
--   reflection    感想與觀察（自由文字）
--   blockers      卡住的原因代碼（可複選）：long_list 清單太長 / too_big 事情太大沒拆 / no_slot 沒排時段 /
--                 low_energy 精神體力不好 / interrupted 被打斷 / perfection 想做到完美而拖延 / forgot 忘記回來看 / other 其他
--   satisfaction  今天滿意度 1–5
alter table public.day_meta add column if not exists summary text;
alter table public.day_meta add column if not exists reflection text;
alter table public.day_meta add column if not exists blockers text[] not null default '{}';
alter table public.day_meta add column if not exists satisfaction smallint check (satisfaction between 1 and 5);

-- 讓資料庫的 API 立刻認得新欄位
notify pgrst, 'reload schema';

-- 檢查：應該列出 4 個欄位
select column_name as 欄位, data_type as 型別
from information_schema.columns
where table_schema = 'public' and table_name = 'day_meta'
  and column_name in ('summary', 'reflection', 'blockers', 'satisfaction')
order by column_name;
