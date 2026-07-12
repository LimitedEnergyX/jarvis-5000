# ═══════════════════════════════════════════════════════════════
#  JARVIS service Server — Boot Guard (crash-restart loop)
# ═══════════════════════════════════════════════════════════════
#  WHY THIS WAS REWRITTEN (2026-07-12):
#
#  The previous version spawned node with RedirectStandardOutput /
#  RedirectStandardError and drained the pipes from PowerShell reader
#  threads. When a reader stalled, the OS pipe buffer (~4KB) filled,
#  node BLOCKED on console.log, and its event loop froze.
#
#  Symptom: port 3002 shows LISTENING but refuses every connection —
#  on IPv4, IPv6 and LAN — and because the task runs as SYSTEM, no
#  user shell can kill it. This bit us repeatedly.
#
#  Fix: never pipe node's stdout through PowerShell. Redirect straight
#  to files. The OS handles the writes; node can never block.
#
#  NOTE: node's log files are owned by Start-Process while it runs, so
#  the guard writes its own messages to a SEPARATE file.
# ═══════════════════════════════════════════════════════════════

$target      = "D:\YOUR"
$outFile     = "D:\YOUR\SERVICE\service.log"        # node stdout
$errFile     = "D:\YOUR\SERVICE\service.err.log"    # node stderr
$guardLog    = "D:\YOUR\SERVICE\boot-guard.log"       # this script
$node        = "C:\Program Files\nodejs\node.exe"
$server      = "D:\YOUR\SERVICE\server.js"
$workDir     = "D:\YOUR\SERVICE"
$maxWait     = 120
$interval    = 3
$restartWait = 10
$maxLogMB    = 20

function Log($msg) {
    [System.IO.File]::AppendAllText($guardLog, "$(Get-Date -Format u) [BOOT-GUARD] $msg`n")
}

function Rotate($f) {
    if ((Test-Path $f) -and ((Get-Item $f).Length -gt ($maxLogMB * 1MB))) {
        Move-Item $f "$f.1" -Force -ErrorAction SilentlyContinue
    }
}

# ── Wait for D: drive ──────────────────────────────────────────
$elapsed = 0
while (-not (Test-Path $target)) {
    if ($elapsed -ge $maxWait) {
        Log "D: not available after ${maxWait}s - aborting."
        exit 1
    }
    Start-Sleep $interval
    $elapsed += $interval
}
Log "D: available after ${elapsed}s."

# ── Wait for DNS / internet ────────────────────────────────────
# On reboot the guard used to start node BEFORE the network stack was
# ready. Every outbound lookup then failed:
#     [weather] getaddrinfo ENOENT api.open-meteo.com
#     [nws]     getaddrinfo ENOENT api.weather.gov
#     [poll]    getaddrinfo ENOENT auth.tesla.com
# Tesla retries every 30s so it recovered, but weather only retries every
# 30 MINUTES — so the deck sat with no weather for half an hour after
# every boot. Wait for DNS before starting node.
$netWait = 0
$netOk   = $false
while ($netWait -lt 180) {
    try {
        [System.Net.Dns]::GetHostAddresses('api.open-meteo.com') | Out-Null
        $netOk = $true
        break
    } catch { }
    Start-Sleep 5
    $netWait += 5
}
if ($netOk) {
    Log "DNS ready after ${netWait}s - starting service server."
} else {
    # Don't abort — the server is still useful locally, and it retries.
    Log "WARNING: DNS not ready after 180s - starting anyway (weather may lag)."
}

# ── Crash-restart loop ─────────────────────────────────────────
while ($true) {
    Rotate $outFile
    Rotate $errFile
    Rotate $guardLog

    # Start-Process with FILE redirection: no pipes, no reader threads,
    # so node can never block on a full stdout buffer.
    $p = Start-Process -FilePath $node `
                       -ArgumentList "`"$server`"" `
                       -WorkingDirectory $workDir `
                       -RedirectStandardOutput $outFile `
                       -RedirectStandardError  $errFile `
                       -WindowStyle Hidden `
                       -PassThru

    Log "node started (PID $($p.Id))."
    $p.WaitForExit()
    Log "node exited (code $($p.ExitCode)) - restarting in ${restartWait}s."
    Start-Sleep $restartWait
}
