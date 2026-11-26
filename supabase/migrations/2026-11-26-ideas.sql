-- 2026-11-26：新增「想法收件匣」
-- 用法：在 Supabase SQL Editor 貼上整份，按 Run。重複執行是安全的。
-- 內容：
--   1. 新增 ideas 表：隨手記下的想法，之後整理成「行動項目」或「記憶庫筆記」
--   2. 權限：和其他表一樣，只有登入的本人讀寫得到
--   3. 「晚間覆盤」每日任務的說明加上「整理想法收件匣」
--
-- status 的意思：
--   inbox     收件匣，還沒整理
--   note      等 Claude 寫成記憶庫筆記
--   noted     已寫進記憶庫（note_ref 記錄筆記放在哪裡）
--   action    已轉成行動項目（task_ids 記錄建立了哪些任務）
--   archived  封存，不需要後續處理

create table if not exists public.ideas (
  user_id      uuid not null references auth.users on delete cascade,
  id           text not null,
  body         text not null,
  area         text check (area in ('career','invest','life','body')),
  status       text not null default 'inbox' check (status in ('inbox','note','noted','action','archived')),
  hint         text,                         -- 交給 Claude 時留下的筆記方向
  task_ids     text[] not null default '{}', -- 轉成的行動項目（tasks.id）
  note_ref     text,                         -- 寫進記憶庫後的位置（檔名或標題）
  captured_at  timestamptz not null default now(),
  log_date     date not null,                -- 邏輯日期：凌晨 4 點前記的算前一天
  processed_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists ideas_user_status_idx on public.ideas (user_id, status, captured_at desc);

drop trigger if exists ideas_updated_at on public.ideas;
create trigger ideas_updated_at before update on public.ideas for each row execute function public.set_updated_at();

alter table public.ideas enable row level security;
revoke all on public.ideas from anon;
grant select, insert, update, delete on public.ideas to authenticated;
drop policy if exists own_rows on public.ideas;
create policy own_rows on public.ideas for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- 晚間覆盤的說明文字（只改這一項的 detail，其他每日任務和順序不動）
update public.settings
set config = jsonb_set(config, '{dailies}', (
  select jsonb_agg(
           case when d->>'id' = 'review'
                then jsonb_set(d, '{detail}', to_jsonb('勾完成、整理想法收件匣、處理沒做完的、排明天（5–10 分鐘）'::text))
                else d end
           order by ord)
  from jsonb_array_elements(config->'dailies') with ordinality as t(d, ord)
))
where config ? 'dailies';

-- 讓資料庫的 API 立刻認得新表
notify pgrst, 'reload schema';

-- 檢查：應該看到 ideas 表的筆數（第一次是 0）和更新後的晚間覆盤說明
select (select count(*) from public.ideas) as 想法筆數,
       (select d->>'detail' from public.settings, jsonb_array_elements(config->'dailies') d where d->>'id' = 'review' limit 1) as 晚間覆盤說明;
