import { randomUUID } from "node:crypto";

export function registerLibrary(app, { fail, text, transaction, publicUser }) {
  const db = app.db;
  const now = () => new Date().toISOString();
  function page(query = {}) {
    const size = Math.min(200, Math.max(1, Number(query.limit) || 100));
    let offset = 0;
    if (query.cursor) {
      offset = Number(
        Buffer.from(String(query.cursor), "base64url").toString(),
      );
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000)
        throw fail(400, "INVALID_INPUT", "Invalid cursor");
    }
    return { size: Math.floor(size), offset };
  }
  const cursor = (offset, hasNext) =>
    hasNext ? Buffer.from(String(offset)).toString("base64url") : null;
  function track(snapshot, expectedId) {
    if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
      throw fail(400, "INVALID_INPUT", "A track snapshot is required");
    const id = text(snapshot.id, "track.id", { max: 256 });
    if ((expectedId && id !== expectedId) || id.startsWith("local:"))
      throw fail(400, "INVALID_INPUT", "Invalid track identifier");
    const title = text(snapshot.title, "track.title", { max: 500 });
    if (
      !Array.isArray(snapshot.artists) ||
      !snapshot.artists.length ||
      snapshot.artists.length > 30
    )
      throw fail(400, "INVALID_INPUT", "Track artists are required");
    const artists = snapshot.artists.map((item) => ({
      id: text(item?.id, "artist.id", { max: 256 }),
      name: text(item?.name, "artist.name", { max: 300 }),
    }));
    const durationMs = Number(snapshot.durationMs ?? 0);
    if (
      !Number.isSafeInteger(durationMs) ||
      durationMs < 0 ||
      durationMs > 604800000
    )
      throw fail(400, "INVALID_INPUT", "Invalid track duration");
    const result = { id, title, artists, durationMs };
    if (snapshot.album)
      result.album = {
        id: text(snapshot.album.id, "album.id", { max: 256 }),
        title: text(snapshot.album.title, "album.title", { max: 500 }),
      };
    if (snapshot.cover?.url)
      result.cover = {
        url: text(snapshot.cover.url, "cover.url", { max: 4096 }),
        width: Number(snapshot.cover.width) || 480,
        height: Number(snapshot.cover.height) || 480,
      };
    if (typeof snapshot.explicit === "boolean")
      result.explicit = snapshot.explicit;
    if (["music-video", "premium-only"].includes(snapshot.audioVariant))
      result.audioVariant = snapshot.audioVariant;
    db.prepare(
      "INSERT INTO tracks(id,snapshot) VALUES(?,?) ON CONFLICT(id) DO NOTHING",
    ).run(id, JSON.stringify(result));
    return getTrack(id);
  }
  function getTrack(id) {
    const row = db.prepare("SELECT snapshot FROM tracks WHERE id=?").get(id);
    return row ? JSON.parse(row.snapshot) : null;
  }
  function owned(id, userId) {
    const row = db
      .prepare("SELECT * FROM playlists WHERE id=? AND user_id=?")
      .get(id, userId);
    if (!row) throw fail(404, "NOT_FOUND", "Playlist not found");
    return row;
  }
  function playlist(row) {
    const details = db
      .prepare(
        "SELECT COUNT(*) AS count FROM playlist_items WHERE playlist_id=?",
      )
      .get(row.id);
    const covers = db
      .prepare(
        "SELECT t.snapshot FROM playlist_items i JOIN tracks t ON t.id=i.track_id WHERE i.playlist_id=? ORDER BY i.position LIMIT 4",
      )
      .all(row.id)
      .flatMap((item) => {
        const cover = JSON.parse(item.snapshot).cover?.url;
        return cover ? [cover] : [];
      });
    const owner = db
      .prepare("SELECT id,username,profile FROM users WHERE id=?")
      .get(row.user_id);
    return {
      id: row.id,
      title: row.title,
      description: row.description || undefined,
      isPublic: Boolean(row.is_public),
      revision: row.revision,
      trackCount: details.count,
      coverUrls: covers,
      ownerId: row.user_id,
      owner: {
        id: owner.id,
        username: owner.username,
        displayName: JSON.parse(owner.profile).displayName,
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
  function items(id) {
    return db
      .prepare(
        "SELECT i.*,t.snapshot FROM playlist_items i JOIN tracks t ON t.id=i.track_id WHERE i.playlist_id=? ORDER BY i.position,i.id",
      )
      .all(id)
      .map((row) => ({
        id: row.id,
        track: JSON.parse(row.snapshot),
        position: row.position,
        addedAt: row.added_at,
      }));
  }
  function bump(id) {
    db.prepare(
      "UPDATE playlists SET revision=revision+1,updated_at=? WHERE id=?",
    ).run(now(), id);
  }
  function addItem(id, snapshot) {
    const saved = track(snapshot);
    const position = db
      .prepare(
        "SELECT COALESCE(MAX(position),-1)+1 AS position FROM playlist_items WHERE playlist_id=?",
      )
      .get(id).position;
    const item = { id: randomUUID(), track: saved, position, addedAt: now() };
    db.prepare(
      "INSERT INTO playlist_items(id,playlist_id,track_id,position,added_at) VALUES(?,?,?,?,?)",
    ).run(item.id, id, saved.id, position, item.addedAt);
    return item;
  }
  app.get("/v1/me/library/tracks", async (request) => {
    const { size, offset } = page(request.query);
    const rows = db
      .prepare(
        "SELECT l.*,t.snapshot FROM likes l JOIN tracks t ON t.id=l.track_id WHERE l.user_id=? ORDER BY l.liked_at DESC,l.track_id LIMIT ? OFFSET ?",
      )
      .all(request.user.id, size + 1, offset);
    return {
      items: rows
        .slice(0, size)
        .map((row) => ({
          track: { ...JSON.parse(row.snapshot), viewer: { liked: true } },
          likedAt: row.liked_at,
        })),
      nextCursor: cursor(offset + size, rows.length > size),
    };
  });
  app.put("/v1/me/library/tracks/:id", async (request, reply) => {
    transaction(db, () => {
      const saved = track(
        request.body?.track ||
          request.body?.trackSnapshot ||
          getTrack(request.params.id),
        request.params.id,
      );
      db.prepare(
        "INSERT INTO likes(user_id,track_id,liked_at) VALUES(?,?,?) ON CONFLICT DO NOTHING",
      ).run(request.user.id, saved.id, now());
    });
    return reply.code(204).send();
  });
  app.delete("/v1/me/library/tracks/:id", async (request, reply) => {
    db.prepare("DELETE FROM likes WHERE user_id=? AND track_id=?").run(
      request.user.id,
      request.params.id,
    );
    return reply.code(204).send();
  });
  function kind(value) {
    if (!["albums", "artists", "playlists"].includes(value))
      throw fail(400, "INVALID_INPUT", "Invalid collection type");
    return value;
  }
  app.get("/v1/me/library/:kind", async (request) => ({
    items: db
      .prepare(
        "SELECT id,snapshot,saved_at FROM collections WHERE user_id=? AND kind=? ORDER BY saved_at DESC",
      )
      .all(request.user.id, kind(request.params.kind))
      .map((row) => ({
        [request.params.kind.slice(0, -1)]: {
          ...JSON.parse(row.snapshot),
          id: row.id,
        },
        savedAt: row.saved_at,
      })),
  }));
  app.put("/v1/me/library/:kind/:id", async (request, reply) => {
    const snapshot = request.body?.snapshot || {};
    if (typeof snapshot !== "object" || Array.isArray(snapshot))
      throw fail(400, "INVALID_INPUT", "Invalid snapshot");
    db.prepare(
      "INSERT INTO collections(user_id,kind,id,snapshot,saved_at) VALUES(?,?,?,?,?) ON CONFLICT(user_id,kind,id) DO UPDATE SET snapshot=excluded.snapshot",
    ).run(
      request.user.id,
      kind(request.params.kind),
      text(request.params.id, "id", { max: 256 }),
      JSON.stringify(snapshot),
      now(),
    );
    return reply.code(204).send();
  });
  app.delete("/v1/me/library/:kind/:id", async (request, reply) => {
    db.prepare(
      "DELETE FROM collections WHERE user_id=? AND kind=? AND id=?",
    ).run(request.user.id, kind(request.params.kind), request.params.id);
    return reply.code(204).send();
  });

  app.get("/v1/me/playlists", async (request) => ({
    items: db
      .prepare(
        "SELECT * FROM playlists WHERE user_id=? ORDER BY updated_at DESC",
      )
      .all(request.user.id)
      .map(playlist),
  }));
  app.post("/v1/me/playlists", async (request, reply) => {
    const body = request.body || {},
      date = now(),
      id = randomUUID();
    if (body.isPublic !== undefined && typeof body.isPublic !== "boolean")
      throw fail(400, "INVALID_INPUT", "Invalid visibility");
    db.prepare(
      "INSERT INTO playlists(id,user_id,title,description,is_public,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    ).run(
      id,
      request.user.id,
      text(body.title, "title", { max: 200 }),
      text(body.description, "description", { max: 2000, optional: true }) ||
        null,
      body.isPublic ? 1 : 0,
      date,
      date,
    );
    reply.code(201);
    return playlist(owned(id, request.user.id));
  });
  app.get("/v1/me/playlists/:id", async (request, reply) => {
    const row = owned(request.params.id, request.user.id),
      all = items(row.id),
      etag = `"${row.id}:${row.revision}"`;
    reply.header("etag", etag);
    if (request.headers["if-none-match"] === etag)
      return reply.code(304).send();
    const limit = request.query.limit
      ? Math.min(5000, Math.max(1, Number(request.query.limit) || 100))
      : all.length;
    return {
      playlist: playlist(row),
      items: all.slice(0, limit),
      trackCount: all.length,
      durationMs: all.reduce((sum, item) => sum + item.track.durationMs, 0),
      partial: limit < all.length,
    };
  });
  app.patch("/v1/me/playlists/:id", async (request) => {
    const row = owned(request.params.id, request.user.id),
      body = request.body || {};
    if (body.isPublic !== undefined && typeof body.isPublic !== "boolean")
      throw fail(400, "INVALID_INPUT", "Invalid visibility");
    db.prepare(
      "UPDATE playlists SET title=?,description=?,is_public=?,revision=revision+1,updated_at=? WHERE id=?",
    ).run(
      body.title === undefined
        ? row.title
        : text(body.title, "title", { max: 200 }),
      body.description === undefined
        ? row.description
        : text(body.description, "description", {
            max: 2000,
            min: 0,
            optional: true,
          }) || null,
      body.isPublic === undefined ? row.is_public : body.isPublic ? 1 : 0,
      now(),
      row.id,
    );
    return playlist(owned(row.id, request.user.id));
  });
  app.delete("/v1/me/playlists/:id", async (request, reply) => {
    owned(request.params.id, request.user.id);
    db.prepare("DELETE FROM playlists WHERE id=?").run(request.params.id);
    return reply.code(204).send();
  });
  app.post("/v1/me/playlists/:id/tracks", async (request) => {
    owned(request.params.id, request.user.id);
    const list = request.body?.tracks;
    if (!Array.isArray(list) || list.length > 5000)
      throw fail(
        400,
        "INVALID_INPUT",
        "At most 5000 tracks can be added in one request",
      );
    return transaction(db, () => {
      const added = list.map((snapshot) =>
        addItem(request.params.id, snapshot),
      );
      if (added.length) bump(request.params.id);
      return { items: added, added: added.length, rejected: 0 };
    });
  });
  app.post("/v1/me/playlists/:id/tracks/:trackId", async (request) => {
    owned(request.params.id, request.user.id);
    const snapshot =
      request.body?.track ||
      request.body?.trackSnapshot ||
      getTrack(request.params.trackId);
    if (snapshot?.id !== request.params.trackId)
      throw fail(400, "INVALID_INPUT", "A matching track snapshot is required");
    return transaction(db, () => {
      const item = addItem(request.params.id, snapshot);
      bump(request.params.id);
      return item;
    });
  });
  app.delete("/v1/me/playlists/:id/items/:itemId", async (request, reply) => {
    owned(request.params.id, request.user.id);
    transaction(db, () => {
      const result = db
        .prepare("DELETE FROM playlist_items WHERE id=? AND playlist_id=?")
        .run(request.params.itemId, request.params.id);
      if (!result.changes)
        throw fail(404, "NOT_FOUND", "Playlist item not found");
      bump(request.params.id);
    });
    return reply.code(204).send();
  });
  app.post("/v1/me/playlists/:id/items/:itemId/move", async (request) => {
    return transaction(db, () => {
      const row = owned(request.params.id, request.user.id);
      if (request.body?.revision !== row.revision)
        throw fail(
          409,
          "REVISION_CONFLICT",
          "The playlist changed; reload before moving this item",
        );
      const ordered = items(row.id),
        from = ordered.findIndex((item) => item.id === request.params.itemId);
      if (from < 0) throw fail(404, "NOT_FOUND", "Playlist item not found");
      const [moving] = ordered.splice(from, 1);
      let before = ordered.length;
      if (request.body.beforeItemId !== null) {
        before = ordered.findIndex(
          (item) => item.id === request.body.beforeItemId,
        );
        if (before < 0)
          throw fail(404, "NOT_FOUND", "Destination item not found");
      }
      ordered.splice(before, 0, moving);
      const update = db.prepare(
        "UPDATE playlist_items SET position=? WHERE id=?",
      );
      ordered.forEach((item, index) => update.run(index, item.id));
      bump(row.id);
      return {
        playlist: playlist(owned(row.id, request.user.id)),
        items: items(row.id),
      };
    });
  });
  app.post("/v1/me/playback/events", async (request, reply) => {
    const body = request.body || {};
    const id = text(body.trackId, "trackId", { max: 256 }),
      session = text(body.playbackSessionId, "playbackSessionId", { max: 256 });
    const duration = body.playedDurationMs,
      completion = body.completionRate;
    if (
      !Number.isFinite(duration) ||
      duration < 0 ||
      duration > 604800000 ||
      !Number.isFinite(completion) ||
      completion < 0 ||
      completion > 1
    )
      throw fail(400, "INVALID_INPUT", "Invalid playback duration");
    transaction(db, () => {
      track(body.trackSnapshot || getTrack(id), id);
      db.prepare(
        "INSERT INTO playback(id,user_id,session_id,track_id,event,listened_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,session_id) DO UPDATE SET event=excluded.event,listened_at=excluded.listened_at",
      ).run(
        randomUUID(),
        request.user.id,
        session,
        id,
        JSON.stringify({ ...body, trackSnapshot: undefined }),
        now(),
      );
    });
    return reply.code(204).send();
  });
  function history(userId, query) {
    const { size, offset } = page(query);
    const rows = db
      .prepare(
        "SELECT p.*,t.snapshot FROM playback p JOIN tracks t ON t.id=p.track_id WHERE p.user_id=? ORDER BY p.listened_at DESC,p.id DESC LIMIT ? OFFSET ?",
      )
      .all(userId, size + 1, offset);
    return {
      items: rows
        .slice(0, size)
        .map((row) => ({
          id: row.id,
          ...JSON.parse(row.event),
          track: JSON.parse(row.snapshot),
          listenedAt: row.listened_at,
        })),
      nextCursor: cursor(offset + size, rows.length > size),
    };
  }
  app.get("/v1/me/history", async (request) =>
    history(request.user.id, request.query),
  );
  function findUser(id) {
    const row = db
      .prepare("SELECT * FROM users WHERE id=? OR username=?")
      .get(id, id);
    if (!row) throw fail(404, "NOT_FOUND", "User not found");
    return row;
  }
  function profile(row, viewer) {
    const { email: _, ...user } = publicUser(row);
    return {
      ...user,
      createdAt: row.created_at,
      followersCount: db
        .prepare("SELECT COUNT(*) AS n FROM follows WHERE followed=?")
        .get(row.id).n,
      followingCount: db
        .prepare("SELECT COUNT(*) AS n FROM follows WHERE follower=?")
        .get(row.id).n,
      isFollowing: Boolean(
        db
          .prepare("SELECT 1 FROM follows WHERE follower=? AND followed=?")
          .get(viewer, row.id),
      ),
      privacy: JSON.parse(row.profile),
    };
  }
  function visible(row, viewer, setting) {
    const privacy = JSON.parse(row.profile);
    if (
      row.id !== viewer &&
      (!privacy.isPublic || (setting && !privacy[setting]))
    )
      throw fail(404, "NOT_FOUND", "User not found");
  }
  app.get("/v1/users/search", async (request) => {
    const query = text(request.query.q, "q", { max: 100 });
    return db
      .prepare(
        "SELECT * FROM users WHERE username LIKE ? OR json_extract(profile,'$.displayName') LIKE ? LIMIT 30",
      )
      .all(`%${query}%`, `%${query}%`)
      .filter((row) => JSON.parse(row.profile).isPublic)
      .map((row) => profile(row, request.user.id));
  });
  app.get("/v1/users/:id", async (request) => {
    const row = findUser(request.params.id);
    visible(row, request.user.id);
    return profile(row, request.user.id);
  });
  app.get("/v1/users/:id/history", async (request) => {
    const row = findUser(request.params.id);
    visible(row, request.user.id, "showHistory");
    return history(row.id, request.query);
  });
  app.get("/v1/users/:id/playlists", async (request) => {
    const row = findUser(request.params.id);
    visible(row, request.user.id);
    return {
      items: db
        .prepare(
          "SELECT * FROM playlists WHERE user_id=? AND is_public=1 ORDER BY updated_at DESC",
        )
        .all(row.id)
        .map(playlist),
    };
  });
  app.post("/v1/users/:id/follow", async (request, reply) => {
    const row = findUser(request.params.id);
    visible(row, request.user.id);
    if (row.id === request.user.id)
      throw fail(400, "INVALID_INPUT", "You cannot follow yourself");
    db.prepare(
      "INSERT INTO follows(follower,followed) VALUES(?,?) ON CONFLICT DO NOTHING",
    ).run(request.user.id, row.id);
    return reply.code(204).send();
  });
  app.delete("/v1/users/:id/follow", async (request, reply) => {
    const row = findUser(request.params.id);
    db.prepare("DELETE FROM follows WHERE follower=? AND followed=?").run(
      request.user.id,
      row.id,
    );
    return reply.code(204).send();
  });
  for (const [path, column, other] of [
    ["followers", "followed", "follower"],
    ["following", "follower", "followed"],
  ])
    app.get(`/v1/users/:id/${path}`, async (request) => {
      const row = findUser(request.params.id);
      visible(row, request.user.id);
      return db
        .prepare(
          `SELECT u.* FROM users u JOIN follows f ON f.${other}=u.id WHERE f.${column}=? LIMIT 200`,
        )
        .all(row.id)
        .filter((item) => JSON.parse(item.profile).isPublic)
        .map((item) => profile(item, request.user.id));
    });
}
