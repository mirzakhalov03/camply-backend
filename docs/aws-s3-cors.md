# S3 bucket CORS — required for uploads to work in a browser

Bucket: **`camply-s3-bucket`** (eu-north-1)

## Why this exists

Uploads go **direct from the browser to S3** (`PUT` to a presigned URL), which is a
**cross-origin** request. S3 must explicitly allow the app's origin or the browser
blocks the `PUT` before it is ever sent — the upload fails with a generic network
error and the user just sees "Couldn't upload".

**`curl` does not enforce CORS.** An upload that works from the terminal can still
fail in the browser, so never treat a curl test as proof this is configured.

## The trap: one origin is not enough

`AllowedOrigins` matches the origin **exactly** — no wildcards, no port ranges, and
`localhost` ≠ `127.0.0.1` ≠ your LAN IP. As found on 2026-07-28:

| Origin | Preflight |
| --- | --- |
| `http://localhost:5173` | 200 ✅ |
| `http://127.0.0.1:5173` | 403 ❌ |
| `http://10.156.253.115:5173` (phone on Wi-Fi) | 403 ❌ |

So uploads worked on the laptop and failed on a real phone — which is exactly where
the camera needs testing.

## Applying it

Console → **S3** → `camply-s3-bucket` → **Permissions** → **Cross-origin resource
sharing (CORS)** → **Edit** → paste `aws-s3-cors.json` → **Save changes**.

Verify (a 200 with an `Access-Control-Allow-Origin` header, per origin):

```bash
curl -s -i -X OPTIONS "https://camply-s3-bucket.s3.eu-north-1.amazonaws.com/probe" \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: PUT" \
  -H "Access-Control-Request-Headers: content-type" \
  | grep -i "^HTTP\|access-control-allow-origin"
```

## Keeping it current

**The LAN IP changes** when the network or DHCP lease changes — `npm run dev --host`
prints the current one. When it moves, update the entry here and re-apply, or phone
testing silently breaks again.

Production: replace these with the real app origin(s). Don't ship `localhost` entries
to a production bucket, and never use `"*"` — that would let any website upload to
the bucket using a presigned URL it managed to obtain.

## Note: reads don't need CORS

`GET /api/uploads/*key` is same-origin (our API) and 302-redirects to S3. A redirect
followed by `<img>` is not a CORS-governed fetch, so images load regardless of this
policy. This file matters for **uploads only**.
