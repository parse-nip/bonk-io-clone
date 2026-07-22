import puppeteer from "puppeteer-core";
import { existsSync } from "fs";

const executablePath = [
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
  "/opt/google/chrome/chrome",
].find((p) => existsSync(p));

const browser = await puppeteer.launch({
  executablePath,
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1600,1000"],
  defaultViewport: { width: 1600, height: 1000, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle0", timeout: 30000 });
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => /guest/i.test(b.textContent || ""))?.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => /quick play/i.test(b.textContent || ""))?.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  // classic card / start
  const btns = [...document.querySelectorAll("button, .mode-card")];
  (btns.find((b) => /classic/i.test(b.textContent || "")) || btns.find((b) => /play|start/i.test(b.textContent || "")))?.click();
});
await new Promise((r) => setTimeout(r, 1200));
// try start if still in lobby
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) => /start/i.test(b.textContent || ""))?.click();
});
await new Promise((r) => setTimeout(r, 1500));

const info = await page.evaluate(() => {
  const c = document.querySelector("canvas.game-canvas");
  if (!c) return { ok: false, error: "no canvas" };
  // Infer scale from renderer logic
  const w = c.clientWidth;
  const h = c.clientHeight;
  const scale = Math.min(1, w / 780, h / 520);
  return {
    ok: scale <= 1 && Math.abs(scale - 1) < 1e-9,
    client: [w, h],
    scale,
    arenaCss: [780 * scale, 520 * scale],
  };
});
await page.screenshot({ path: "/opt/cursor/artifacts/screenshots/gameplay-native-scale.png" });
console.log(JSON.stringify(info, null, 2));
await browser.close();
process.exit(info.ok ? 0 : 1);
