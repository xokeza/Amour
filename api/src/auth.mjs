import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt as callbackScrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { transaction } from "./database.mjs";

const scrypt = promisify(callbackScrypt);
const ACCESS_TTL = 15 * 60_000;
const REFRESH_TTL = 30 * 24 * 60 * 60_000;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const options = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function passwordHash(password) {
  const salt = randomBytes(24).toString("hex");
  return `scrypt$${salt}$${(await scrypt(password, salt, 64, options)).toString("hex")}`;
}
export async function verifyPassword(password, encoded) {
  const [, salt, expected] = (encoded || "").split("$");
  const actual = await scrypt(
    password,
    salt || "amour-dummy-verification",
    64,
    options,
  );
  const stored = Buffer.from(expected || "00".repeat(64), "hex");
  return Boolean(
    salt && stored.length === actual.length && timingSafeEqual(stored, actual),
  );
}
export function publicUser(row) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    ...JSON.parse(row.profile),
  };
}
function tokens() {
  return {
    accessToken: "amour_a_" + randomBytes(32).toString("base64url"),
    refreshToken: "amour_r_" + randomBytes(48).toString("base64url"),
  };
}
export function createSession(db, user) {
  const pair = tokens();
  const now = Date.now();
  db.prepare(
    "INSERT INTO sessions(id,user_id,access_hash,refresh_hash,access_expires,refresh_expires) VALUES(?,?,?,?,?,?)",
  ).run(
    randomUUID(),
    user.id,
    hash(pair.accessToken),
    hash(pair.refreshToken),
    now + ACCESS_TTL,
    now + REFRESH_TTL,
  );
  return {
    ...pair,
    accessTokenExpiresAt: new Date(now + ACCESS_TTL).toISOString(),
    user: publicUser(user),
  };
}
export function authenticate(db, token) {
  if (!token?.startsWith("amour_a_")) return null;
  return (
    db
      .prepare(
        "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.access_hash=? AND s.revoked=0 AND s.access_expires>? AND s.refresh_expires>?",
      )
      .get(hash(token), Date.now(), Date.now()) || null
  );
}
export function refreshSession(db, token) {
  return transaction(db, () => {
    const digest = hash(token);
    const row = db
      .prepare("SELECT * FROM sessions WHERE refresh_hash=? AND revoked=0")
      .get(digest);
    if (!row) {
      const used = db
        .prepare(
          "SELECT session_id FROM used_refresh WHERE token_hash=? AND expires>?",
        )
        .get(digest, Date.now());
      if (used)
        db.prepare("UPDATE sessions SET revoked=1 WHERE id=?").run(
          used.session_id,
        );
      return null;
    }
    if (row.refresh_expires <= Date.now()) return null;
    const user = db.prepare("SELECT * FROM users WHERE id=?").get(row.user_id);
    const pair = tokens();
    const expiry = Date.now() + ACCESS_TTL;
    db.prepare(
      "INSERT INTO used_refresh(token_hash,session_id,expires) VALUES(?,?,?)",
    ).run(digest, row.id, row.refresh_expires);
    db.prepare(
      "UPDATE sessions SET access_hash=?,refresh_hash=?,access_expires=? WHERE id=?",
    ).run(hash(pair.accessToken), hash(pair.refreshToken), expiry, row.id);
    db.prepare("DELETE FROM used_refresh WHERE expires<?").run(Date.now());
    return {
      ...pair,
      accessTokenExpiresAt: new Date(expiry).toISOString(),
      user: publicUser(user),
    };
  });
}
export function revokeSession(db, token) {
  db.prepare("UPDATE sessions SET revoked=1 WHERE refresh_hash=?").run(
    hash(token),
  );
}
