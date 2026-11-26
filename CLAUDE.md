# 給 Claude 的規則

這個 repo 是公開的，網站部署在 GitHub Pages。

- 不把任何個人資訊寫進 repo：程式碼、註解、範例資料、SQL、README、commit 訊息都一樣。包括名字、行程、運動或健康狀況、家人、工作、投資的具體內容，以及能拼湊出這些資訊的細節。
- 個人化內容放在資料庫 `settings.config`（只有登入後讀得到）。程式裡只放通用的預設值，有設定時以設定為準（例如 `reviewSteps`）。
- 只改自己資料的 SQL 放在 `private/`（已列在 `.gitignore`），交給使用者自己在 Supabase 執行。
- 不把 Supabase secret key（`sb_secret_`）放進任何檔案。不詢問、不代為輸入使用者的密碼。
- commit 前執行 `git diff --cached` 檢查一次有沒有個人資訊。
- 改了前端檔案要用 `python3 scripts/bump_version.py <版本>` 更新版本號。
