-- Rex 任務面板：Supabase 資料庫結構
-- 用法：在 Supabase 專案的 SQL Editor 貼上整份檔案，按 Run。重複執行是安全的（已存在的表不會被覆蓋）。
--
-- 設計原則
-- 1. 每張表都有 user_id，並開啟 Row Level Security：登入的人只讀寫得到自己的資料。
-- 2. 「目前狀態」和「發生過的事」分開存：
--      狀態表：tasks、daily_quests、day_meta、goals、counters、reviews、quarters、settings
--      事件表：task_events、counter_events（只新增、不修改，留給之後做量化分析）
-- 3. log_date 是「邏輯日期」：凌晨 4 點前發生的事算前一天。

-- ---------- 共用：自動更新 updated_at ----------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- 設定（每日任務定義、上限、固定行程、長期目標等） ----------
create table if not exists public.settings (
  user_id    uuid primary key references auth.users on delete cascade,
  config     jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ---------- 任務（目前狀態） ----------
create table if not exists public.tasks (
  user_id      uuid not null references auth.users on delete cascade,
  id           text not null,
  title        text not null,
  area         text not null check (area in ('career','invest','life','body')),
  status       text not null default 'backlog' check (status in ('backlog','week','done','dropped')),
  next_step    text,
  est_min      int  not null default 25 check (est_min > 0),
  due          date,
  planned_date date,
  source       text,
  tags         text[] not null default '{}',
  note         text,
  flag         text,
  defer_count  int  not null default 0,
  ext_date     date,          -- 最近一次「延長 25 分鐘」的日期
  started_at   timestamptz,   -- 計時中的開始時間；沒在計時是 null
  accum_min    int  not null default 0,  -- 這一步已累積、但尚未結算的分鐘數
  done_date    date,
  drop_reason  text,
  drop_date    date,
  created_date date not null default current_date,
  touched_date date,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists tasks_user_status_idx on public.tasks (user_id, status);

-- ---------- 任務事件（只新增） ----------
-- kind：create 新增、to_week 加入本週、to_backlog 放回任務庫、plan 排日期、unplan 移出今天、
--       start 開始計時、stop 停止計時、extend 延長、step 完成一步、split 拆分、finish 整個任務完成的額外獎勵、
--       defer 改期、drop 放棄、restore 恢復、edit 編輯、flag_keep 保留、flag_drop 清單整理時放棄
create table if not exists public.task_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade,
  task_id    text not null,
  at         timestamptz not null default now(),
  log_date   date not null,
  kind       text not null,
  xp         int  not null default 0,
  est_min    int,            -- 這一步原本的預估分鐘數
  actual_min int,            -- 計時器量到的實際分鐘數（有計時才有）
  to_date    date,           -- 改期或排日期的目標日期
  detail     text,
  foreign key (user_id, task_id) references public.tasks (user_id, id) on delete cascade
);
create index if not exists task_events_user_date_idx on public.task_events (user_id, log_date);
create index if not exists task_events_task_idx on public.task_events (user_id, task_id);

-- ---------- 每日任務（每天每項一列） ----------
-- value：勾選型 0/1；組數型是完成的組數
create table if not exists public.daily_quests (
  user_id    uuid not null references auth.users on delete cascade,
  log_date   date not null,
  quest_id   text not null,
  value      int  not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, log_date, quest_id)
);

-- ---------- 每天的作息與狀態 ----------
-- bed_time：這天早上之前那一晚的上床時間；wake_time：這天早上起床時間
create table if not exists public.day_meta (
  user_id    uuid not null references auth.users on delete cascade,
  log_date   date not null,
  bed_time   time,
  wake_time  time,
  energy     smallint check (energy between 1 and 5),
  note       text,
  updated_at timestamptz not null default now(),
  primary key (user_id, log_date)
);

-- ---------- 週目標、月目標 ----------
create table if not exists public.goals (
  user_id    uuid not null references auth.users on delete cascade,
  id         text not null,
  scope      text not null check (scope in ('week','month')),
  period_key text not null,       -- 週：2026-W42；月：2026-10
  area       text not null check (area in ('career','invest','life','body')),
  text       text not null,
  done       boolean not null default false,
  suggested  boolean not null default false,
  done_at    timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index if not exists goals_period_idx on public.goals (user_id, scope, period_key);

-- ---------- 每週、每月指標（目前數值） ----------
create table if not exists public.counters (
  user_id    uuid not null references auth.users on delete cascade,
  scope      text not null check (scope in ('week','month')),
  period_key text not null,
  target_id  text not null,
  value      int  not null default 0 check (value >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, scope, period_key, target_id)
);

-- ---------- 指標事件（只新增：每次按 ＋／− 都留一筆，看得出是星期幾做的） ----------
create table if not exists public.counter_events (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade,
  at         timestamptz not null default now(),
  log_date   date not null,
  scope      text not null,
  period_key text not null,
  target_id  text not null,
  delta      int  not null
);
create index if not exists counter_events_user_date_idx on public.counter_events (user_id, log_date);

-- ---------- 週回顧 ----------
create table if not exists public.reviews (
  user_id    uuid not null references auth.users on delete cascade,
  week_key   text not null,
  steps      jsonb not null default '[]'::jsonb,
  done       boolean not null default false,
  note       text,
  done_at    timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, week_key)
);

-- ---------- 每季新興趣 ----------
create table if not exists public.quarters (
  user_id     uuid not null references auth.users on delete cascade,
  quarter_key text not null,      -- 2026-Q4
  interest    text,
  done        boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (user_id, quarter_key)
);

-- ---------- updated_at triggers ----------
do $$
declare t text;
begin
  foreach t in array array['settings','tasks','daily_quests','day_meta','goals','counters','reviews','quarters'] loop
    execute format('drop trigger if exists %I_updated_at on public.%I', t, t);
    execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()', t, t);
  end loop;
end $$;

-- ---------- 權限：只有登入的本人讀寫得到自己的列 ----------
do $$
declare t text;
begin
  foreach t in array array['settings','tasks','task_events','daily_quests','day_meta','goals','counters','counter_events','reviews','quarters'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format('create policy own_rows on public.%I for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to authenticated;
