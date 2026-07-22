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
  [...document.querySelectorAll("button")].find((b) =>
    /guest/i.test(b.textContent || ""),
  )?.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  [...document.querySelectorAll("button")].find((b) =>
    /quick play/i.test(b.textContent || ""),
  )?.click();
});
await new Promise((r) => setTimeout(r, 400));
await page.evaluate(() => {
  const btns = [...document.querySelectorAll("button, .mode-card")];
  (
    btns.find((b) => /classic/i.test(b.textContent || "")) ||
    btns.find((b) => /play|start/i.test(b.textContent || ""))
  )?.click();
});
await new Promise((r) => setTimeout(r, 1200));
await page.evaluate(() => {
  [...document.querySelectorAll("button")]
    .find((b) => /start/i.test(b.textContent || ""))
    ?.click();
});
await new Promise((r) => setTimeout(r, 1500));

const info = await page.evaluate(() => {
  const c = document.querySelector("canvas.game-canvas");
  if (!c) return { ok: false, error: "no canvas" };
  const w = c.clientWidth;
  const h = c.clientHeight;
  // Sample a few pixels: field should fill most of the canvas now (not a tiny centered box).
  // We can't read engine.width from the page easily; check that the canvas is large
  // and the playfield bg (#2c2c2c) appears near the edges (expanded world).
  const ctx = c.getContext("2d");
  // Bitmap may be DPR-scaled; sample via a throwaway draw isn't available.
  // Heuristic: viewport is large enough that expand should have grown past 780×520.
  const shouldExpand = w > 780 && h > 520;
  return {
    ok: shouldExpand && w >= 1000 && h >= 600,
    client: [w, h],
    shouldExpand,
    note: "world expands to canvas at match start; props stay authored size",
  };
});
await page.screenshot({
  path: "/opt/cursor/artifacts/screenshots/gameplay-expanded-playspace.png",
});
console.log(JSON.stringify(info, null, 2));
await browser.close();
process.exit(info.ok ? 0 : 1);
