@echo off
setlocal EnableExtensions
title Attendly - GitHub Update

cd /d "%~dp0"
if errorlevel 1 (
    echo [ERROR] Could not open the script folder.
    pause
    exit /b 1
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
    echo [ERROR] This folder is not inside a Git repository.
    echo Place update-git.bat in your Attendly repository root.
    pause
    exit /b 1
)

for /f "delims=" %%R in ('git remote get-url origin 2^>nul') do set "REMOTE=%%R"
if not defined REMOTE (
    echo [ERROR] No Git remote named origin was found.
    echo Connect your GitHub repository first using:
    echo git remote add origin YOUR_REPOSITORY_URL
    pause
    exit /b 1
)

for /f "delims=" %%B in ('git branch --show-current') do set "BRANCH=%%B"
if not defined BRANCH (
    echo [ERROR] Git could not determine the current branch.
    pause
    exit /b 1
)

echo.
echo ==============================================
echo          ATTENDLY - GITHUB UPDATE
echo ==============================================
echo Repository: %REMOTE%
echo Branch:     %BRANCH%
echo.

git add -A
if errorlevel 1 (
    echo [ERROR] git add failed. Nothing has been committed or pushed.
    pause
    exit /b 1
)

git diff --cached --check
if errorlevel 1 (
    echo [ERROR] Staged changes contain whitespace errors.
    echo Review the changes before committing.
    pause
    exit /b 1
)

git diff --cached --quiet
if not errorlevel 1 goto NO_CHANGES

echo Files staged for this commit:
echo ----------------------------------------------
git status --short
echo ----------------------------------------------

:ASK_MESSAGE
set "COMMIT_MSG="
set /p "COMMIT_MSG=Enter a commit message: "
if not defined COMMIT_MSG (
    echo [ERROR] Commit message cannot be empty.
    goto ASK_MESSAGE
)

echo.
echo Review the staged files above before continuing.
choice /C YN /N /M "Create this commit and push it to GitHub? [Y/N] "
if errorlevel 2 (
    echo Cancelled. Your changes remain staged locally; nothing was pushed.
    pause
    exit /b 0
)

git commit -m "%COMMIT_MSG%"
if errorlevel 1 (
    echo [ERROR] Commit failed. Nothing was pushed.
    pause
    exit /b 1
)

echo.
echo Pushing branch %BRANCH% to origin...
git push -u origin "%BRANCH%"
if errorlevel 1 (
    echo.
    echo [ERROR] Push failed. Your commit is saved locally.
    echo Check your internet connection, GitHub sign-in, and remote branch status.
    pause
    exit /b 1
)

echo.
echo [SUCCESS] Attendly has been pushed to GitHub.
pause
exit /b 0

:NO_CHANGES
echo No new changes to commit. Your GitHub repository is already up to date.
pause
exit /b 0
