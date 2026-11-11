export function registerDiscovery(app, { fail, text, publicUser }) {
  const db = app.db;
  const date = () => new Date().toISOString();
  const limit = (query) =>
    Math.min(100, Math.max(1, Number(query.limit) || 20));
  app.get("/v1/me/recommendations/daily-mixes", async (request) => {
    const rows = db
      .prepare(
        `SELECT t.snapshot FROM tracks t WHERE t.id IN
      (SELECT track_id FROM likes WHERE user_id=? UNION SELECT track_id FROM playback WHERE user_id=?) LIMIT 120`,
      )
      .all(request.user.id, request.user.id);
    const groups = new Map();
    for (const row of rows) {
      const track = JSON.parse(row.snapshot),
        artist = track.artists[0]?.name || "Music";
      if (!groups.has(artist)) groups.set(artist, []);
      groups.get(artist).push(track);
    }
    const selected = [...groups]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 4);
    return {
      items: selected.map(([artist, tracks], i) => ({
        id: `amour_mix_${i}`,
        title: artist,
        description: "",
        clusterArtists: [artist],
        cover: tracks[0].cover,
        trackCount: tracks.length,
        tracks,
      })),
      generatedAt: date(),
    };
  });
  app.get("/v1/explore/popular", async (request) => {
    const window = ["12h", "24h", "7d", "30d", "all"].includes(
      request.query.window,
    )
      ? request.query.window
      : "7d";
    const days = { "12h": 0.5, "24h": 1, "7d": 7, "30d": 30, all: 36500 }[
      window
    ];
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const rows = db
      .prepare(
        `SELECT t.snapshot,COUNT(*) AS plays,COUNT(DISTINCT p.user_id) AS listeners FROM playback p
      JOIN tracks t ON t.id=p.track_id JOIN users u ON u.id=p.user_id
      WHERE p.listened_at>? AND json_extract(u.profile,'$.participateLeaderboards')=1
      GROUP BY p.track_id ORDER BY plays DESC LIMIT ?`,
      )
      .all(since, limit(request.query));
    return {
      window,
      generatedAt: date(),
      items: rows.map((row, i) => ({
        rank: i + 1,
        track: JSON.parse(row.snapshot),
        playCount: row.plays,
        uniqueListeners: row.listeners,
        score: row.plays,
      })),
    };
  });
  app.get("/v1/explore/popular/albums", async (request) => ({
    window: request.query.window || "7d",
    items: [],
  }));
  app.get("/v1/explore/most-saved", async (request) => ({
    type: request.query.type || "all",
    items: [],
  }));
  for (const route of [
    "/v1/leaderboards/global",
    "/v1/leaderboards/artist/:id",
  ])
    app.get(route, async (request) => {
      const period = ["weekly", "monthly", "all_time"].includes(
        request.query.period,
      )
        ? request.query.period
        : "weekly";
      const days = { weekly: 7, monthly: 30, all_time: 36500 }[period];
      const rows = db
        .prepare(
          `SELECT u.*,SUM(json_extract(p.event,'$.playedDurationMs')) AS duration,COUNT(*) AS plays
      FROM users u JOIN playback p ON p.user_id=u.id WHERE p.listened_at>? AND json_extract(u.profile,'$.participateLeaderboards')=1
      GROUP BY u.id ORDER BY duration DESC LIMIT ?`,
        )
        .all(
          new Date(Date.now() - days * 86400000).toISOString(),
          limit(request.query),
        );
      // Artist-specific aggregates are not guessed from a global total.
      return {
        type: request.params.id ? "artist" : "global",
        targetId: request.params.id || "global",
        period,
        updatedAt: date(),
        entries: request.params.id
          ? []
          : rows.map((row, i) => {
              const user = publicUser(row);
              return {
                rank: i + 1,
                user: {
                  id: user.id,
                  username: user.username,
                  displayName: user.displayName,
                  avatarUrl: user.avatarUrl,
                },
                playedDurationMs: row.duration,
                playCount: row.plays,
              };
            }),
      };
    });
  async function lyrics(query) {
    const title = text(query.title, "title", { max: 500 }),
      artist = text(query.artist, "artist", { max: 500 });
    const params = new URLSearchParams({
      track_name: title,
      artist_name: artist,
    });
    if (Number(query.durationMs) > 0)
      params.set(
        "duration",
        String(Math.round(Number(query.durationMs) / 1000)),
      );
    try {
      const response = await fetch(`https://lrclib.net/api/get?${params}`, {
        headers: { "User-Agent": "Amour/0.1 (https://xokeza.su)" },
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      });
      if (response.status === 404) return null;
      if (!response.ok) throw new Error();
      const data = await response.json(),
        content = data.syncedLyrics || data.plainLyrics;
      if (typeof content !== "string" || content.length > 1_000_000)
        return null;
      const synced = Boolean(data.syncedLyrics);
      return {
        provider: "LRCLIB",
        contentKind: synced ? "line_synced" : "plain",
        syncLevel: synced ? "line_level" : "plain",
        matchedTrack: {
          title: data.trackName,
          artists: [data.artistName],
          durationMs: Math.round(data.duration * 1000),
        },
        lyrics: { format: synced ? "lrc" : "plain", content },
        quality: {
          total: 80,
          match: 80,
          content: 80,
          sync: synced ? 80 : 0,
          source: 80,
          reasons: [],
        },
      };
    } catch {
      throw fail(503, "LYRICS_UNAVAILABLE", "Lyrics provider is unavailable");
    }
  }
  app.get("/v1/me/lyrics/search", async (request) => {
    const candidate = await lyrics(request.query);
    if (!candidate) throw fail(404, "LYRICS_NOT_FOUND", "Lyrics not found");
    return { provider: "LRCLIB", cached: false, candidate };
  });
  app.get("/v1/tracks/:id/lyrics", async (request, reply) => {
    let candidate = null;
    if (request.query.title && request.query.artist)
      candidate = await lyrics(request.query);
    const events = candidate
      ? [
          {
            type: "provider",
            provider: "LRCLIB",
            status: "found",
            syncLevel: candidate.syncLevel,
            candidate,
          },
          {
            type: "done",
            cached: false,
            best: {
              provider: "LRCLIB",
              quality: 80,
              syncLevel: candidate.syncLevel,
            },
          },
        ]
      : [{ type: "done", cached: false, status: "not_found" }];
    reply.type("text/event-stream; charset=utf-8");
    return events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  });
}
