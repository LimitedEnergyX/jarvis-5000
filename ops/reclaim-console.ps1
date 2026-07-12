# ═══════════════════════════════════════════════════════════════
#  Reclaim the physical console after an RDP disconnect
# ═══════════════════════════════════════════════════════════════
#  WHY THIS EXISTS
#
#  Windows allows ONE interactive session per user. RDP-ing into
#  YOUR_USER takes the session away from the physical monitor and
#  leaves the wall display at the lock screen. Disconnecting RDP does
#  NOT hand it back — the session just sits "Disc" (disconnected), and
#  auto-logon only fires at boot. So the wall display stays dead until
#  somebody physically signs in.
#
#  This script moves the disconnected session back to the console.
#  Run it from a scheduled task triggered on RDP disconnect
#  (TerminalServices-LocalSessionManager, Event ID 24).
#
#  MUST run as SYSTEM — tscon cannot move a session you don't own.
# ═══════════════════════════════════════════════════════════════

$User    = 'YOUR_USER'
$LogFile = 'D:\YOUR\SCRIPTS\reclaim-console.log'

function Log($msg) {
    [System.IO.File]::AppendAllText($LogFile, "$(Get-Date -Format u) $msg`n")
}

# `query user` output:
#  USERNAME   SESSIONNAME   ID  STATE   IDLE TIME  LOGON TIME
#  YOUR_USER                 2  Disc          1:02  7/12/2026 ...
$lines = @(query user $User 2>$null)
if (-not $lines -or $lines.Count -lt 2) {
    Log "no session found for $User - nothing to do"
    exit 0
}

$target = $null
foreach ($l in $lines[1..($lines.Count - 1)]) {
    # Disconnected sessions have no SESSIONNAME and state 'Disc'
    if ($l -match '\bDisc\b') {
        # the session ID is the last standalone integer before the state
        $id = [regex]::Match($l, '\s(\d+)\s+Disc\b').Groups[1].Value
        if ($id) { $target = $id; break }
    }
}

if (-not $target) {
    Log "no DISCONNECTED session for $User (already on console, or still connected)"
    exit 0
}

Log "session $target is disconnected - moving to console"
try {
    tscon $target /dest:console
    Log "tscon $target /dest:console -> OK (wall display restored)"
} catch {
    Log "tscon FAILED: $($_.Exception.Message)"
    exit 1
}
