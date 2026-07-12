# Camera snapshots without a Home Assistant token

The push tile fills with a **live camera frame** when motion fires. It does this with
**no Home Assistant long-lived token anywhere** — not in the browser, not on the server,
not in `config.js`.

## How

Home Assistant mints a rotating `access_token` for every `camera.*` entity, and refreshes
it every few minutes. Two facts make this work:

1. **HA writes every rotation into InfluxDB.** The `influxdb` integration records entity
   attributes, so each camera's current token lands in the `homeassistant` bucket as
   `access_token_str`.

2. **`/api/camera_proxy` accepts that token with no `Authorization` header.**
   The token *is* the auth.

So the dashboard:

1. reads the current token from InfluxDB on each poll (using the read-only Influx token
   it already has),
2. builds `http://<host>:8123/api/camera_proxy/<entity>?token=<tok>`,
3. drops it into an `<img>` — and **`<img>` loads are not subject to CORS**,
4. re-fetches every 2s while the alert is on screen, giving a low-framerate feed.

Zero additional credentials. Nothing new to store or rotate.

## Verify it yourself

```bash
# pull the current token out of Influx
curl -s -H "Authorization: Token $INFLUX_TOKEN" \
     -H "Content-Type: application/vnd.flux" \
     --data 'from(bucket:"homeassistant")
       |> range(start:-2h)
       |> filter(fn:(r)=> r._measurement=="camera.front_door" and r._field=="access_token_str")
       |> last()' \
     "http://HOST:8086/api/v2/query?org=ORG"

# then fetch a frame with NO auth header at all
curl -o frame.jpg "http://HOST:8123/api/camera_proxy/camera.front_door?token=<TOKEN>"
```

You should get a JPEG.

## If it stops working

The token is only as fresh as InfluxDB. If HA stops publishing `access_token_str` (an
integration change, or attribute recording turned off), snapshots break. The fallback is
a real long-lived token held **server-side** with a proxy route — never in the browser.

## Framing

Doorbells shoot a **square** fisheye. The tile is **wide**. `object-fit: cover` scales to
width and crops top and bottom evenly — which on a doorbell means a faceful of porch
ceiling and a person cropped out of frame.

`config.js` gives you two knobs per camera:

```js
crop: 'center 72%',   // WHERE  — 0% = top of frame, 100% = bottom
zoom: 1.1,            // HOW CLOSE — 1 = none, 1.2 = 20% closer
```

`transform-origin` is anchored to the same focal point as the crop, so zoom **tightens the
framing you chose** rather than drifting away from it.
