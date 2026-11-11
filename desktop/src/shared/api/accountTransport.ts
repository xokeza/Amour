const CURRENT_API = "https://xokeza.su/amour/api";
const LEGACY_API = "https://api.tryliner.fun";

/** A blocked compatibility proxy must not strand an existing desktop account. */
export async function fetchAccountApi(
  fetcher: (url: string, init: RequestInit) => Promise<Response>,
  url: string,
  init: RequestInit,
): Promise<Response> {
  const response = await fetcher(url, init);
  if (response.status !== 503 || !url.startsWith(CURRENT_API + "/v1/"))
    return response;
  const data = await response
    .clone()
    .json()
    .catch(() => null);
  if (data?.code !== "LEGACY_PROXY_BLOCKED") return response;
  const headers = new Headers(init.headers);
  const token = headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  let body: Record<string, unknown> = {};
  if (typeof init.body === "string") {
    try {
      body = JSON.parse(init.body);
    } catch {
      return response;
    }
  }
  const path = url.slice(CURRENT_API.length);
  const legacyAccount = Boolean(token && !token.startsWith("amour_a_"));
  const legacyRefresh =
    typeof body.refreshToken === "string" &&
    !body.refreshToken.startsWith("amour_r_");
  const legacyLogin =
    path === "/v1/auth/login" ||
    (path === "/v1/auth/challenge" && body.purpose === "login");
  if (
    token?.startsWith("amour_a_") ||
    (typeof body.refreshToken === "string" &&
      body.refreshToken.startsWith("amour_r_"))
  )
    return response;
  if (!legacyAccount && !legacyRefresh && !legacyLogin) return response;
  // Only an explicit proxy block qualifies. Never retry a mutation after a timeout,
  // and never send new Amour accounts or registrations to the original service.
  if (!headers.has("x-liner-signature") && data.retryHeaders) {
    const keys = ["x-liner-signature", "x-liner-timestamp", "x-liner-nonce"];
    if (
      keys.every(
        (key) =>
          typeof data.retryHeaders[key] === "string" &&
          data.retryHeaders[key].length <= 512,
      )
    ) {
      for (const key of keys) headers.set(key, data.retryHeaders[key]);
      return fetcher(LEGACY_API + path, { ...init, headers });
    }
  }
  return fetcher(LEGACY_API + path, init);
}
