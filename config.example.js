/* ═══════════════════════════════════════════════════════════════
   JARVIS:5000 — CONFIGURATION
   ═══════════════════════════════════════════════════════════════

   1. Copy this file to  config.js
   2. Fill in your own values
   3. config.js is gitignored by default — check `git status` before you commit

   Note: config.js is delivered to the browser, so anyone who can load the
   live dashboard on your LAN can read these values. Use a read-only token.

   Everything site-specific lives here. You should not need to edit
   index.html to run this against your own house.

   Nothing here is required just to LOOK at it — open the dashboard
   with ?demo=1 and it renders fully on mock data, no backend at all.
   ═══════════════════════════════════════════════════════════════ */

window.JARVIS_CONFIG = {

  branding: {
    title: 'JARVIS:5000',
  },

  // ── Where the services live ─────────────────────────────────
  // host: null  →  derived from the page URL (recommended).
  // Everything runs on the same box, so localhost:5000, myhost:5000
  // and 192.168.1.50:5000 all work without touching this.
  // Only set it if your services live on a DIFFERENT machine.
  host: null,

  ports: {
    influx:        8086,
    homeassistant: 8123,
    energy:        3002,   // your energy/solar API — see docs/API-CONTRACT.md
    grafana:       3001,
    ollama:        11434,
    openwebui:     3000,
    searxng:       8080,
    ntfy:          2586,
  },

  // ── InfluxDB ────────────────────────────────────────────────
  // Create a READ-ONLY token. The dashboard never writes.
  // Do NOT paste an all-access admin token here.
  influx: {
    token: 'PASTE_A_READ_ONLY_INFLUXDB_TOKEN_HERE',
    org:   'your-org',
    buckets: {
      homeassistant: 'homeassistant',   // written by HA's influxdb integration
      sysmon:        'sysmon',          // optional — see NODE-03
    },
  },

  pollMs: 10000,

  // ── Alerting (the centre PUSH tile) ─────────────────────────
  alerts: {
    // A camera sends an EVENT ("motion at 14:03"), never "motion stopped".
    // So the deck holds an alert for a fixed window, then falls back to the
    // clock. Re-triggering refreshes the timestamp and restarts the window.
    motionWindowMs: 2 * 60 * 1000,
    dingWindowMs:   2 * 60 * 1000,

    // Interior motion sensors are presence detectors (smart speakers etc).
    // While you are HOME that is just you walking around — NOT an alert.
    // Pushing it to the centre tile would train you to ignore the centre tile.
    // Flip to true (or wire to a presence entity) and interior motion becomes
    // a CRITICAL intruder alert.
    awayMode: false,
  },

  // ── Home Assistant entities ─────────────────────────────────
  // Find yours: HA → Developer Tools → States.
  //
  // NOTE: HA's influxdb integration uses the UNIT as the measurement
  // ("°C", "°F", "%", "W") and the entity_id as a TAG. So the short names
  // below are entity_ids WITHOUT the `sensor.` prefix. Anything that is a
  // full `domain.entity` is used as a measurement name directly.
  entities: {

    // climate.* entity. Needs numeric field `temperature` (the setpoint)
    // and string field `hvac_action_str`.
    thermostat: 'climate.your_thermostat',

    indoorTempC:    'thermostat_indoor_temperature',   // "°C" measurement
    outdoorTempC:   'thermostat_outdoor_temperature',
    indoorHumidity: 'thermostat_indoor_humidity',      // "%" measurement

    hvacPower: ['hvac_indoor_power', 'hvac_outdoor_power'],   // "W", summed

    // Air quality.
    // ⚠ These two often use OPPOSITE scales. An indoor air-quality monitor
    // usually reports a 0-100 SCORE (higher = better); an outdoor sensor
    // reports EPA AQI (LOWER = better). Declare the scale so the colours
    // actually mean something.
    aqiIndoor:  { entity: 'sensor.indoor_air_quality_index', scale: 'score' }, // higher = better
    aqiOutdoor: { entity: 'sensor.outdoor_aqi',              scale: 'epa'   }, // lower  = better

    // Room temps at the bottom of NODE-06.
    zones: [
      { name: 'Living Room', tempF: 'living_room_temperature', humidity: 'living_room_humidity' },
      { name: 'Master Bed',  tempF: 'master_bed_temperature',  humidity: 'master_bed_humidity'  },
      { name: 'Office',      tempF: 'office_temperature',      humidity: 'office_humidity'      },
    ],

    // cover.* entity with a string field `state`.
    garage: 'cover.garage',

    // "°F" measurement. Set to null if you don't have them.
    fridgeTempF:  'fridge_temperature',
    freezerTempF: 'freezer_temperature',

    // Regexes, so you don't have to enumerate every sensor.
    patterns: {
      leaks:          'moisture$',
      fridgeDoors:    'refrigerator_(fridge|freezer)_door$',   // null to skip
      interiorMotion: '_motion$',
    },
  },

  // ── Cameras ─────────────────────────────────────────────────
  // Motion/doorbell events take over the centre tile with a live snapshot.
  //
  // NO Home Assistant token needed — see docs/CAMERA-SNAPSHOTS.md.
  //
  //   motion   — event.* entity, state = ISO timestamp of the last motion
  //   ding     — optional, doorbells only
  //   camera   — camera.* entity to snapshot
  //   severity — 'critical' | 'warn' | 'info'
  //   crop     — WHERE to look. 0% = top of frame, 100% = bottom.
  //              Doorbells shoot a SQUARE fisheye into a WIDE tile, so
  //              `cover` crops top+bottom evenly and you get a faceful of
  //              porch ceiling. Bias it low.
  //   zoom     — HOW CLOSE. 1 = none, 1.2 = 20% closer.
  cameras: [
    {
      key: 'front_door', label: 'Front Door',
      motion: 'event.front_door_motion',
      ding:   'event.front_door_ding',
      camera: 'camera.front_door',
      severity: 'warn', crop: 'center 72%', zoom: 1.1,
    },
    {
      key: 'driveway', label: 'Driveway',
      motion: 'event.driveway_motion',
      camera: 'camera.driveway',
      severity: 'info', crop: 'center 55%', zoom: 1,
    },
    {
      key: 'backyard', label: 'Backyard',
      motion: 'event.backyard_motion',
      camera: 'camera.backyard',
      severity: 'info', crop: 'center 55%', zoom: 1,
    },
  ],

  // ── Services pinged on NODE-02 ──────────────────────────────
  // Reachability only (no-cors). Delete any you don't run.
  services: [
    { name: 'HOME ASST',  port: 8123 },
    { name: 'INFLUXDB',   port: 8086, path: '/health' },
    { name: 'GRAFANA',    port: 3001, path: '/api/health' },
    { name: 'OLLAMA',     port: 11434 },
    { name: 'ENERGY',     port: 3002, path: '/api/health' },
    { name: 'OPEN WEBUI', port: 3000 },
    { name: 'SEARXNG',    port: 8080 },
    { name: 'NTFY',       port: 2586 },
  ],

  // ── NODE-03: security posture (optional) ────────────────────
  // Reads a `sysmon` bucket. Set enabled:false if you don't have one.
  //
  // Expects two measurements:
  //   remediation : one row per hardening item, string field `status`
  //                 ("resolved" / "monitoring" / ...), tag `item`
  //   ai_triage   : string field `verdict`
  sysmon: {
    enabled: true,
    remediationMeasurement: 'remediation',
    triageMeasurement:      'ai_triage',
  },
};
