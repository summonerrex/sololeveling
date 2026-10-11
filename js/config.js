// Supabase 專案設定
// SUPABASE_URL：專案網址，例如 https://abcdefgh.supabase.co
// SUPABASE_KEY：publishable key（開頭 sb_publishable_）。這把 key 本來就是給瀏覽器用的，
//               資料安全靠資料庫的 Row Level Security（見 supabase/schema.sql）。
//               絕對不要把 secret key（開頭 sb_secret_）放在這裡。
// 兩個都留空時，網站會用範例資料以「展示模式」執行，什麼都不會存。
export const SUPABASE_URL = "https://kyjgjifjoqkhbcicyamc.supabase.co";
export const SUPABASE_KEY = "sb_publishable_0LcsmxBZB0596d0uHyC0UQ_YpCxlTR3";
