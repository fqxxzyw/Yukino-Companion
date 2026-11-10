@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\vite\package.json" (
  call npm ci
  if errorlevel 1 goto failure
)
if not exist "dist\index.html" (
  call npm run build
  if errorlevel 1 goto failure
)
call npm start -- --open
if errorlevel 1 goto failure
exit /b 0
:failure
pause
exit /b 1
