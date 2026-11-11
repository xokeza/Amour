import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.mjs";

const identity = (suffix = "one") => ({
  email: `${suffix}@example.test`,
  password: "Test-Password-83!",
  username: `user_${suffix}`,
  displayName: `User ${suffix}`,
});
const snapshot = {
  id: "dQw4w9WgXcQ",
  title: "Test song",
  artists: [{ id: "artist", name: "Test artist" }],
  durationMs: 213000,
  cover: {
    url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    width: 480,
    height: 360,
  },
};
async function instance(t, options = {}) {
  const app = await createApp({
    database: ":memory:",
    logger: false,
    ...options,
  });
  t.after(() => app.close());
  return app;
}
async function register(app, suffix = "one") {
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: identity(suffix),
  });
  assert.equal(response.statusCode, 201, response.body);
  return response.json();
}
const headers = (session) => ({
  authorization: `Bearer ${session.accessToken}`,
});

test("register, login, password hashing, rotating refresh/reuse and logout", async (t) => {
  const app = await instance(t);
  const first = await register(app);
  assert.equal(first.user.email, identity().email);
  assert.ok(first.accessToken.startsWith("amour_a_"));
  assert.ok(
    !app.db
      .prepare("SELECT password_hash FROM users")
      .get()
      .password_hash.includes(identity().password),
  );
  assert.equal(
    (await app.inject({ url: "/v1/me", headers: headers(first) })).statusCode,
    200,
  );
  assert.equal((await app.inject({ url: "/v1/me" })).statusCode, 401);
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: { email: identity().email, password: "Wrong-pass!" },
      })
    ).statusCode,
    401,
  );
  const login = await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: identity(),
  });
  assert.equal(login.statusCode, 200);
  const rotated = await app.inject({
    method: "POST",
    url: "/v1/auth/refresh",
    payload: { refreshToken: first.refreshToken },
  });
  assert.equal(rotated.statusCode, 200);
  assert.notEqual(rotated.json().refreshToken, first.refreshToken);
  assert.equal(
    (await app.inject({ url: "/v1/me", headers: headers(first) })).statusCode,
    401,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/auth/refresh",
        payload: { refreshToken: first.refreshToken },
      })
    ).statusCode,
    401,
  );
  assert.equal(
    (await app.inject({ url: "/v1/me", headers: headers(rotated.json()) }))
      .statusCode,
    401,
  );
  const live = login.json();
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/auth/logout",
        payload: { refreshToken: live.refreshToken },
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (await app.inject({ url: "/v1/me", headers: headers(live) })).statusCode,
    401,
  );
});

test("validation, duplicate identities, CORS and auth abuse limit", async (t) => {
  const app = await instance(t);
  await register(app);
  for (const [field, value] of [
    ["email", "invalid"],
    ["password", "1"],
    ["username", "bad@user"],
  ]) {
    const r = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: { ...identity("two"), [field]: value },
    });
    assert.equal(r.statusCode, 400, r.body);
  }
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: identity(),
      })
    ).json().code,
    "EMAIL_ALREADY_USED",
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/auth/register",
        payload: { ...identity("two"), username: identity().username },
      })
    ).json().code,
    "USERNAME_TAKEN",
  );
  const cors = await app.inject({
    method: "OPTIONS",
    url: "/v1/me",
    headers: {
      origin: "https://localhost",
      "access-control-request-method": "GET",
      "access-control-request-headers": "authorization",
    },
  });
  assert.equal(
    cors.headers["access-control-allow-origin"],
    "https://localhost",
  );
  const forbidden = await app.inject({
    url: "/health",
    headers: { origin: "https://attacker.example" },
  });
  assert.notEqual(
    forbidden.headers["access-control-allow-origin"],
    "https://attacker.example",
  );
  let last;
  for (let n = 0; n < 15; n++)
    last = await app.inject({
      method: "POST",
      url: "/v1/auth/register",
      payload: {},
    });
  assert.equal(last.statusCode, 429);
});

test("likes, imports, duplicates, order, revisions, ownership and persistence contracts", async (t) => {
  const app = await instance(t),
    alice = await register(app),
    bob = await register(app, "two");
  const h = headers(alice);
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: `/v1/me/library/tracks/${snapshot.id}`,
        headers: h,
        payload: { track: snapshot },
      })
    ).statusCode,
    204,
  );
  assert.equal(
    (await app.inject({ url: "/v1/me/library/tracks", headers: h })).json()
      .items[0].track.id,
    snapshot.id,
  );
  assert.equal(
    (
      await app.inject({ url: "/v1/me/library/tracks", headers: headers(bob) })
    ).json().items.length,
    0,
  );
  await app.inject({
    method: "PUT",
    url: `/v1/me/library/tracks/${snapshot.id}`,
    headers: headers(bob),
    payload: { track: { ...snapshot, title: "Other account title" } },
  });
  assert.equal(
    (await app.inject({ url: "/v1/me/library/tracks", headers: h })).json()
      .items[0].track.title,
    snapshot.title,
  );
  const created = await app.inject({
    method: "POST",
    url: "/v1/me/playlists",
    headers: h,
    payload: { title: "Imported" },
  });
  assert.equal(created.statusCode, 201, created.body);
  const id = created.json().id,
    url = `/v1/me/playlists/${id}`;
  const second = { ...snapshot, id: "bbbbbbbbbbb", title: "Second" };
  const bulk = await app.inject({
    method: "POST",
    url: `${url}/tracks`,
    headers: h,
    payload: { tracks: [snapshot, second, snapshot] },
  });
  assert.equal(bulk.statusCode, 200, bulk.body);
  assert.equal(bulk.json().added, 3);
  const read = await app.inject({ url, headers: h });
  assert.deepEqual(
    read.json().items.map((item) => item.track.id),
    [snapshot.id, second.id, snapshot.id],
  );
  assert.equal(
    (await app.inject({ url, headers: headers(bob) })).statusCode,
    404,
  );
  const data = read.json();
  const moved = await app.inject({
    method: "POST",
    url: `${url}/items/${data.items[2].id}/move`,
    headers: h,
    payload: {
      beforeItemId: data.items[0].id,
      revision: data.playlist.revision,
    },
  });
  assert.equal(moved.statusCode, 200, moved.body);
  assert.equal(moved.json().items[0].id, data.items[2].id);
  const stale = await app.inject({
    method: "POST",
    url: `${url}/items/${data.items[1].id}/move`,
    headers: h,
    payload: { beforeItemId: null, revision: data.playlist.revision },
  });
  assert.equal(stale.statusCode, 409);
  const rollback = await app.inject({
    method: "POST",
    url: `${url}/tracks`,
    headers: h,
    payload: { tracks: [snapshot, { id: "bad" }] },
  });
  assert.equal(rollback.statusCode, 400);
  assert.equal((await app.inject({ url, headers: h })).json().items.length, 3);
  const latest = await app.inject({ url, headers: h });
  assert.equal(
    (
      await app.inject({
        url,
        headers: { ...h, "if-none-match": latest.headers.etag },
      })
    ).statusCode,
    304,
  );
});

test("history is idempotent; private profiles/history never leak to another user", async (t) => {
  const app = await instance(t),
    alice = await register(app),
    bob = await register(app, "two"),
    h = headers(alice);
  const event = {
    trackId: snapshot.id,
    trackSnapshot: snapshot,
    playbackSessionId: "session-1",
    listeningSessionId: "listening-1",
    playedDurationMs: 200000,
    completionRate: 0.9,
  };
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/me/playback/events",
          headers: h,
          payload: event,
        })
      ).statusCode,
      204,
    );
  assert.equal(
    (await app.inject({ url: "/v1/me/history", headers: h })).json().items
      .length,
    1,
  );
  assert.equal(
    (
      await app.inject({
        url: `/v1/users/${alice.user.id}`,
        headers: headers(bob),
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        url: `/v1/users/${alice.user.id}/history`,
        headers: headers(bob),
      })
    ).statusCode,
    404,
  );
  await app.inject({
    method: "PATCH",
    url: "/v1/users/me",
    headers: h,
    payload: { isPublic: true, showHistory: true },
  });
  const profile = (
    await app.inject({
      url: `/v1/users/${alice.user.id}`,
      headers: headers(bob),
    })
  ).json();
  assert.equal(profile.email, undefined);
  assert.equal(
    (
      await app.inject({
        url: `/v1/users/${alice.user.id}/history`,
        headers: headers(bob),
      })
    ).json().items.length,
    1,
  );
});

test("legacy gateway preserves exact body, signed path, token and response; never replaces legacy data", async (t) => {
  const calls = [];
  const app = await instance(t, {
    legacyFetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({ items: [{ id: "legacy-playlist" }] }),
        {
          status: 200,
          headers: { "content-type": "application/json", etag: '"old"' },
        },
      );
    },
  });
  const h = {
    authorization: "Bearer original-token",
    "x-liner-signature": "original-signature",
    "content-type": "application/json",
  };
  const response = await app.inject({
    url: "/v1/me/playlists?limit=20",
    headers: h,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().items[0].id, "legacy-playlist");
  const raw = '{ "refreshToken": "original-refresh" }';
  await app.inject({
    method: "POST",
    url: "/v1/auth/refresh",
    headers: h,
    payload: raw,
  });
  assert.equal(
    calls[0].url,
    "https://api.tryliner.fun/v1/me/playlists?limit=20",
  );
  assert.equal(calls[0].init.headers.authorization, "Bearer original-token");
  assert.equal(calls[1].init.body, raw);
  assert.equal(
    calls[1].init.headers["x-liner-signature"],
    "original-signature",
  );
  assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM users").get().n, 0);
});

test("local users and their passwords are never forwarded to the original server", async (t) => {
  let calls = 0;
  const app = await instance(t, {
    legacyFetch: async () => {
      calls++;
      throw Error("unexpected");
    },
  });
  const session = await register(app);
  const h = headers(session);
  await app.inject({
    method: "POST",
    url: "/v1/auth/login",
    payload: identity(),
  });
  assert.equal(
    (await app.inject({ url: "/v1/me", headers: h })).statusCode,
    200,
  );
  assert.equal(
    (await app.inject({ url: "/v1/does-not-exist", headers: h })).statusCode,
    404,
  );
  assert.equal(calls, 0);
});

test("saved accounts survive closing and reopening the database", async (t) => {
  const folder = await mkdtemp(join(tmpdir(), "amour-api-test-"));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const database = join(folder, "db.sqlite");
  const first = await createApp({ database, logger: false });
  const session = await register(first);
  await first.close();
  const second = await createApp({ database, logger: false });
  t.after(() => second.close());
  const response = await second.inject({
    url: "/v1/me",
    headers: headers(session),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().id, session.user.id);
});

test("unsigned legacy mobile requests are signed server-side; proxy protection is explicit", async (t) => {
  const calls = [];
  const app = await instance(t, {
    legacyFetch: async (url, init) => {
      calls.push(init);
      return new Response("<html>Blocked</html>", {
        status: 403,
        headers: { "content-type": "text/html" },
      });
    },
  });
  const response = await app.inject({
    method: "POST",
    url: "/v1/auth/challenge",
    payload: { purpose: "login", email: "original@example.test" },
  });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().code, "LEGACY_PROXY_BLOCKED");
  assert.ok(calls[0].headers["x-liner-signature"]);
  assert.ok(calls[0].headers["x-liner-timestamp"]);
  assert.ok(calls[0].headers["x-liner-nonce"]);
  assert.equal(
    response.json().retryHeaders["x-liner-signature"],
    calls[0].headers["x-liner-signature"],
  );
  assert.deepEqual(Object.keys(response.json().retryHeaders).sort(), [
    "x-liner-nonce",
    "x-liner-signature",
    "x-liner-timestamp",
  ]);
  assert.equal(response.json().retryHeaders.authorization, undefined);
});

test("saved collections match the desktop nested collection contract", async (t) => {
  const app = await instance(t),
    session = await register(app),
    h = headers(session);
  assert.equal(
    (
      await app.inject({
        method: "PUT",
        url: "/v1/me/library/albums/album1",
        headers: h,
        payload: { snapshot: { id: "album1", title: "Album", trackCount: 5 } },
      })
    ).statusCode,
    204,
  );
  const result = (
    await app.inject({ url: "/v1/me/library/albums", headers: h })
  ).json();
  assert.equal(result.items[0].album.id, "album1");
  assert.equal(result.items[0].album.title, "Album");
  assert.ok(result.items[0].savedAt);
});
