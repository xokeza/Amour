import { expect, it, vi } from "vitest";
import { fetchAccountApi } from "./accountTransport";
const base = "https://xokeza.su/amour/api";
const blocked = () =>
  new Response(JSON.stringify({ code: "LEGACY_PROXY_BLOCKED" }), {
    status: 503,
    headers: { "content-type": "application/json" },
  });
it("retries an explicitly blocked legacy request with the exact body and headers", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(blocked())
    .mockResolvedValueOnce(new Response("{}"));
  const init = {
    method: "POST",
    headers: {
      authorization: "Bearer old-token",
      "x-liner-signature": "signed",
    },
    body: '{"title":"Keep me"}',
  };
  await fetchAccountApi(fetcher, base + "/v1/me/playlists", init);
  expect(fetcher).toHaveBeenLastCalledWith(
    "https://api.tryliner.fun/v1/me/playlists",
    init,
  );
});
it("never forwards new accounts, registrations or new refresh tokens", async () => {
  for (const [path, init] of [
    ["/v1/me", { headers: { authorization: "Bearer amour_a_local" } }],
    ["/v1/auth/register", { method: "POST", body: '{"password":"private"}' }],
    [
      "/v1/auth/refresh",
      { method: "POST", body: '{"refreshToken":"amour_r_local"}' },
    ],
  ] as const) {
    const fetcher = vi.fn().mockResolvedValue(blocked());
    await fetchAccountApi(fetcher, base + path, init);
    expect(fetcher).toHaveBeenCalledTimes(1);
  }
});
it("does not replay mutations after network timeouts or generic server errors", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ code: "LEGACY_UNAVAILABLE" }), {
      status: 503,
    }),
  );
  await fetchAccountApi(fetcher, base + "/v1/me/playlists", {
    method: "POST",
    headers: { authorization: "Bearer old-token" },
  });
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("permits a legacy refresh but does not activate on arbitrary API overrides", async () => {
  const fetcher = vi.fn().mockResolvedValue(blocked());
  const init = { method: "POST", body: '{"refreshToken":"old-refresh"}' };
  await fetchAccountApi(fetcher, base + "/v1/auth/refresh", init);
  expect(fetcher).toHaveBeenCalledTimes(2);
  fetcher.mockClear();
  await fetchAccountApi(
    fetcher,
    "https://another.example/v1/auth/refresh",
    init,
  );
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("uses request-bound retry headers for unsigned native legacy calls without forwarding account credentials", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "LEGACY_PROXY_BLOCKED",
          retryHeaders: {
            "x-liner-signature": "bound-proof",
            "x-liner-timestamp": "123",
            "x-liner-nonce": "nonce",
            authorization: "never-use-this",
          },
        }),
        { status: 503 },
      ),
    )
    .mockResolvedValueOnce(new Response("{}"));
  const init = {
    method: "POST",
    body: '{"purpose":"login","email":"legacy@example.test"}',
  };
  await fetchAccountApi(fetcher, base + "/v1/auth/challenge", init);
  const retry = fetcher.mock.calls[1][1];
  expect(retry.body).toBe(init.body);
  expect(retry.headers.get("x-liner-signature")).toBe("bound-proof");
  expect(retry.headers.has("authorization")).toBe(false);
});
