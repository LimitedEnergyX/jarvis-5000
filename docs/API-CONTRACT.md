# API contract

Three tiles (**Energy Current**, **Energy Financials**, **Weather**) read from an
energy/solar API on port `3002`. **That service is not in this repo** — it's part of the
wider home platform, and it's specific to my hardware (Tesla Powerwall + a 9 kW array).

Rather than ship an integration you can't use, here is the **contract**. Implement these
three endpoints against *your* inverter/battery/utility and the tiles light up unchanged.

Or delete the three tiles. They're self-contained.

---

## `GET /api/health`

```json
{ "ok": true, "uptime": 14400, "poll_errors": 0 }
```

`uptime` in seconds. `poll_errors` > 5 raises a warning on the push tile.

---

## `GET /api/powerwall`

Instantaneous power. Positive `grid` = importing, negative = exporting.

```json
{
  "solar": 7.08,
  "home": 1.56,
  "grid": 0.51,
  "battery": 52.0,
  "reserve": 20,
  "grid_up": true,
  "charging": true,
  "mode": "self_consumption",
  "island": "on_grid",
  "storm": false,

  "financials": {
    "today": {
      "solar_kwh": 1.3,
      "import_kwh": 0.0,
      "export_kwh": 0.1,
      "net_energy": 0.0,
      "import_cost": 0.0,
      "export_credit": 0.0,
      "banked": 0.0
    },
    "monthly": {
      "mo_solar_kwh": 1503,
      "mtd_net_energy": 24.66,
      "bank_balance": 32.35
    },
    "rates": { "energy": 0.129, "buyback": 0.06 }
  }
}
```

| Field | Meaning |
|---|---|
| `solar` / `home` / `grid` | kW, instantaneous |
| `battery` | state of charge, % |
| `reserve` | backup reserve %. **Battery sitting at reserve is normal — the deck does not alert on it.** |
| `grid_up` | `false` → **critical** alert |
| `island` | `"islanded"` → **critical** alert |

`financials` is optional — omit it and the Financials tile shows `—`.

---

## `GET /api/weather-forecast`

```json
{
  "current": {
    "temp_f": 87, "feels_like_f": 94, "humidity": 60,
    "wind_mph": 6, "wind_dir": "S",
    "precip_in": 0, "cloud_pct": 32,
    "desc": "Mainly Clear", "icon": "🌤️"
  },
  "hourly": [
    { "time": "2026-07-12T13:00", "temp_f": 91, "icon": "☀️" }
  ],
  "alerts": [
    { "event": "Heat Advisory", "headline": "..." }
  ]
}
```

- `hourly` may contain the **whole day**. The dashboard filters to `time > now` itself —
  a forecast for an hour that already happened is worse than useless.
- Any entry in `alerts` raises a **warn** on the push tile.
- `icon` is just an emoji. Anything renders.

[Open-Meteo](https://open-meteo.com/) (free, no key) covers `current` + `hourly`;
the US [NWS API](https://www.weather.gov/documentation/services-web-api) covers `alerts`.

---

## CORS

The browser calls this API **directly**, so it must return CORS headers for the origin the
dashboard is served from. A zero-dependency Express middleware:

```js
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|myhost|192\.168\.1\.\d{1,3})(:\d+)?$/i;
app.use((req, res, next) => {
  const o = req.headers.origin;
  if (o && LOCAL_ORIGIN.test(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
```

> **Put your hostname in that list.** The kiosk opens `localhost:5000` and works; a browser
> at `myhost:5000` sends a *different origin* and gets blocked. Same machine, same server,
> same data — and three tiles mysteriously dead in one browser but fine in another. That
> asymmetry is the tell.

InfluxDB needs the same treatment:

```yaml
environment:
  - INFLUXD_HTTP_CORS_ALLOWED_ORIGINS=http://localhost:5000,http://myhost:5000
```
