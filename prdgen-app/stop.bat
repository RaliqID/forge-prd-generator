@echo off
setlocal EnableDelayedExpansion

:: ============================================================================
::  FORGE — stop everything started by start.bat
::    - Next.js dev server  (via the PID recorded in logs\forge.pid)
::    - PostgreSQL          (portable instance on 5432)
::
::  IMPORTANT: this never kills a process merely for holding a port. Port 3000
::  belongs to other local projects (e.g. Striv); an earlier version killed by
::  port and would have taken them down. The dev server is identified by the
::  PID file start.bat wrote, and PostgreSQL by its own data directory.
::  Data is preserved; only the processes stop.
:: ============================================================================

title FORGE Stopper

for %%I in ("%~dp0..") do set "ROOT=%%~fI"
set "PGROOT=%LOCALAPPDATA%\forge"
set "PGBIN=%PGROOT%\pgsql\bin"
set "PIDFILE=%ROOT%\logs\forge.pid"

echo.
echo  Stopping FORGE...
echo.

:: ── Dev server (PID file only) ─────────────────────────────────────────────
set "KILLED=0"
if exist "%PIDFILE%" (
  for /f "usebackq tokens=1" %%P in ("%PIDFILE%") do (
    if not "%%P"=="0" (
      echo  [dev] stopping PID %%P
      taskkill /PID %%P /T /F >nul 2>&1
      set "KILLED=1"
    )
  )
  del "%PIDFILE%" >nul 2>&1
)
if "!KILLED!"=="0" echo  [dev] no FORGE server PID on record (already stopped?)

:: ── PostgreSQL (clean shutdown via pg_ctl) ─────────────────────────────────
if exist "%PGBIN%\pg_ctl.exe" (
  set "PGUP=0"
  for /f "tokens=*" %%A in ('netstat -ano ^| findstr /R /C:"LISTENING" ^| findstr /C:":5432 "') do set "PGUP=1"
  if "!PGUP!"=="1" (
    echo  [pg]  requesting clean shutdown...
    "%PGBIN%\pg_ctl.exe" -D "%PGROOT%\data" -m fast stop >nul 2>&1
    if errorlevel 1 (
      echo  [pg]  pg_ctl could not stop it - forcing...
      taskkill /IM postgres.exe /T /F >nul 2>&1
    ) else (
      echo  [pg]  stopped.
    )
  ) else (
    echo  [pg]  not running on 5432
  )
) else (
  echo  [pg]  pg_ctl not found at "%PGBIN%" - skipping
)

echo.
echo  Done. Data is kept in %PGROOT%\data
echo.
ping -n 5 -w 1000 127.0.0.1 >nul 2>&1
exit /b 0
