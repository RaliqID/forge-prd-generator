@echo off
setlocal EnableDelayedExpansion

:: ============================================================================
::  FORGE — AI PRD Generator : one-click launcher
::
::  Starts everything the app needs, in order, detached from this window:
::    1. PostgreSQL   (portable instance in %LOCALAPPDATA%\forge\pgsql)
::    2. Next.js dev server (port 5555 — deliberately NOT 3000, which other
::       local projects such as Striv use; 3000 was being hijacked)
::  Then opens the browser.
::
::  Safe to run repeatedly: services already up are reused, not restarted.
::  Logs land in  <repo>\logs\ . Ctrl+C here does NOT stop the services;
::  use  stop.bat  for that.
:: ============================================================================

title FORGE Launcher
cd /d "%~dp0"

:: Resolve the repo root as an ABSOLUTE path. Start-Process (used below to keep
:: the servers windowless) rejects a relative -RedirectStandardOutput path with
:: "cannot find the drive specified" and then silently writes nothing, so every
:: log path must be absolute.
for %%I in ("%~dp0..") do set "ROOT=%%~fI"

set "PGROOT=%LOCALAPPDATA%\forge"
set "PGBIN=%PGROOT%\pgsql\bin"
set "PGDATA=%PGROOT%\data"
set "LOGDIR=%ROOT%\logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

set "PGLOG=%LOGDIR%\postgres.log"
set "DEVLOG=%LOGDIR%\dev.log"
:: App port. 3000 is reserved for other local projects (Striv) on this machine,
:: so FORGE uses 5555. Override by setting FORGE_PORT before running.
if not defined FORGE_PORT set "FORGE_PORT=5555"
set "DEVURL=http://localhost:%FORGE_PORT%"

echo.
echo  ============================================================
echo   FORGE  -  AI PRD Generator
echo  ============================================================
echo   repo   : %ROOT%
echo   logs   : %LOGDIR%
echo.

:: ── Sanity: is this really the app folder? ──────────────────────────────────
if not exist "package.json" (
  echo  [X] package.json not found in "%~dp0"
  echo      Run this .bat from inside the prdgen-app folder.
  goto :fail
)
if not exist ".env.local" (
  echo  [!] .env.local is missing.
  echo      Copy .env.example to .env.local and fill it in first.
  goto :fail
)
if not exist "node_modules" (
  echo  [1/3] Installing dependencies ^(first run, this can take a few minutes^)...
  call npm install
  if errorlevel 1 ( echo  [X] npm install failed. & goto :fail )
)

:: ── 1. PostgreSQL ──────────────────────────────────────────────────────────
set "PGUP="
call :checkport 5432
if "!PORT_OPEN!"=="1" (
  echo  [1/3] PostgreSQL already running on 5432 - reusing.
  set "PGUP=1"
) else (
  if not exist "%PGBIN%\postgres.exe" (
    echo  [X] PostgreSQL not found at "%PGBIN%"
    echo      Expected a portable instance there. Re-run setup or install Postgres.
    goto :fail
  )
  echo  [1/3] Starting PostgreSQL...
  :: Fully hidden and detached from this console so no taskbar window appears
  :: and the server survives this launcher closing.
  powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath '%PGBIN%\postgres.exe' -ArgumentList '-D','%PGDATA%','-p','5432' -WindowStyle Hidden -RedirectStandardOutput '%PGLOG%' -RedirectStandardError '%PGLOG%.err'" >nul 2>&1
  call :waitport 5432 30
  if "!PORT_OPEN!"=="1" (
    set "PGUP=1"
    echo        ...ready on 5432.
  ) else (
    echo  [X] PostgreSQL did not come up within 30s.
    echo      Check: %PGLOG%
    echo      If the data dir was created by an older Postgres, run:
    echo        "%PGBIN%\pg_ctl" -D "%PGDATA%" start
    goto :fail
  )
)

:: ── 2. Dev server ──────────────────────────────────────────────────────────
call :checkport %FORGE_PORT%
if "!PORT_OPEN!"=="1" (
  echo  [2/3] Port %FORGE_PORT% already in use - assuming the app is up.
  goto :open
)

echo  [2/3] Starting Next.js dev server on port %FORGE_PORT%...
:: Launch fully hidden (no taskbar window). `start /b` keeps the child attached
:: to this console but windowless; `wscript` would detach it entirely, which
:: would kill the server when this window closes. So run it headless via
:: powershell -WindowStyle Hidden, which survives the parent exiting.
powershell -NoProfile -WindowStyle Hidden -Command "Start-Process -FilePath 'node' -ArgumentList 'node_modules\next\dist\bin\next','dev','--webpack','-p','%FORGE_PORT%' -WorkingDirectory '%ROOT%\prdgen-app' -WindowStyle Hidden -RedirectStandardOutput '%DEVLOG%' -RedirectStandardError '%DEVLOG%.err'" >nul 2>&1

call :waitport %FORGE_PORT% 45
if "!PORT_OPEN!"=="1" (
  echo        ...ready at %DEVURL%
  :: Record the server's PID so stop.bat can kill exactly this process and
  :: never a different project that happens to bind a neighbouring port.
  call :writepid %FORGE_PORT%
) else (
  echo  [X] Dev server did not come up within 45s.
  echo      Last log lines:
  echo      ------------------------------------------------------
  if exist "%DEVLOG%" powershell -NoProfile -Command "Get-Content -LiteralPath '%DEVLOG%' -Tail 15"
  echo      ------------------------------------------------------
  goto :fail
)

:open
echo  [3/3] Opening %DEVURL% ...
start "" "%DEVURL%"

echo.
echo  ============================================================
echo   FORGE is running.
echo.
echo   App      : %DEVURL%
echo   Postgres : 127.0.0.1:5432  (db=forge, user=postgres)
echo   Logs     : %LOGDIR%
echo.
echo   To stop everything, run:  stop.bat
echo  ============================================================
echo.
echo  This window can be closed safely.
call :delay 12
exit /b 0

:: ── helpers ────────────────────────────────────────────────────────────────

:: delay <seconds>  — stdin-free wait.
:: `timeout /t` aborts with "Input redirection is not supported" whenever the
:: script runs without an attached console (CI, a parent shell piping output,
:: Task Scheduler), so use ping as the portable sleep primitive instead.
:delay
if "%~1"=="" exit /b 0
ping -n %~1 -w 1000 127.0.0.1 >nul 2>&1
exit /b 0

:: writepid <port>  — persist the listening PID for stop.bat to consume.
:writepid
set "PIDFILE=%ROOT%\logs\forge.pid"
(for /f "tokens=5" %%A in ('netstat -ano ^| findstr /R /C:"LISTENING" ^| findstr /C:":%~1 "') do @echo %%A) > "%PIDFILE%" 2>nul
exit /b 0

:: checkport <port>  ->  sets PORT_OPEN=1|0  (via netstat, no admin needed)
:checkport
set "PORT_OPEN=0"
for /f "tokens=*" %%A in ('netstat -ano ^| findstr /R /C:"LISTENING" ^| findstr /C:":%~1 "') do set "PORT_OPEN=1"
exit /b 0

:: waitport <port> <seconds>
:waitport
set /a _wp_elapsed=0
:waitport_loop
call :checkport %~1
if "!PORT_OPEN!"=="1" exit /b 0
set /a _wp_elapsed+=1
if !_wp_elapsed! GEQ %~2 exit /b 0
call :delay 1
goto :waitport_loop

:fail
echo.
echo  Launch aborted. See the messages above.
echo.
pause
exit /b 1
