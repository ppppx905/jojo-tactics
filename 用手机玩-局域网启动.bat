@echo off
rem ============================================================
rem  JOJO Stardust Tactics - LAN server (so your phone can play too)
rem  Double-click this file. It prints the address for your phone.
rem  Keep this window open while playing.
rem  (All messages are printed by the Node server below.)
rem ============================================================
chcp 65001 >nul
title JOJO Stardust Tactics - LAN server (phone)
cd /d "%~dp0"
echo.
echo  Starting LAN server ...
echo  Keep this window open while playing.
echo.
node tools\serve.mjs 8799 --lan
echo.
echo  Server stopped. Press any key to close.
pause >nul
