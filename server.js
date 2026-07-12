// ═══════════════════════════════════════════════════════════════
//  YOUR_HOST:5000 — AI Command Deck
//  Static server. Zero dependencies.
//    cd . ; node server.js  →  http://YOUR_HOST:5000
// ═══════════════════════════════════════════════════════════════
const http = require('http');
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { exec } = require('child_process');

const PORT = process.env.PORT || 5000;
const ROOT = __dirname;

// ── System metrics ─────────────────────────────────────────────
// The browser can't read CPU/RAM/GPU, so the deck's own server does it.
// Same origin → no CORS. No Python, no flask, no gputil.

function cpuSnapshot() {
  let idle = 0, total = 0;
  for (const c of os.cpus()) {
    idle += c.times.idle;
    for (const k in c.times) total += c.times[k];
  }
  return { idle, total };
}

function cpuPercent(ms = 200) {
  return new Promise(resolve => {
    const a = cpuSnapshot();
    setTimeout(() => {
      const b = cpuSnapshot();
      const idle  = b.idle  - a.idle;
      const total = b.total - a.total;
      resolve(total > 0 ? (1 - idle / total) * 100 : 0);
    }, ms);
  });
}

function gpuStats() {
  return new Promise(resolve => {
    exec(
      'nvidia-smi --query-gpu=name,utilization.gpu,memory.used,memory.total,temperature.gpu --format=csv,noheader,nounits',
      { timeout: 4000 },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const p = stdout.trim().split('\n')[0].split(',').map(s => s.trim());
        if (p.length < 5) return resolve(null);
        resolve({
          name:     p[0],
          util:     +p[1],
          memUsed:  +p[2],   // MiB
          memTotal: +p[3],   // MiB
          temp:     +p[4],
        });
      }
    );
  });
}

async function diskStats(letter) {
  try {
    const s = await fs.promises.statfs(`${letter}:\\`);
    const total = s.blocks * s.bsize;
    const free  = s.bfree  * s.bsize;
    if (!total) return null;
    return {
      drive:   letter,
      totalGB: total / 1e9,
      freeGB:  free  / 1e9,
      usedPct: (1 - free / total) * 100,
    };
  } catch { return null; }
}

// ── Docker daemon health ───────────────────────────────────────
// Docker Desktop is the single point of failure for the whole stack:
// InfluxDB, Home Assistant, Grafana, ntfy, SearXNG and Open WebUI all
// live in it. If the daemon is down they all die together, so the deck
// watches the daemon itself, not just the individual services.
function dockerHealth() {
  return new Promise(resolve => {
    exec('docker ps --format "{{.Names}}|{{.State}}"', { timeout: 5000 }, (err, stdout) => {
      if (err) {
        // Non-zero exit = daemon unreachable (Docker Desktop not running).
        return resolve({ ok: false, running: 0, containers: [] });
      }
      const containers = String(stdout).trim().split('\n')
        .filter(Boolean)
        .map(l => {
          const [name, state] = l.split('|');
          return { name, state };
        });
      resolve({
        ok: true,
        running: containers.filter(c => c.state === 'running').length,
        containers,
      });
    });
  });
}

async function systemHealth() {
  const [cpu, gpu, c, d] = await Promise.all([
    cpuPercent(),
    gpuStats(),
    diskStats('C'),
    diskStats('D'),
  ]);
  const totalMem = os.totalmem();
  const freeMem  = os.freemem();
  return {
    cpu: {
      pct:   cpu,
      model: (os.cpus()[0] || {}).model || 'Unknown',
      cores: os.cpus().length,
    },
    mem: {
      totalGB: totalMem / 1e9,
      usedGB:  (totalMem - freeMem) / 1e9,
      pct:     ((totalMem - freeMem) / totalMem) * 100,
    },
    gpu,
    disks:  [c, d].filter(Boolean),
    uptime: os.uptime(),
    host:   os.hostname(),
  };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.ico':  'image/x-icon',
};

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  if (url === '/api/system') {
    try {
      const d = await systemHealth();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(d));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: e.message }));
    }
  }

  if (url === '/api/docker') {
    try {
      const d = await dockerHealth();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify(d));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ ok: false, error: e.message }));
    }
  }

  if (url === '/api/health') {
    // build = mtime of index.html. The deck polls this and reloads itself
    // when it changes, so a wall-mounted display can never sit on stale code.
    let build = 0;
    try { build = fs.statSync(path.join(ROOT, 'index.html')).mtimeMs; } catch {}
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ ok: true, service: 'jarvis-5000', build }));
  }

  // ── Static files ─────────────────────────────────────────────
  // Two things bite naive static servers, and both are handled here.
  //
  // 1. decodeURIComponent() THROWS on malformed input (e.g. "/%"). Uncaught,
  //    that takes the whole process down — a one-byte denial of service.
  // 2. `file.startsWith(ROOT)` is NOT containment. A sibling directory whose
  //    name merely begins with ROOT ("C:\deck-backup" vs ROOT "C:\deck")
  //    passes the prefix test. path.relative() answers the real question:
  //    "is this actually underneath ROOT?"
  let rel;
  try {
    rel = url === '/' ? 'index.html' : decodeURIComponent(url).replace(/^\/+/, '');
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('400 Bad Request');
  }

  const file = path.resolve(ROOT, rel);
  const inside = path.relative(ROOT, file);
  if (inside === '..' ||
      inside.startsWith('..' + path.sep) ||
      path.isAbsolute(inside)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 Forbidden');
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 Not Found');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(buf);
  });
});

// Bind IPv4 explicitly. (The Powerwall server once bound to :: and ended up
// refusing every connection while still holding the port — avoid that here.)
server.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('  YOUR_HOST:5000 — AI Command Deck');
  console.log('  ─────────────────────────────────────');
  console.log(`  http://localhost:${PORT}`);
  console.log(`  http://YOUR_HOST:${PORT}`);
  console.log(`  root: ${ROOT}`);
  console.log('');
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use.`);
    console.error(`  Find it:  Get-NetTCPConnection -LocalPort ${PORT} -State Listen`);
    console.error(`  Kill it:  Stop-Process -Id <OwningProcess> -Force\n`);
  } else {
    console.error(e);
  }
  process.exit(1);
});
