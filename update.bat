@echo off
chcp 65001 >nul
node "%~dp0scripts\update.mjs"
echo.
pause
