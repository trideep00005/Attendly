@echo off
setlocal EnableExtensions
set "ROOT=%~dp0"
cd /d "%ROOT%"
title Attendly - Deploy

echo ==================================================
echo             ATTENDLY - DEPLOY
echo ==================================================
echo.
if not exist "cloudflare\wrangler.toml" (
  echo [ERROR] cloudflare\wrangler.toml was not found.
  goto failed
)
if not exist "attendance-management-v1\frontend\dist\index.html" (
  echo [ERROR] Production frontend build was not found.
  echo Run APPLY_UPDATE.bat successfully before deploying.
  goto failed
)
findstr /I "REPLACE_WITH_YOUR_D1_DATABASE_ID" "cloudflare\wrangler.toml" >nul
if not errorlevel 1 (
  echo [ERROR] wrangler.toml still contains the placeholder D1 database ID.
  goto failed
)

cd /d "%ROOT%cloudflare"
if not exist "node_modules\wrangler" (
  echo [INFO] Installing Cloudflare dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto failed
)

echo [1/2] Final Worker TypeScript check...
call npm run check
if errorlevel 1 goto failed

echo.
echo [2/2] Deploying Worker and frontend assets to Cloudflare...
call npx wrangler deploy
if errorlevel 1 goto failed

echo.
echo [SUCCESS] Attendly deployment command completed.
echo Open the workers.dev/custom domain URL shown above and test the release.
echo.
pause
exit /b 0

:failed
echo.
echo [FAILED] Deployment stopped. Review the error above.
echo Confirm APPLY_UPDATE.bat passed and, when required by the update notes, MIGRATE_DATABASE.bat was completed.
echo.
pause
exit /b 1
