/* ═══════════════════════════════════════════════════════════════
   JARVIS:5000 — DEMO MODE
   ═══════════════════════════════════════════════════════════════
   Open  index.html?demo=1  and the whole dashboard renders on mock
   data. No InfluxDB, no Home Assistant, no energy API, no config.js.

   This exists so you can evaluate the thing in 5 seconds instead of
   wiring up three services first — and so the screenshot in the
   README is something you can actually reproduce.

   It works by stubbing the two network primitives (INFLUX + GET)
   before the dashboard calls them. Nothing else in index.html knows
   demo mode exists.
   ═══════════════════════════════════════════════════════════════ */

const DEMO_CONFIG = {
  branding: { title: 'JARVIS:5000' },
  host: 'demo',
  ports: { influx: 8086, homeassistant: 8123, energy: 3002 },
  influx: { token: 'demo', org: 'demo', buckets: { homeassistant: 'homeassistant', sysmon: 'sysmon' } },
  pollMs: 10000,
  alerts: { motionWindowMs: 120000, dingWindowMs: 120000, awayMode: false },
  entities: {
    thermostat: 'climate.demo',
    indoorTempC: 'indoor_t', outdoorTempC: 'outdoor_t', indoorHumidity: 'indoor_h',
    hvacPower: ['hvac_in', 'hvac_out'],
    aqiIndoor:  { entity: 'sensor.indoor_aqi',  scale: 'score' },
    aqiOutdoor: { entity: 'sensor.outdoor_aqi', scale: 'epa' },
    zones: [
      { name: 'Living Room', tempF: 'lr_t', humidity: 'lr_h' },
      { name: 'Master Bed',  tempF: 'mb_t', humidity: 'mb_h' },
      { name: 'Office',      tempF: 'of_t', humidity: 'of_h' },
    ],
    garage: 'cover.garage',
    fridgeTempF: 'fridge_t', freezerTempF: 'freezer_t',
    patterns: { leaks: 'moisture$', fridgeDoors: 'fridge_door$', interiorMotion: '_motion$' },
  },
  cameras: [
    { key: 'front_door', label: 'Front Door', motion: 'event.front_door_motion',
      ding: 'event.front_door_ding', camera: 'camera.front_door',
      severity: 'warn', crop: 'center 72%', zoom: 1.1 },
    { key: 'driveway', label: 'Driveway', motion: 'event.driveway_motion',
      camera: 'camera.driveway', severity: 'info', crop: 'center 55%', zoom: 1 },
    { key: 'backyard', label: 'Backyard', motion: 'event.backyard_motion',
      camera: 'camera.backyard', severity: 'info', crop: 'center 55%', zoom: 1 },
  ],
  services: [
    { name: 'HOME ASST', port: 8123 }, { name: 'INFLUXDB', port: 8086 },
    { name: 'GRAFANA',   port: 3001 }, { name: 'OLLAMA',   port: 11434 },
    { name: 'ENERGY',    port: 3002 }, { name: 'OPEN WEBUI', port: 3000 },
    { name: 'SEARXNG',   port: 8080 }, { name: 'NTFY',     port: 2586 },
  ],
  sysmon: { enabled: true, remediationMeasurement: 'remediation', triageMeasurement: 'ai_triage' },
};

// ── Mock plumbing, installed only when ?demo=1 ─────────────────
if (new URLSearchParams(location.search).has('demo')) {
  const iso   = min => new Date(Date.now() - min * 60000).toISOString();
  const drift = (base, spread) => (base + (Math.random() - 0.5) * spread);

  // Influx returns annotated CSV. parseCSV() takes the first header row
  // and maps columns, so we only need to emit that shape.
  const csv = (cols, rows) =>
    [',result,table,' + cols.join(',')]
      .concat(rows.map((r, i) => `,_result,${i},` + r.join(',')))
      .join('\n');

  window.__DEMO_INFLUX = flux => {
    // ── Sysmon
    if (/remediation/.test(flux)) {
      const items = ['Disk_encryption','Firewall_rules','Auto_updates','Log_forwarding',
                     'Service_hardening','Backup_verify','Cert_rotation','Port_exposure',
                     'Local_ai_lockdown'];
      return csv(['item','_value','_time'],
        items.map((it, i) => [it, i === 8 ? 'monitoring' : 'resolved', iso(5)]));
    }
    if (/ai_triage/.test(flux)) return csv(['_value','_time'], [['DIGEST', iso(600)]]);

    // ── Cameras: snapshot tokens (demo has no HA, so no image loads)
    if (/access_token_str/.test(flux)) return csv(['_measurement','_value'], []);

    // ── Motion events. Front door fired 1 min ago -> the PUSH tile lights up.
    if (/\^event\\\.\.\*_motion/.test(flux) || /event\..*_motion/.test(flux)) {
      return csv(['_measurement','_value'], [
        ['event.front_door_motion', iso(1)],
        ['event.driveway_motion',   iso(40)],
        ['event.backyard_motion',   iso(120)],
      ]);
    }
    if (/_ding/.test(flux)) return csv(['_value'], [[iso(180)]]);

    // ── Home sensors
    if (/moisture/.test(flux)) {
      return csv(['_measurement','_value'],
        ['kitchen','water_heater','laundry','hvac','garage','bath']
          .map(n => [`binary_sensor.${n}_moisture`, '0']));
    }
    if (/cover\./.test(flux))       return csv(['_value'], [['closed']]);
    if (/fridge_door/.test(flux))   return csv(['_measurement','_value'], [['binary_sensor.fridge_door','0']]);
    if (/interiorMotion|_motion\$/.test(flux) || /\/_motion\$\//.test(flux)) {
      return csv(['_measurement','_value','_time'],
        [['binary_sensor.living_room_motion','0',iso(2)],
         ['binary_sensor.bedroom_motion','0',iso(9)],
         ['binary_sensor.office_motion','0',iso(4)]]);
    }
    if (/fridge_t|freezer_t/.test(flux)) {
      return csv(['entity_id','_value','_time'],
        [['fridge_t','37',iso(30)], ['freezer_t','5',iso(30)]]);
    }

    // ── Climate
    if (/hvac_action_str/.test(flux)) return csv(['_value'], [['cooling']]);
    if (/"temperature"/.test(flux))   return csv(['_value'], [['74']]);
    if (/outdoor_aqi/.test(flux) && !/indoor/.test(flux)) return csv(['_measurement','_value'], [['sensor.outdoor_aqi','42']]);
    if (/_aqi|air_quality/.test(flux)) {
      return csv(['_measurement','_value'],
        [['sensor.indoor_aqi','91'], ['sensor.outdoor_aqi','42']]);
    }
    if (/"°C"/.test(flux)) {
      return csv(['entity_id','_value'],
        [['indoor_t', drift(22.5,.4).toFixed(1)], ['outdoor_t', drift(29,.6).toFixed(1)]]);
    }
    if (/"°F"/.test(flux)) {
      return csv(['entity_id','_value'],
        [['lr_t', drift(72.6,.6).toFixed(1)],
         ['mb_t', drift(74.8,.6).toFixed(1)],
         ['of_t', drift(73.4,.6).toFixed(1)]]);
    }
    if (/"%"|"W"/.test(flux)) {
      return csv(['entity_id','_value'],
        [['indoor_h','53'], ['lr_h','54'], ['mb_h','52'], ['of_h','51'],
         ['hvac_in', Math.round(drift(950,80))], ['hvac_out', Math.round(drift(1150,120))]]);
    }
    return csv(['_value'], []);
  };

  // Energy / weather API + this server's own /api/system, /api/docker
  window.__DEMO_GET = url => {
    const json = o => Promise.resolve({ ok: true, json: () => Promise.resolve(o) });

    if (url.includes('/api/system')) return json({
      cpu:  { pct: drift(14, 8), model: 'Demo CPU', cores: 16 },
      mem:  { totalGB: 34, usedGB: drift(18, 1), pct: drift(53, 3) },
      gpu:  { name: 'Demo GPU', util: Math.round(drift(20, 15)), memUsed: 2100, memTotal: 12288, temp: Math.round(drift(40, 4)) },
      disks:[{ drive: 'C', totalGB: 999, freeGB: 533, usedPct: 47 },
             { drive: 'D', totalGB: 1000, freeGB: 812, usedPct: 19 }],
      uptime: 47000, host: 'demo',
    });
    if (url.includes('/api/docker')) return json({ ok: true, running: 6, containers: [] });
    if (url.includes('/api/health') && url.includes(':3002')) return json({ ok: true, uptime: 14400, poll_errors: 0 });
    if (url.includes('/api/health')) return json({ ok: true, service: 'jarvis-5000', build: 1 });

    if (url.includes('weather')) {
      const h = new Date().getHours();
      return json({
        current: { temp_f: Math.round(drift(87,2)), feels_like_f: 94, humidity: 60,
                   wind_mph: 6, wind_dir: 'S', precip_in: 0, cloud_pct: 32,
                   desc: 'Mainly Clear', icon: '🌤️' },
        hourly: [1,2,3,4].map(i => ({
          time: new Date(Date.now() + i*3600e3).toISOString(),
          temp_f: 88 + i, icon: ['🌤️','☀️','🌤️','⛅'][i-1],
        })),
        alerts: [],
      });
    }
    if (url.includes('/api/powerwall')) return json({
      solar: drift(7.1,.6), home: drift(1.5,.3), grid: drift(0.5,.4),
      battery: drift(52,2), reserve: 20, grid_up: true, charging: true,
      mode: 'self_consumption', island: 'on_grid', storm: false,
      financials: {
        today:   { solar_kwh: 1.3, import_kwh: 0, export_kwh: 0.1, net_energy: 0,
                   import_cost: 0, export_credit: 0, banked: 0 },
        monthly: { mo_solar_kwh: 1503, mtd_net_energy: 24.66, bank_balance: 32.35 },
        rates:   { energy: 0.129, buyback: 0.06 },
      },
    });
    return Promise.reject(new Error('demo: unmapped ' + url));
  };

  console.log('%cJARVIS:5000 — DEMO MODE (mock data, no backend)',
              'color:#f5a623;font:bold 13px monospace');
}

// ── Service reachability. The real deck pings each service with a no-cors
//    fetch; in demo mode there is nothing to ping, so we just say "up".
//    Return false for a service name here if you want to see the alert path.
window.__DEMO_PING = function (svc) { return true; };