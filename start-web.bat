@echo off
chcp 65001 >nul
title RM Homework (Node mode)
cd /d "%~dp0"

echo ================================================
echo   RoboMaster Team Homework
echo   Starting local service, please wait...
echo ================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. Install Node.js 18+ first.
  pause
  exit /b 1
)

node "src\web\start.js"

echo.
echo [Service stopped] exit code: %ERRORLEVEL%
echo If there is an error above, screenshot it and send to me.
pause
