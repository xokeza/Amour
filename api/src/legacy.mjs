import { signRequest } from "./legacy-signer.mjs";
const FORWARDED_HEADERS = [
  "authorization",
  "content-type",
  "user-agent",
  "accept-language",
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
];
const RESPONSE_HEADERS = [
  "content-type",
  "etag",
  "retry-after",
  "date",
  "x-request-id",
];

// Fixed upstream and path allowlist: this is a compatibility gateway, never an open proxy.
export function legacyGateway(base, fetcher = fetch) {
  const origin = new URL(base);
  if (
    origin.protocol !== "https:" &&
    !["127.0.0.1", "localhost"].includes(origin.hostname)
  )
    throw new Error("Legacy upstream must use HTTPS");
  return async function relay(request, reply) {
    if (
      !/^\/v1\/(auth\/(?:login|challenge|refresh|logout)|me(?:\/|\?|$)|users(?:\/|\?|$)|catalog\/|tracks\/|explore\/|leaderboards\/)/.test(
        request.raw.url,
      )
    )
      return reply
        .code(404)
        .send({ code: "NOT_FOUND", message: "Endpoint not found" });
    const headers = {};
    for (const key of FORWARDED_HEADERS)
      if (typeof request.headers[key] === "string")
        headers[key] = request.headers[key];
    try {
      // Mobile clients have no Electron signer. Reuse the unmodified bundled signer
      // on this fixed-upstream gateway only; signing material never enters the APK.
      if (!headers["x-liner-signature"]) {
        const signed = signRequest({
          method: request.method,
          path: request.raw.url.split("?")[0],
          body: request.rawBody || "",
        });
        headers["x-liner-signature"] = signed.signature;
        headers["x-liner-timestamp"] = String(signed.timestamp);
        headers["x-liner-nonce"] = signed.nonce;
      }
      const response = await fetcher(`${origin.origin}${request.raw.url}`, {
        method: request.method,
        headers,
        ...(!["GET", "HEAD"].includes(request.method) &&
        request.rawBody !== undefined
          ? { body: request.rawBody }
          : {}),
        signal: AbortSignal.timeout(25000),
        redirect: "manual",
      });
      const contentType = response.headers.get("content-type") || "";
      if (
        [403, 429].includes(response.status) &&
        contentType.includes("text/html")
      ) {
        await response.body?.cancel();
        return reply
          .code(503)
          .send({
            code: "LEGACY_PROXY_BLOCKED",
            retryHeaders: Object.fromEntries(
              ["x-liner-signature", "x-liner-timestamp", "x-liner-nonce"].map(
                (key) => [key, headers[key]],
              ),
            ),
            message:
              "The original account service blocked the proxy. Existing desktop sessions can retry the original endpoint directly.",
          });
      }
      if (
        response.status >= 300 &&
        response.status < 400 &&
        response.status !== 304
      )
        return reply
          .code(502)
          .send({
            code: "LEGACY_UNAVAILABLE",
            message: "The original account service redirected unexpectedly.",
          });
      for (const key of RESPONSE_HEADERS) {
        const value = response.headers.get(key);
        if (value) reply.header(key, value);
      }
      reply.code(response.status);
      // Stream responses (including lyric SSE), without buffering an unbounded response body.
      return reply.send(
        response.body
          ? (await import("node:stream")).Readable.fromWeb(response.body)
          : null,
      );
    } catch {
      return reply
        .code(503)
        .send({
          code: "LEGACY_UNAVAILABLE",
          message:
            "The original account service is unavailable. Your saved data has not been changed.",
        });
    }
  };
}
