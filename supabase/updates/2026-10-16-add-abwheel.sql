-- 2026-10-16：每日任務加入「滾輪」1–2 組（插在深蹲後面）
-- 用法：在 Supabase SQL Editor 貼上整份，按 Run。重複執行是安全的：已經有滾輪就不會再加。
-- 規則：做滿 1 組算完成（+10 XP），做滿 2 組再 +5 XP；和其他徒手訓練一樣算進連續天數。
update public.settings s
set config = jsonb_set(s.config, '{dailies}', (
  select jsonb_agg(x.d order by x.ord)
  from (
    select t.d, t.ord::numeric as ord
    from jsonb_array_elements(s.config->'dailies') with ordinality as t(d, ord)
    union all
    select '{"id":"abwheel","label":"滾輪","detail":"1–2 組","type":"sets","sets":2,"min":1,"xp":10,"area":"body","core":true}'::jsonb,
           coalesce((select t.ord + 0.5 from jsonb_array_elements(s.config->'dailies') with ordinality as t(d, ord) where t.d->>'id' = 'squat'), 999)
  ) x
))
where not exists (select 1 from jsonb_array_elements(s.config->'dailies') d where d->>'id' = 'abwheel');

-- 檢查：列出目前的每日任務順序
select ord as 順序, d->>'label' as 每日任務, d->>'detail' as 說明
from public.settings, jsonb_array_elements(config->'dailies') with ordinality as t(d, ord)
order by ord;
