"""發布新版本前執行：python3 scripts/bump_version.py 2026-10-15.1
會一起更新 js/version.js、version.json，以及 index.html 和各 js 檔裡的 ?v= 參數，
讓瀏覽器一定抓到新檔案，並讓已開著的頁面偵測到新版本。"""
import re, sys, pathlib
v = sys.argv[1]
root = pathlib.Path(__file__).resolve().parent.parent
(root / "js/version.js").write_text(
    '// 網站版本。每次發布由 scripts/bump_version.py 一起更新（也會更新 version.json 和所有 ?v= 參數）。\n'
    f'export const VERSION = "{v}";\n', encoding="utf-8")
(root / "version.json").write_text('{"version": "%s"}\n' % v, encoding="utf-8")
for p in [root / "index.html", *sorted((root / "js").glob("*.js"))]:
    s = p.read_text(encoding="utf-8")
    s2 = re.sub(r'\?v=[0-9A-Za-z.\-]+', f'?v={v}', s)
    if s2 != s:
        p.write_text(s2, encoding="utf-8")
        print("updated", p.relative_to(root))
print("version", v)
