import puppeteer from "puppeteer-core";
import { existsSync } from "fs";

const candidates = [
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/usr/bin/google-chrome",
  "/opt/google/chrome/chrome",
];
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) {
  console.error(JSON.stringify({ ok: false, error: "no chrome" }));
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath,
  headless: "new",
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1400,900"],
  defaultViewport: { width: 1400, height: 900, deviceScaleFactor: 2 },
});

const page = await browser.newPage();
await page.goto("http://127.0.0.1:5173/", { waitUntil: "networkidle0", timeout: 30000 });

await page.evaluate(() => {
  const buttons = [...document.querySelectorAll("button")];
  buttons.find((b) => /guest/i.test(b.textContent || ""))?.click();
});
await new Promise((r) => setTimeout(r, 500));
await page.evaluate(() => {
  const buttons = [...document.querySelectorAll("button")];
  buttons.find((b) => /map editor/i.test(b.textContent || ""))?.click();
});
await new Promise((r) => setTimeout(r, 1000));

const info = await page.evaluate(() => {
  const canvas = document.querySelector("#ed-canvas");
  if (!canvas) return { ok: false, error: "no canvas" };
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  return {
    clientW: canvas.clientWidth,
    clientH: canvas.clientHeight,
    rectW: rect.width,
    rectH: rect.height,
    bitmapW: canvas.width,
    bitmapH: canvas.height,
    dpr,
    matchClient:
      canvas.width === Math.floor(canvas.clientWidth * dpr) &&
      canvas.height === Math.floor(canvas.clientHeight * dpr),
    largeEnough: canvas.clientWidth > 400 && canvas.clientHeight > 200,
  };
});

await page.screenshot({
  path: "/opt/cursor/artifacts/screenshots/editor-dpr-puppeteer.png",
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
process.exit(info.matchClient && info.largeEnough ? 0 : 2);
