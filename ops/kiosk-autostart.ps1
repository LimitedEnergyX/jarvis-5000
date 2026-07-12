# ═══════════════════════════════════════════════════════════════
#  JARVIS:5000 — kiosk autostart (Windows)
# ═══════════════════════════════════════════════════════════════
#  Registers TWO scheduled tasks at logon:
#
#    1. the Node server            (serves the dashboard)
#    2. a full-screen Chrome kiosk (actually PUTS IT ON THE WALL)
#
#  Both are needed. Shipping only the first is the classic mistake:
#  you reboot, the server is happily running, and the monitor shows
#  an empty desktop. The server being up is not the same thing as
#  the dashboard being on screen.
#
#  Run from a NORMAL PowerShell (no elevation needed — these run as
#  you, at your logon).
#
#      .\kiosk-autostart.ps1 -DeckPath "C:\path\to\jarvis-5000"
# ═══════════════════════════════════════════════════════════════
param(
    [Parameter(Mandatory = $true)][string]$DeckPath,
    [string]$Url = 'http://localhost:5000',
    [int]$StartupDelaySeconds = 45
)

$ErrorActionPreference = 'Stop'
$me = "$env:USERDOMAIN\$env:USERNAME"

# ── 1. the server ─────────────────────────────────────────────
$a = New-ScheduledTaskAction -Execute 'node.exe' -Argument 'server.js' -WorkingDirectory $DeckPath
$t = New-ScheduledTaskTrigger -AtLogOn -User $me
$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
        -ExecutionTimeLimit ([TimeSpan]::Zero) `
        -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$p = New-ScheduledTaskPrincipal -UserId $me -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName 'JARVIS 5000 Server' `
    -Action $a -Trigger $t -Settings $s -Principal $p `
    -Description 'JARVIS:5000 dashboard server' -Force | Out-Null
Write-Host '  registered: JARVIS 5000 Server' -ForegroundColor Green

# ── 2. the kiosk browser ──────────────────────────────────────
$chrome = @(
    "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chrome) { throw 'No Chrome or Edge found.' }

# A dedicated profile dir keeps the kiosk from colliding with your
# everyday browser (sessions, extensions, "restore pages?" prompts).
$args = @(
    '--kiosk'
    "--app=$Url"
    "--user-data-dir=`"$DeckPath\_kiosk-profile`""
    '--no-first-run'
    '--disable-session-crashed-bubble'   # or every crash nags forever on the wall
    '--disable-infobars'
    '--noerrdialogs'
    '--disable-features=TranslateUI'
    '--check-for-update-interval=31536000'
) -join ' '

$a2 = New-ScheduledTaskAction -Execute $chrome -Argument $args
# Delay: give the server (and any containers) time to come up first,
# otherwise the kiosk loads an error page and just sits there.
$t2 = New-ScheduledTaskTrigger -AtLogOn -User $me
$t2.Delay = "PT${StartupDelaySeconds}S"

Register-ScheduledTask -TaskName 'JARVIS 5000 Kiosk Display' `
    -Action $a2 -Trigger $t2 -Settings $s -Principal $p `
    -Description 'Full-screen kiosk browser for JARVIS:5000' -Force | Out-Null
Write-Host "  registered: JARVIS 5000 Kiosk Display  ($([IO.Path]::GetFileName($chrome)))" -ForegroundColor Green

# ── 3. stop the wall from going to sleep ──────────────────────
# Auto-logon that then blanks itself after 10 minutes defeats the point.
powercfg /change monitor-timeout-ac 0 | Out-Null
powercfg /change standby-timeout-ac 0 | Out-Null
Set-ItemProperty 'HKCU:\Control Panel\Desktop' -Name ScreenSaveActive    -Value '0' -Force
Set-ItemProperty 'HKCU:\Control Panel\Desktop' -Name ScreenSaverIsSecure -Value '0' -Force
Write-Host '  display: no sleep, no screensaver, no lock' -ForegroundColor Green

Write-Host ''
Write-Host 'Done. Reboot (or log off/on) and the wall comes up on its own.' -ForegroundColor Cyan
Write-Host ''
Write-Host 'NOTE: for a truly unattended box you also need AUTO-LOGON, or nothing' -ForegroundColor Yellow
Write-Host '      logon-triggered ever fires. Use Sysinternals Autologon (stores the' -ForegroundColor Yellow
Write-Host '      password LSA-encrypted) rather than the plaintext registry method.' -ForegroundColor Yellow
Write-Host '      Understand the trade-off: anyone who power-cycles the box gets a' -ForegroundColor Yellow
Write-Host '      signed-in desktop with no password.' -ForegroundColor Yellow
