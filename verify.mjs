import { chromium } from "playwright";
const EMAIL = `clautest_${Date.now()}@example.com`;
const PASS = "Test123456!";
const browser = await chromium.launch();
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push("CONSOLE: " + m.text()); });
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message));

await page.goto("https://wc2026-predictions2026.netlify.app/?cb=" + Date.now(), { waitUntil: "networkidle", timeout: 45000 });

// language / direction
console.log("html dir:", await page.getAttribute("html", "dir"));
console.log("login button text:", JSON.stringify(await page.innerText("#auth-submit")));

// sign up
await page.click('.seg-btn[data-mode="signup"]');
await page.fill("#display-name", "اختبار");
await page.fill("#email", EMAIL);
await page.fill("#password", PASS);
await page.click("#auth-submit");
let ok = false;
try { await page.waitForSelector("#app-view:not(.hidden)", { timeout: 12000 }); ok = true; } catch {}
console.log("logged in:", ok, "| email:", EMAIL);
if (!ok) { console.log("auth msg:", await page.innerText("#auth-msg")); }

if (ok) {
  await page.waitForTimeout(2000);
  // tabs in arabic
  console.log("tabs:", JSON.stringify(await page.$$eval(".tab", els => els.map(e => e.textContent.trim()))));

  // GROUP STAGE collapse: first open, others collapsed
  await page.click('.tab[data-tab="groups"]');
  await page.waitForTimeout(800);
  const groupCount = await page.$$eval("#tab-groups .group", g => g.length);
  const collapsed = await page.$$eval("#tab-groups .group", g => g.map(x => x.classList.contains("collapsed")));
  console.log("groups:", groupCount, "| first collapsed?", collapsed[0], "| 2nd collapsed?", collapsed[1], "| total collapsed:", collapsed.filter(Boolean).length);

  // GROUP PICKS: drag-drop lists + flags + thirds
  await page.click('.tab[data-tab="picks"]');
  await page.waitForTimeout(1000);
  const dndCount = await page.$$eval("#tab-picks ul.dnd", u => u.length);
  const firstLis = await page.$$eval("#tab-picks ul.dnd:first-of-type li", l => l.length);
  const flagsInPicks = await page.$$eval("#tab-picks ul.dnd img.crest", i => i.length);
  console.log("dnd lists:", dndCount, "| first list items:", firstLis, "| flag imgs:", flagsInPicks);
  console.log("thirds wrap before:", JSON.stringify((await page.innerText("#thirds-wrap")).slice(0, 60)));

  // perform a drag: move 2nd item to first in the first group
  const items = page.locator("#tab-picks ul.dnd").first().locator("li");
  await items.nth(1).hover();
  await page.mouse.down();
  const box0 = await items.nth(0).boundingBox();
  await page.mouse.move(box0.x + box0.width / 2, box0.y + 5, { steps: 8 });
  await page.mouse.move(box0.x + box0.width / 2, box0.y - 5, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(1800);
  console.log("toast after drag:", JSON.stringify(await page.innerText("#toast")));
  await page.waitForTimeout(500);
  const chipsNow = await page.$$eval("#thirds-wrap .tchip", c => c.length);
  console.log("third-place chips after ordering one group:", chipsNow);

  // board (expected to fail until fix-leaderboard.sql is run)
  await page.click('.tab[data-tab="board"]');
  await page.waitForTimeout(2000);
  console.log("board:", JSON.stringify((await page.innerText("#tab-board")).slice(0, 80)));
}

console.log("=== ERRORS ===");
console.log(errors.length ? errors.join("\n") : "(none)");
await browser.close();
