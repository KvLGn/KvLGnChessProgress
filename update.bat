@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem 1. забрать то, что обновило облако (GitHub Actions)
git pull --rebase --autostash -q
rem 2. обновить данные с Lichess (+ заметки claude\*.md на этом ПК)
node scripts\update.mjs
rem 3. отправить данные на сайт
git add data scripts/cache
git diff --cached --quiet || git commit -q -m "Обновление данных с ПК"
git push -q || (git pull --rebase -X theirs -q && git push -q)
echo.
echo Сайт: https://kvlgn.github.io/KvLGnChessProgress/
pause
