# Amour account API

Production base: **https://xokeza.su/amour/api**. This is a JSON API, without a website frontend.

The service owns new accounts, opaque access/refresh sessions, profiles, likes, saved
collections, ordered user playlists, playback history and basic personal mixes. SQLite
runs in WAL mode; passwords use salted scrypt hashes. Access tokens expire after 15
minutes. Refresh tokens rotate and expire after 30 days; reuse revokes that session.
Defaults keep profiles and listening history private. Authentication is rate limited.
Email is currently an account identifier; email verification and password recovery
require a mail provider and are not implemented.

## Run and verify

Requires Node 22.13+ and pnpm 11. The existing bundled desktop signer is reused only
inside the compatibility gateway. Its opaque artifact is not extracted or exposed
through an API or included in the Android renderer.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
HOST=127.0.0.1 PORT=3138 AMOUR_DATABASE=./data/amour.sqlite pnpm start
curl http://127.0.0.1:3138/health
```

`src/legacy-signer.mjs` is generated from `../desktop/electron/crypto.ts` and the
unchanged embedded WASM artifact. Keep the existing desktop LICENSE attribution.
Do not log passwords, bearer tokens, refresh tokens or complete authentication bodies.

## Existing accounts

There is no old database dump or old signing infrastructure to migrate. Existing
account IDs, tokens and data are never rewritten into new, empty accounts. Requests
with original tokens go to the fixed `https://api.tryliner.fun` upstream, preserving
the exact body, path and existing signed headers. Unsigned mobile requests can be
signed by the same bundled signer on the server. New registrations and locally
recognized accounts use this server and are never forwarded upstream.

Original accounts still depend on the original service. If its protection blocks
proxy requests with an HTML error page, this API returns `503 LEGACY_PROXY_BLOCKED`.
The client can retry that specific failure directly with the same signed
request. Unsigned native requests receive only the three request-bound signature
headers needed for that exact retry; private signing material is never returned. Generic network errors never trigger mutation replays. This preserves the
old data without claiming an unavailable third-party database has been migrated.

## HTTP contracts

All `/v1/me`, profile, library and history routes require `Authorization: Bearer …`.
Public health endpoint: `GET /health`.

- `POST /v1/auth/challenge` — login/register purpose and email.
- `POST /v1/auth/register` — email, password, username, displayName.
- `POST /v1/auth/login` — email and password.
- `POST /v1/auth/refresh`, `/v1/auth/logout` — refreshToken.
- `GET /v1/me`, `PATCH /v1/users/me` — current account/profile.
- `GET/PUT/DELETE /v1/me/library/tracks[/trackId]` — liked track snapshots.
- `GET/PUT/DELETE /v1/me/library/{albums,artists,playlists}[/id]` — saved collections.
- `GET/POST /v1/me/playlists`; `GET/PATCH/DELETE /v1/me/playlists/:id`.
- `POST …/:id/tracks` — ordered bulk import, maximum 5000 snapshots.
- `POST …/:id/tracks/:trackId`; `DELETE …/:id/items/:itemId`.
- `POST …/:id/items/:itemId/move` — beforeItemId and revision; stale revisions return 409.
- `POST /v1/me/playback/events`, `GET /v1/me/history` — idempotent playback/history.
- Profile/follow routes match the desktop contracts and enforce profile privacy.
- `/v1/me/recommendations/daily-mixes` derives mixes from that account's stored tracks.
- Lyrics can use LRCLIB when title/artist hints are supplied.

The YouTube/SoundCloud catalog and recommendation retrieval remain client-side.
Explore/leaderboard results start empty where no local data exists; the API does not
fabricate activity. Telemetry endpoints currently acknowledge and discard payloads;
telemetry is opt-in and no telemetry database is created.

## Deployment and recovery

- Service: `amour-api.service`, unprivileged `amour-api` user.
- Listener: `127.0.0.1:3138`; nginx strips `/amour/api/` before proxying.
- Releases: `/opt/amour-api/releases/`; `current` is the active release symlink.
- Database: `/var/lib/amour-api/amour.sqlite`, private to the service user.
- Daily backup: `amour-api-backup.timer`; retention 14 days, local backups only.
- Backup directory: `/var/lib/amour-api/backups/`.

Deployment templates are in `deploy/`. Preserve the database when changing the
release symlink. Validate nginx before reloading it. Release rollback changes the
symlink and restarts only `amour-api.service`; it never deletes user data.

```sh
systemctl status amour-api.service
systemctl start amour-api-backup.service
journalctl -u amour-api.service --since '15 minutes ago'
curl https://xokeza.su/amour/api/health
```

For recovery, stop only the Amour service, back up the current database and its WAL,
restore a selected consistent SQLite backup with ownership `amour-api:amour-api`
and mode 0600, then restart the service. Do not replace a live database file.
