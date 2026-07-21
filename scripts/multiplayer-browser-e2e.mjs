/**
 * Browser UI E2E: two tabs create/join/start/play through Vite proxy.
 */
import puppeteer from "puppeteer-core";

const GAME_URL = process.env.BONK_GAME_URL ?? "http://127.0.0.1:5174";
const CHROME = process.env.CHROME_PATH ?? "/usr/local/bin/google-chrome";

async function guestLogin(page, name) {
  await page.goto(GAME_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector("#name-input", { timeout: 15000 });
  await page.click("#name-input", { clickCount: 3 });
  await page.type("#name-input", name);
  await page.click("#guest-btn");
  await page.waitForSelector(".menu-column button", { timeout: 15000 });
}

async function openOnline(page) {
  await page.evaluate(() => {
    for (const b of document.querySelectorAll(".menu-column button")) {
      if (b.textContent?.includes("Online Multiplayer")) {
        b.click();
        return;
      }
    }
    throw new Error("Online Multiplayer button missing");
  });
  await page.waitForSelector("#create", { timeout: 10000 });
}

async function clickId(page, id) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Missing ${sel}`);
    el.click();
  }, id);
}

async function createRoom(page) {
  await openOnline(page);
  await clickId(page, "#create");
  await page.waitForSelector(".lobby-layout", { timeout: 25000 });
  return page.evaluate(() => {
    const m = document.body.textContent?.match(/Room code:\s*([A-Z0-9]{5})/);
    if (!m) throw new Error("No room code in lobby");
    return m[1];
  });
}

async function joinRoom(page, code) {
  await guestLogin(page, "ClientUI");
  await openOnline(page);
  await page.waitForSelector("#code", { timeout: 10000 });
  await page.click("#code", { clickCount: 3 });
  await page.type("#code", code);
  await clickId(page, "#join-code");
  await page.waitForSelector(".lobby-layout", { timeout: 25000 });
}

async function playerCount(page) {
  return page.evaluate(
    () => document.querySelectorAll(".player-list .player-row").length,
  );
}

async function waitForPlayers(page, n, label) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const c = await playerCount(page);
    if (c >= n) return c;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`${label} never reached ${n} players`);
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    protocolTimeout: 60000,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  const host = await browser.newPage();
  await guestLogin(host, "HostUI");
  const code = await createRoom(host);

  const client = await browser.newPage();
  await joinRoom(client, code);

  const hostCount = await waitForPlayers(host, 2, "Host");
  const clientCount = await waitForPlayers(client, 2, "Client");

  await clickId(host, "#ready");
  await clickId(client, "#ready");
  await clickId(host, "#start");

  await host.waitForFunction(
    () => (document.querySelector(".controls-hint")?.textContent ?? "").includes("HOST"),
    { timeout: 20000 },
  );
  await client.waitForFunction(
    () => (document.querySelector(".controls-hint")?.textContent ?? "").includes("CLIENT"),
    { timeout: 20000 },
  );

  const hostHint = await host.$eval(".controls-hint", (el) => el.textContent ?? "");
  const clientHint = await client.$eval(".controls-hint", (el) => el.textContent ?? "");

  await host.keyboard.press("ArrowRight");
  await client.keyboard.press("ArrowRight");
  await new Promise((r) => setTimeout(r, 400));

  await browser.close();

  console.log(
    JSON.stringify({
      ok: true,
      url: GAME_URL,
      code,
      hostCount,
      clientCount,
      hostHint: hostHint.slice(0, 80),
      clientHint: clientHint.slice(0, 80),
    }),
  );
}

main().catch((err) => {
  console.log(JSON.stringify({ ok: false, error: err.message }));
  process.exit(1);
});
