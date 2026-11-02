@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
set "DB_NAME=attendly-production"
cd /d "%ROOT%"
title Attendly - Migrate Database

echo ==================================================
echo        ATTENDLY - DATABASE MIGRATIONS
echo ==================================================
echo.
if not exist "cloudflare\wrangler.toml" (
  echo [ERROR] cloudflare\wrangler.toml was not found.
  goto failed
)
findstr /I "%DB_NAME%" "cloudflare\wrangler.toml" >nul
if errorlevel 1 (
  echo [ERROR] The configured D1 database name does not appear to be %DB_NAME%.
  echo Check cloudflare\wrangler.toml before continuing.
  goto failed
)
findstr /I "REPLACE_WITH_YOUR_D1_DATABASE_ID" "cloudflare\wrangler.toml" >nul
if not errorlevel 1 (
  echo [ERROR] wrangler.toml still contains the placeholder database ID.
  goto failed
)

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or is not on PATH.
  goto failed
)

cd /d "%ROOT%cloudflare"
if not exist "node_modules\wrangler" (
  echo [INFO] Installing Cloudflare dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto failed
)

echo [1/2] Checking migration status on the REMOTE D1 database...
call npx wrangler d1 migrations list %DB_NAME% --remote
if errorlevel 1 goto failed

echo.
echo [2/2] Applying pending migrations only...
echo Wrangler records applied migrations and will not reapply completed migrations.
call npx wrangler d1 migrations apply %DB_NAME% --remote
if errorlevel 1 goto failed

echo.
echo [SUCCESS] Remote migration command completed.
echo If Wrangler reported no migrations to apply, the database was already up to date.
echo You may now run DEPLOY.bat.
echo.
pause
exit /b 0

:failed
echo.
echo [FAILED] Database migration did not complete.
echo Do NOT deploy until the migration problem is understood.
echo Your existing database has not been intentionally reset by this script.
echo.
pause
exit /b 1
