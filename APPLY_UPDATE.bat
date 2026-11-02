@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
cd /d "%ROOT%"
title Attendly - Apply Update

echo ==================================================
echo          ATTENDLY - APPLY UPDATE
echo ==================================================
echo.

rem --------------------------------------------------
rem Locate all project components.
rem Public SaaS: Cloudflare Worker + React frontend.
rem Local development backend: Express + SQLite.
rem --------------------------------------------------

if not exist "cloudflare\wrangler.toml" (
  echo [ERROR] cloudflare\wrangler.toml was not found.
  echo Restore your existing configuration file.
  echo Do not replace it with wrangler.toml.example.
  goto failed
)
if not exist "cloudflare\package.json" (
  echo [ERROR] cloudflare\package.json was not found.
  goto failed
)
if not exist "attendance-management-v1\frontend\package.json" (
  echo [ERROR] Frontend package.json was not found.
  goto failed
)

set "LOCAL_BACKEND_DIR="
if exist "attendance-management-v1\backend\package.json" set "LOCAL_BACKEND_DIR=attendance-management-v1\backend"
if not defined LOCAL_BACKEND_DIR if exist "backend\package.json" set "LOCAL_BACKEND_DIR=backend"
if not defined LOCAL_BACKEND_DIR if exist "local-backend\package.json" set "LOCAL_BACKEND_DIR=local-backend"

if not defined LOCAL_BACKEND_DIR (
  echo [ERROR] Local Express backend package.json was not found.
  echo Checked:
  echo   attendance-management-v1\backend\package.json
  echo   backend\package.json
  echo   local-backend\package.json
  echo.
  echo Keep the backend in one of these locations, or update this script's
  echo LOCAL_BACKEND_DIR setting to match your actual backend folder.
  goto failed
)

findstr /I /C:"build" "%LOCAL_BACKEND_DIR%\package.json" >nul
if errorlevel 1 (
  echo [ERROR] The local backend package.json does not define a build script.
  echo Expected: "build": "tsc -p tsconfig.json"
  goto failed
)
if not exist "%LOCAL_BACKEND_DIR%\tsconfig.json" (
  echo [ERROR] Local backend tsconfig.json was not found in:
  echo   %LOCAL_BACKEND_DIR%
  goto failed
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or is not on PATH.
  goto failed
)
where npm >nul 2>&1
if errorlevel 1 (
  echo [ERROR] npm is not installed or is not on PATH.
  goto failed
)

echo Local backend detected: %LOCAL_BACKEND_DIR%
echo.

echo [1/6] Installing/checking Cloudflare Worker dependencies...
cd /d "%ROOT%cloudflare"
call npm install --no-audit --no-fund
if errorlevel 1 goto failed

echo.
echo [2/6] Installing/checking React frontend dependencies...
cd /d "%ROOT%attendance-management-v1\frontend"
call npm install --no-audit --no-fund
if errorlevel 1 goto failed

echo.
echo [3/6] Installing/checking local Express backend dependencies...
cd /d "%ROOT%%LOCAL_BACKEND_DIR%"
call npm install --no-audit --no-fund
if errorlevel 1 goto failed

echo.
echo [4/6] Checking Cloudflare Worker TypeScript...
cd /d "%ROOT%cloudflare"
call npm run check
if errorlevel 1 goto failed

echo.
echo [5/6] Building React frontend...
cd /d "%ROOT%attendance-management-v1\frontend"
call npm run build
if errorlevel 1 goto failed

echo.
echo [6/6] Building local Express backend...
cd /d "%ROOT%%LOCAL_BACKEND_DIR%"
call npm run build
if errorlevel 1 goto failed

rem Archive old version-specific update launchers safely instead of deleting them.
cd /d "%ROOT%"
set "ARCHIVE_DIR=%ROOT%_archive\legacy-update-launchers"
if not exist "%ARCHIVE_DIR%" mkdir "%ARCHIVE_DIR%"
for %%F in (APPLY_ATTENDLY_V*.bat APPLY_UPDATE_V*.bat APPLY_REMOTE_MIGRATIONS*.bat APPLY_SAAS_BILLING_UPDATE.bat DEPLOY_ATTENDLY_V*.bat DEPLOY_ATTENDLY_TO_CLOUDFLARE.bat) do (
  if exist "%%~fF" (
    if /I not "%%~nxF"=="APPLY_UPDATE.bat" (
      move /Y "%%~fF" "%ARCHIVE_DIR%\%%~nxF" >nul
    )
  )
)

echo.
echo ==================================================
echo [SUCCESS] ALL SOURCE BUILDS COMPLETED.
echo ==================================================
echo Cloudflare Worker: TypeScript check passed.
echo React frontend:    Production build passed.
echo Local backend:     Production TypeScript build passed.
echo.
echo Next steps:
echo   1. Read the latest UPDATE_NOTES .md file.
echo   2. If it says a D1 migration is required, run MIGRATE_DATABASE.bat.
echo   3. Run DEPLOY.bat to publish the Cloudflare Worker and frontend.
echo.
echo NOTE: DEPLOY.bat publishes the Cloudflare Worker and frontend.
echo The local Express backend is built here for local development/testing;
echo it is not deployed to Cloudflare Workers by DEPLOY.bat.
echo.
pause
exit /b 0

:failed
echo.
echo [FAILED] Apply/update checks did not complete.
echo Do NOT migrate or deploy until the error is fixed.
echo No database migration was run by this script.
echo.
pause
exit /b 1
