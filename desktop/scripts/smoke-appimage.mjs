// Run the shipped renderer with an isolated profile, including the actual preload bridge.
// No user session is read; all web requests are blocked before the test account is created.
import { spawn, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const binary = path.resolve(process.argv[2] || "release/Amour-0.2.16.AppImage");
const output = path.resolve(
  process.argv[3] || "release/packaged-wave-preview.png",
);
const checkNiri =
  process.platform === "linux" &&
  process.env.XDG_CURRENT_DESKTOP?.toLowerCase().split(":").includes("niri") &&
  !process.argv.includes("--ozone-platform=headless");
function amourWindows() {
  return JSON.parse(
    execFileSync("niri", ["msg", "--json", "windows"], { encoding: "utf8" }),
  ).filter((window) => window.title === "Amour!");
}
const previousFocus =
  checkNiri && process.env.AMOUR_SCROLL_BENCHMARK === "1"
    ? JSON.parse(
        execFileSync("niri", ["msg", "--json", "windows"], {
          encoding: "utf8",
        }),
      ).find((window) => window.is_focused)?.id
    : null;
let benchmarkWindowId = null;
const previousWindows = new Set(
  checkNiri ? amourWindows().map((window) => window.id) : [],
);
const profile = await mkdtemp(path.join(os.tmpdir(), "amour-packaged-smoke-"));
await mkdir(path.join(profile, "runtime"), { recursive: true });
const child = spawn(
  binary,
  ["--remote-debugging-port=0", ...process.argv.slice(4)],
  {
    env: {
      ...process.env,
      XDG_CONFIG_HOME: path.join(profile, "config"),
      XDG_CACHE_HOME: path.join(profile, "cache"),
      TMPDIR: path.join(profile, "runtime"),
      APPIMAGE_EXTRACT_AND_RUN: "1",
    },
    stdio: ["ignore", "ignore", "pipe"],
    detached: true,
  },
);
let logs = "";
child.stderr.on("data", (chunk) => {
  logs = (logs + chunk).slice(-20000);
});
let socket;
let sequence = 0;
const pending = new Map();
const failedCatalog = new Set();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, ms = 25000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (child.exitCode !== null)
      throw new Error(`App exited before ${label} (code ${child.exitCode})`);
    try {
      const value = await check();
      if (value) return value;
    } catch {}
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
function send(method, params = {}) {
  const id = ++sequence;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => {
        pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      },
      process.env.AMOUR_CATALOG_PROBE === "1" && method === "Runtime.evaluate"
        ? 30000
        : 8000,
    );
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      reject,
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.exceptionDetails)
    throw new Error(response.exceptionDetails.text);
  return response.result?.value;
}
try {
  const port = await until(
    () => logs.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/)?.[1],
    "Electron debugger",
  );
  const target = await until(
    async () =>
      (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(
        (page) => page.type === "page" && page.url.includes("/dist/index.html"),
      ),
    "packaged main window",
  );
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (
      process.env.AMOUR_CATALOG_PROBE === "1" &&
      message.method === "Network.responseReceived" &&
      message.params.response.url.startsWith(
        "https://youtubei.googleapis.com/",
      ) &&
      message.params.response.status >= 400
    )
      failedCatalog.add(message.params.requestId);
    if (
      message.method === "Network.loadingFinished" &&
      failedCatalog.delete(message.params.requestId)
    ) {
      void send("Network.getResponseBody", {
        requestId: message.params.requestId,
      })
        .then((response) => {
          try {
            const payload = JSON.parse(response.body);
            console.log(
              "Catalog response:",
              payload.error?.message || "no provider message",
            );
          } catch {}
        })
        .catch(() => {});
    }
    if (message.method === "Fetch.requestPaused") {
      const { requestId, request } = message.params;
      const remote = /^https?:/.test(request.url);
      const catalogProbe =
        process.env.AMOUR_CATALOG_PROBE === "1" &&
        request.url.startsWith(
          "https://youtubei.googleapis.com/youtubei/v1/next?",
        ) &&
        !Object.keys(request.headers).some(
          (name) => name.toLowerCase() === "authorization",
        );
      void send(
        remote && !catalogProbe ? "Fetch.failRequest" : "Fetch.continueRequest",
        {
          requestId,
          ...(remote && !catalogProbe
            ? { errorReason: "BlockedByClient" }
            : {}),
        },
      ).catch(() => {});
      return;
    }
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width: 1200,
    height: 780,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await send("Network.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
  await until(
    () =>
      evaluate(
        'document.querySelector("#root")?.childElementCount > 0 && Boolean(window.amourElectron)',
      ),
    "rendered UI and preload bridge",
  );
  if (checkNiri) {
    const mappedWindow = await until(
      () => amourWindows().find((window) => !previousWindows.has(window.id)),
      "window mapped in the niri compositor",
    );
    benchmarkWindowId = mappedWindow.id;
    console.log("PASS: native window is mapped in niri");
  }
  const version = await evaluate("window.amourElectron.getAppVersion()");
  if (
    await evaluate(
      'document.title !== "Amour!" || Boolean(window.linerElectron)',
    )
  )
    throw new Error("Wrong desktop identity");
  await evaluate(
    `localStorage.setItem("amour_locale", "ru"); localStorage.setItem("theme", "dark"); localStorage.setItem("amour_auth_session", JSON.stringify({accessToken:"packaged-smoke-test",refreshToken:"packaged-smoke-test",user:{id:"packaged-smoke",username:"packaged-smoke",displayName:"Packaged smoke"}}));`,
  );
  await send("Page.reload");
  await until(
    () =>
      evaluate(
        'Array.from(document.querySelectorAll("nav a")).some(link => link.hash === "#/wave")',
      ),
    "My wave navigation",
  );
  await evaluate('location.hash = "/wave"');
  await until(
    () =>
      evaluate(
        'Array.from(document.querySelectorAll("h1")).some(heading => heading.textContent === "Моя волна" && heading.getClientRects().length > 0)',
      ),
    "My wave screen",
  );
  await evaluate(
    'Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Не показывать")?.click()',
  );
  await mkdir(path.dirname(output), { recursive: true });
  const capture = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(output, Buffer.from(capture.data, "base64"));
  // Fixture queue verifies real renderer layout without streaming or contacting accounts.
  const playerFile = (
    await readdir(new URL("../dist/assets/", import.meta.url))
  ).find((name) => name.startsWith("ui-") && name.endsWith(".js"));
  if (!playerFile)
    throw new Error("Build the renderer before running this smoke test");
  const playerUrl = new URL(`./assets/${playerFile}`, target.url).href;
  const fixtureSize = Math.max(
    40,
    Math.min(1000, Number(process.env.AMOUR_SCROLL_TRACKS) || 40),
  );
  await evaluate(`(async () => {
    const url = ${JSON.stringify(playerUrl)};
    const bundle = await import(url);
    if (${process.env.AMOUR_CATALOG_PROBE === "1"}) {
      const api = Object.values(bundle).find(value => value && typeof value === "object" && typeof value.getRadio === "function" && typeof value.getHistory === "function");
      if (!api) throw new Error("Catalog API export missing");
      const radio = await api.getRadio("dQw4w9WgXcQ", { k: 10 });
      if (!radio.items.some(track => track.id !== "dQw4w9WgXcQ")) throw new Error("Live catalog probe returned no recommendations beyond the seed");
      console.info("[CatalogProbe] alternate host returned " + radio.items.length + " tracks");
    }
    const store = Object.values(bundle).find(value => typeof value === "function" && typeof value.getState === "function" && Array.isArray(value.getState()?.queue));
    if (!store) throw new Error("Player store export not found");
    const queue = Array.from({length:${fixtureSize}}, (_, i) => ({id:"smoke-track-"+i,title:"Smoke track "+(i+1),artists:"Isolated test profile",coverUrl:"data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="hsl('+i*37+' 35% 30%)"/><circle cx="40" cy="40" r="23" fill="none" stroke="white" stroke-width="2"/></svg>'),durationMs:180000,playCount:0}));
    store.setState({defaultPlaybackContext:"resume",queue,currentIndex:0,currentTrack:queue[0],playbackContext:"radio:my-wave",status:"paused"});
  })()`);
  if (process.env.AMOUR_CATALOG_PROBE === "1")
    console.log(
      "PASS: live anonymous catalog returned recommendations through the alternate API host",
    );
  await until(
    () =>
      evaluate(
        'document.querySelectorAll("[data-wave-artwork] button[data-wave-track]").length === 4',
      ),
    "track covers on animated artwork",
  );
  if (process.env.AMOUR_SCROLL_BENCHMARK === "1") {
    const browser = await (
      await fetch(`http://127.0.0.1:${port}/json/version`)
    ).json();
    const gpuSocket = new WebSocket(browser.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      gpuSocket.addEventListener("open", resolve, { once: true });
      gpuSocket.addEventListener("error", reject, { once: true });
    });
    const gpu = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("GPU info timeout")),
        8000,
      );
      gpuSocket.addEventListener("message", (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id === 1) {
          clearTimeout(timer);
          if (msg.error) reject(new Error(msg.error.message));
          else resolve(msg.result.gpu.featureStatus);
        }
      });
      gpuSocket.send(JSON.stringify({ id: 1, method: "SystemInfo.getInfo" }));
    });
    gpuSocket.close();
    const scrollProbe = `new Promise(resolve => {
      const root = document.querySelector("[data-wave-artwork]").closest("section").parentElement;
      const samples = []; let start = 0, last = 0, hidden = document.hidden;
      function frame(now) {
        hidden = hidden || document.hidden;
        if (!start) start = now;
        if (last) samples.push(now-last);
        last = now;
        root.scrollTop = Math.min(1000, (root.scrollHeight-root.clientHeight)*.55) * (1-Math.cos((now-start)/3500*Math.PI*2))/2;
        if(now-start < 3500) requestAnimationFrame(frame);
        else { root.scrollTop=0; samples.sort((a,b)=>a-b); resolve({hidden, frames:samples.length, medianMs:Math.round(samples[Math.floor(samples.length*.5)]*10)/10,p95Ms:Math.round(samples[Math.floor(samples.length*.95)]*10)/10,over33Ms:samples.filter(ms=>ms>33).length}); }
      }
      requestAnimationFrame(frame);
    })`;
    const focusBenchmark = async () => {
      if (checkNiri && benchmarkWindowId !== null)
        execFileSync(
          "niri",
          ["msg", "action", "focus-window", "--id", String(benchmarkWindowId)],
          { stdio: "ignore" },
        );
      await send("Page.bringToFront");
      await sleep(250);
    };
    await focusBenchmark();
    const coldFrames = await evaluate(scrollProbe);
    await focusBenchmark();
    const frames =
      fixtureSize >= 500 ? await evaluate(scrollProbe) : coldFrames;
    const foreground =
      !frames.hidden &&
      (!checkNiri ||
        amourWindows().some(
          (window) => window.id === benchmarkWindowId && window.is_focused,
        ));
    const renderedRows = await evaluate(
      'document.querySelectorAll("[data-wave-queue] h3").length',
    );
    if (fixtureSize >= 500 && renderedRows >= 100)
      throw new Error("Long queue rendered too many rows");
    console.log(
      JSON.stringify({
        scrollBenchmark: foreground
          ? frames
          : { valid: false, reason: "Window lost foreground visibility" },
        ...(fixtureSize >= 500 && !coldFrames.hidden
          ? { coldScrollBenchmark: coldFrames }
          : {}),
        queueLength: fixtureSize,
        renderedRows,
        gpuCompositing: gpu.gpu_compositing,
        rasterization: gpu.rasterization,
        webgl: gpu.webgl,
      }),
    );
  }
  if (
    !(await evaluate(
      'Array.from(document.querySelectorAll("nav a")).find(link => link.hash === "#/wave")?.querySelector("svg")?.getAttribute("fill") === "currentColor"',
    ))
  )
    throw new Error("Wave icon does not match navigation styling");
  await evaluate(
    'Array.from(document.querySelectorAll("[data-wave-artwork] button[data-wave-track]")).find(button => button.getAttribute("aria-label") === "Слушать Smoke track 2")?.click(); setTimeout(() => Array.from(document.querySelectorAll("button")).find(button => button.getAttribute("aria-label") === "Пауза")?.click(), 0)',
  );
  await until(
    () =>
      evaluate(
        'Array.from(document.querySelectorAll("h2")).some(heading => heading.textContent === "Smoke track 2")',
      ),
    "animated track selection",
  );
  await evaluate(
    'Array.from(document.querySelectorAll("button")).find(button => button.getAttribute("aria-label") === "Пауза")?.click()',
  );

  if (
    !(await evaluate(
      'Array.from(document.querySelectorAll("nav a")).find(link => link.hash === "#/wave")?.textContent.trim() === ""',
    ))
  )
    throw new Error("Wave navigation should show only its icon");
  if (
    await evaluate(
      'document.body.textContent.includes("Волна продолжается") || document.body.textContent.includes("Музыкальное путешествие")',
    )
  )
    throw new Error("Decorative wave copy is still visible");
  await evaluate(
    'Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Не показывать")?.click()',
  );
  await sleep(300);
  if (process.env.AMOUR_LAYOUT_PROBE === "1") {
    for (const width of [760, 1440]) {
      await send("Emulation.setDeviceMetricsOverride", {
        width,
        height: 900,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await sleep(350);
      const overflow = await evaluate(
        '(() => {const page = document.querySelector("[data-wave-artwork]").closest("section").parentElement; return page.scrollWidth > page.clientWidth + 1;})()',
      );
      if (overflow) throw new Error("Wave horizontal overflow at " + width);
      const shot = await send("Page.captureScreenshot", { format: "png" });
      await writeFile(
        output.replace(/\.png$/, "-" + width + ".png"),
        Buffer.from(shot.data, "base64"),
      );
    }
    await send("Emulation.setDeviceMetricsOverride", {
      width: 1200,
      height: 780,
      deviceScaleFactor: 1,
      mobile: false,
    });
  }
  await sleep(500);
  const activeCapture = await send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    output.replace(/\.png$/, "-active-test.png"),
    Buffer.from(activeCapture.data, "base64"),
  );
  if (process.env.AMOUR_LAYOUT_PROBE === "1") {
    await evaluate(
      'localStorage.setItem("theme", "light"); window.dispatchEvent(new StorageEvent("storage", { key: "theme", newValue: "light" }))',
    );
    await sleep(300);
    await evaluate(
      'Array.from(document.querySelectorAll("button")).find(button => button.textContent === "Не показывать")?.click()',
    );
    await sleep(250);
    const light = await send("Page.captureScreenshot", { format: "png" });
    await writeFile(
      output.replace(/\.png$/, "-light.png"),
      Buffer.from(light.data, "base64"),
    );
  }
  // Framer's reduced-motion hook reads the preference on mount; test a fresh document.
  await send("Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "reduce" }],
  });
  await send("Page.reload");
  await until(
    () =>
      evaluate(
        'document.querySelector("[data-wave-artwork]")?.getAttribute("data-motion-paused") === "true"',
      ),
    "reduced-motion artwork pause",
  );
  // Apply the offline flag before startup, after any pending persistence has flushed.
  const offlineFixture = await send("Page.addScriptToEvaluateOnNewDocument", {
    source: 'localStorage.setItem("amour_offline_mode", "1")',
  });
  await send("Page.reload");
  await until(
    () =>
      evaluate(
        'Array.from(document.querySelectorAll("h1")).some(heading => heading.textContent === "Моя волна" && heading.getClientRects().length > 0) && document.body.textContent.includes("Для прослушивания нужен интернет")',
      ),
    "offline wave screen",
  );
  await send("Page.removeScriptToEvaluateOnNewDocument", {
    identifier: offlineFixture.identifier,
  });
  if (
    !(await evaluate(
      'Array.from(document.querySelectorAll("nav a")).some(link => link.hash === "#/wave")',
    ))
  )
    throw new Error("My wave vanished offline");
  console.log(
    `PASS: Amour! ${version}: packaged startup, preload, wave navigation, animated artwork, reduced motion and offline visibility. Screenshot: ${output}`,
  );
} catch (error) {
  if (process.env.AMOUR_CATALOG_PROBE === "1") await sleep(300);
  console.error(error.message);
  console.error(logs);
  process.exitCode = 1;
} finally {
  if (checkNiri && previousFocus !== null && benchmarkWindowId !== null) {
    try {
      if (
        amourWindows().some(
          (window) => window.id === benchmarkWindowId && window.is_focused,
        )
      )
        execFileSync(
          "niri",
          ["msg", "action", "focus-window", "--id", String(previousFocus)],
          { stdio: "ignore" },
        );
    } catch {}
  }
  socket?.close();
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {}
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(3000),
  ]);
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {}
  child.stderr.destroy();
  child.unref();
  await rm(profile, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 200,
  });
}
