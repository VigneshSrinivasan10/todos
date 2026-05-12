# todos

Minimal React + PouchDB PWA. Local-first; syncs to a CouchDB on the Ryzen when reachable.

## Run

```sh
npm install
npm run dev      # vite --host, so you can open from your phone on LAN
```

Build for production: `npm run build && npm run preview`.

## Sync (optional)

Create `.env.local`:

```
VITE_COUCH_URL=http://ryzen.tailnet:5984/todos
VITE_COUCH_USER=admin
VITE_COUCH_PASS=changeme
```

If `VITE_COUCH_URL` is unset, the app runs purely local-first against IndexedDB. When set, PouchDB live-syncs in the background; phones reconcile whenever the Ryzen is reachable.

## Schema

```js
{
  _id: 'task:<uuid>',
  type: 'task',
  title, notes, tags[], source, due,    // due is ISO datetime
  done: false,
  inbox: false,                          // reserved for extracted tasks
  created, updated                       // ISO datetime
}
```

`inbox: true` is the triage flag — quick-add and the extraction pipeline both set it.

## Views

- **Today** — undone tasks with `due <= end-of-today`
- **Inbox** — undone tasks with `inbox: true`
- **All** — everything undone

Done tasks are intentionally not shown anywhere; add a "Done" view when you want one.

## CouchDB on the Ryzen

`docker-compose.yml`:

```yaml
services:
  couchdb:
    image: couchdb:3
    restart: unless-stopped
    environment:
      COUCHDB_USER: admin
      COUCHDB_PASSWORD: changeme
    ports:
      - "5984:5984"
    volumes:
      - ./data:/opt/couchdb/data
      - ./config:/opt/couchdb/etc/local.d
```

Then create the DB and configure CORS (so the PWA on a different origin can reach it):

```sh
curl -X PUT http://admin:changeme@ryzen:5984/todos
curl -X PUT http://admin:changeme@ryzen:5984/_node/_local/_config/cors/origins -d '"*"'
curl -X PUT http://admin:changeme@ryzen:5984/_node/_local/_config/httpd/enable_cors -d '"true"'
curl -X PUT http://admin:changeme@ryzen:5984/_node/_local/_config/cors/credentials -d '"true"'
curl -X PUT http://admin:changeme@ryzen:5984/_node/_local/_config/cors/methods -d '"GET, PUT, POST, HEAD, DELETE"'
curl -X PUT http://admin:changeme@ryzen:5984/_node/_local/_config/cors/headers -d '"accept, authorization, content-type, origin, referer"'
```

In production, bind CouchDB to the Tailscale interface (not `0.0.0.0`) and tighten CORS to your PWA's origin.

## Deploy to GitHub Pages

`.github/workflows/deploy.yml` builds and deploys on every push to `main`.

One-time setup after pushing the repo:

1. **Settings → Pages → Source: GitHub Actions**
2. Push to `main`. The workflow builds with Vite and publishes `dist/`.
3. App lives at `https://vigneshsrinivasan10.github.io/todos/`.

`vite.config.js` has `base: '/todos/'` and matching `scope` / `start_url` in the PWA manifest, so service worker and asset paths resolve correctly under the subpath.

## Notes

- Quick-add lands in **Inbox**. Triage button (→) clears the inbox flag once a task is "real".
- Done tasks vanish from views but stay in the DB — useful for the extractor's idempotency check via `source_hash`.
- PNG app icons aren't included. For proper iOS install, generate `icon-192.png` and `icon-512.png` and reference them in `vite.config.js`.
