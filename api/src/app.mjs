import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { randomUUID } from "node:crypto";
import { openDatabase, transaction } from "./database.mjs";
import {
  authenticate,
  createSession,
  passwordHash,
  publicUser,
  refreshSession,
  revokeSession,
  verifyPassword,
} from "./auth.mjs";
import { legacyGateway } from "./legacy.mjs";
import { registerLibrary } from "./library.mjs";
import { registerDiscovery } from "./discovery.mjs";

export function fail(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}
export function text(
  value,
  name,
  { min = 1, max = 200, optional = false } = {},
) {
  if (optional && (value === undefined || value === null)) return undefined;
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.length > max
  )
    throw fail(400, "INVALID_INPUT", `Invalid ${name}`);
  return value.trim();
}
export function email(value) {
  const result = text(value, "email", { max: 254 }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))
    throw fail(400, "INVALID_INPUT", "Invalid email");
  return result;
}
function password(value) {
  if (typeof value !== "string" || value.length < 8 || value.length > 128)
    throw fail(400, "INVALID_INPUT", "Password must contain 8–128 characters");
  return value;
}
function username(value) {
  const result = text(value, "username", { max: 30 }).toLowerCase();
  if (!/^[a-z0-9_]{3,30}$/.test(result))
    throw fail(
      400,
      "INVALID_USERNAME",
      "Username must contain 3–30 lowercase letters, digits or underscores",
    );
  return result;
}

export async function createApp(options = {}) {
  const app = Fastify({
    logger: options.logger ?? {
      level: "info",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "body.password",
        "body.refreshToken",
      ],
    },
    trustProxy: ["127.0.0.1", "::1"],
    bodyLimit: 2 * 1024 * 1024,
    requestTimeout: 30_000,
    connectionTimeout: 10_000,
  });
  const db = openDatabase(
    options.database || process.env.AMOUR_DATABASE || "./data/amour.sqlite",
  );
  app.decorate("db", db);
  app.decorateRequest("user", null);
  app.decorateRequest("rawBody", null);
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, body, done) => {
      request.rawBody = body;
      try {
        const parsed = JSON.parse(body);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== "object")
          throw new Error();
        done(null, parsed);
      } catch {
        done(fail(400, "INVALID_INPUT", "Request body must be a JSON object"));
      }
    },
  );
  await app.register(cors, {
    origin: options.allowedOrigins || [
      "https://xokeza.su",
      "https://api.xokeza.su",
      "capacitor://localhost",
      "http://localhost",
      "https://localhost",
      "null",
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "content-type",
      "authorization",
      "x-liner-signature",
      "x-liner-timestamp",
      "x-liner-nonce",
      "x-client-version",
      "x-platform",
      "x-request-id",
      "x-session-id",
      "x-liner-pow",
      "x-turnstile-token",
      "x-turnstile-edge-token",
      "if-none-match",
    ],
    exposedHeaders: ["date", "etag", "retry-after", "x-request-id"],
    maxAge: 600,
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 180, timeWindow: "1 minute" });
  app.addHook("onSend", async (request, reply, payload) => {
    reply.header("x-request-id", request.id);
    if (request.url.startsWith("/v1/"))
      reply.header("cache-control", "no-store");
    return payload;
  });
  app.setErrorHandler((error, request, reply) => {
    const status =
      error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : 500;
    if (status >= 500) request.log.error({ err: error }, "Request failed");
    reply
      .code(status)
      .send({
        code: status === 500 ? "INTERNAL_ERROR" : error.code || "INVALID_INPUT",
        message: status === 500 ? "Internal server error" : error.message,
        requestId: request.id,
      });
  });
  app.addHook("onClose", () => db.close());
  const relay = legacyGateway(
    options.legacyBase ||
      process.env.AMOUR_LEGACY_BASE ||
      "https://api.tryliner.fun",
    options.legacyFetch,
  );
  app.addHook("preHandler", async (request, reply) => {
    if (
      !request.url.startsWith("/v1/") ||
      request.url.startsWith("/v1/auth/") ||
      request.url.startsWith("/v1/telemetry/") ||
      request.url.split("?")[0] === "/v1/presence/heartbeat" ||
      request.method === "OPTIONS"
    )
      return;
    const token = request.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
    if (!token) throw fail(401, "UNAUTHORIZED", "Sign in to continue");
    if (!token.startsWith("amour_a_")) return relay(request, reply);
    request.user = authenticate(db, token);
    if (!request.user)
      throw fail(401, "ACCESS_TOKEN_EXPIRED", "Your session has expired");
  });

  app.get("/", async () => ({
    service: "amour-api",
    version: "0.1.3",
    health: "health",
    registration: "v1/auth/register",
    login: "v1/auth/login",
  }));
  app.get("/health", async () => ({
    ok: true,
    service: "amour-api",
    version: "0.1.3",
  }));
  app.post("/v1/presence/heartbeat", async (request, reply) =>
    reply.header("x-amour-heartbeat-interval", "60").code(204).send(),
  );
  for (const route of ["/v1/telemetry/ingest", "/v1/telemetry/error"])
    app.post(route, async (request, reply) => reply.code(204).send());
  const authLimit = {
    config: { rateLimit: { max: 12, timeWindow: "1 minute" } },
  };
  app.post("/v1/auth/challenge", authLimit, async (request, reply) => {
    const purpose = request.body?.purpose;
    const address = email(request.body?.email);
    if (!["login", "register"].includes(purpose))
      throw fail(400, "INVALID_INPUT", "Invalid purpose");
    if (
      purpose === "login" &&
      !db.prepare("SELECT id FROM users WHERE email=?").get(address)
    )
      return relay(request, reply);
    return { mode: "off", algorithm: "none", turnstile: { mode: "off" } };
  });
  app.post("/v1/auth/register", authLimit, async (request, reply) => {
    const body = request.body || {};
    const address = email(body.email),
      name = username(body.username),
      pass = password(body.password);
    const displayName = text(body.displayName, "displayName", { max: 100 });
    if (db.prepare("SELECT id FROM users WHERE email=?").get(address))
      throw fail(409, "EMAIL_ALREADY_USED", "This email is already registered");
    if (db.prepare("SELECT id FROM users WHERE username=?").get(name))
      throw fail(409, "USERNAME_TAKEN", "This username is already taken");
    const encoded = await passwordHash(pass);
    const id = randomUUID();
    try {
      db.prepare(
        "INSERT INTO users(id,email,username,password_hash,profile,created_at) VALUES(?,?,?,?,?,?)",
      ).run(
        id,
        address,
        name,
        encoded,
        JSON.stringify({
          displayName,
          isPublic: false,
          showActivity: false,
          showHistory: false,
          showLikedTracks: false,
          participateLeaderboards: false,
        }),
        new Date().toISOString(),
      );
    } catch (error) {
      if (db.prepare("SELECT id FROM users WHERE email=?").get(address))
        throw fail(
          409,
          "EMAIL_ALREADY_USED",
          "This email is already registered",
        );
      if (db.prepare("SELECT id FROM users WHERE username=?").get(name))
        throw fail(409, "USERNAME_TAKEN", "This username is already taken");
      throw error;
    }
    reply.code(201);
    return createSession(
      db,
      db.prepare("SELECT * FROM users WHERE id=?").get(id),
    );
  });
  app.post("/v1/auth/login", authLimit, async (request, reply) => {
    const address = email(request.body?.email),
      pass = password(request.body?.password);
    const user = db.prepare("SELECT * FROM users WHERE email=?").get(address);
    if (!user) return relay(request, reply);
    if (!(await verifyPassword(pass, user.password_hash)))
      throw fail(401, "INVALID_CREDENTIALS", "Email or password is incorrect");
    return createSession(db, user);
  });
  app.post("/v1/auth/refresh", authLimit, async (request, reply) => {
    const token = text(request.body?.refreshToken, "refreshToken", {
      max: 4096,
    });
    if (!token.startsWith("amour_r_")) return relay(request, reply);
    const result = refreshSession(db, token);
    if (!result)
      throw fail(
        401,
        "INVALID_REFRESH_TOKEN",
        "This refresh session is no longer valid",
      );
    return result;
  });
  app.post("/v1/auth/logout", authLimit, async (request, reply) => {
    const token = text(request.body?.refreshToken, "refreshToken", {
      max: 4096,
    });
    if (!token.startsWith("amour_r_")) return relay(request, reply);
    revokeSession(db, token);
    return reply.code(204).send();
  });
  app.get("/v1/me", async (request) => publicUser(request.user));
  app.patch("/v1/users/me", async (request) => {
    const body = request.body || {};
    const profile = JSON.parse(request.user.profile);
    for (const key of ["displayName", "bio"])
      if (body[key] !== undefined)
        profile[key] =
          text(body[key], key, {
            max: key === "bio" ? 2000 : 100,
            optional: true,
            min: 0,
          }) ?? null;
    if (body.avatarUrl !== undefined) {
      if (body.avatarUrl === null || body.avatarUrl === "")
        profile.avatarUrl = null;
      else {
        const url = new URL(text(body.avatarUrl, "avatarUrl", { max: 2048 }));
        if (url.protocol !== "https:")
          throw fail(400, "INVALID_INPUT", "Avatar must use HTTPS");
        profile.avatarUrl = url.href;
      }
    }
    for (const key of [
      "isPublic",
      "showActivity",
      "showHistory",
      "showLikedTracks",
      "participateLeaderboards",
    ])
      if (body[key] !== undefined) {
        if (typeof body[key] !== "boolean")
          throw fail(400, "INVALID_INPUT", `Invalid ${key}`);
        profile[key] = body[key];
      }
    const name =
      body.username === undefined
        ? request.user.username
        : username(body.username);
    if (
      db
        .prepare("SELECT id FROM users WHERE username=? AND id!=?")
        .get(name, request.user.id)
    )
      throw fail(409, "USERNAME_TAKEN", "This username is already taken");
    db.prepare("UPDATE users SET username=?,profile=? WHERE id=?").run(
      name,
      JSON.stringify(profile),
      request.user.id,
    );
    return publicUser(
      db.prepare("SELECT * FROM users WHERE id=?").get(request.user.id),
    );
  });
  registerLibrary(app, { fail, text, transaction, publicUser });
  registerDiscovery(app, { fail, text, publicUser });
  app.setNotFoundHandler(async (request, reply) => {
    // Existing sessions retain compatibility with original endpoints beyond our local feature set.
    const token = request.headers.authorization?.match(/^Bearer (\S+)$/i)?.[1];
    if (token && !token.startsWith("amour_a_")) return relay(request, reply);
    return reply
      .code(404)
      .send({ code: "NOT_FOUND", message: "Endpoint not found" });
  });
  return app;
}
