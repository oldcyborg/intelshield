// Development aid: prints the text of every page a role sees, to write the scenes against.
import { chromium } from 'playwright';

const [, , who = '0900000002', ...paths] = process.argv;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://localhost:3000/dang-nhap');
const inputs = page.locator('input');
await inputs.nth(0).fill(who);
await inputs.nth(1).fill(process.env.PW ?? 'Demo@123456');
await page.locator('button[type=submit]').click();
await page.waitForURL((u) => !u.pathname.startsWith('/dang-nhap'));
await page.waitForTimeout(1500);
const nav = await page.locator('aside a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
console.log('NAV', nav.join(' '));
const targets = [...(paths.length ? paths : nav)];
if (process.env.DETAILS) {
  for (const list of ['/nhan-vien', '/muc-tieu', '/su-co', '/khach-hang', '/tuan-tra']) {
    await page.goto(`http://localhost:3000${list}`);
    await page.waitForTimeout(1200);
    const href = await page.locator(`main a[href^="${list}/"]`).first().getAttribute('href').catch(() => null);
    if (href) targets.push(href);
  }
}
for (const p of targets) {
  await page.goto(`http://localhost:3000${p}`);
  await page.waitForTimeout(1500);
  const text = await page.locator('main').innerText();
  const controls = await page.locator('main button, main select, main input, main a').evaluateAll((els) =>
    els.slice(0, 60).map((e) => `${e.tagName.toLowerCase()}[${e.getAttribute('type') ?? ''}]${(e.textContent || e.getAttribute('placeholder') || e.getAttribute('name') || '').trim().slice(0, 40)}${e.tagName === 'A' ? '->' + e.getAttribute('href') : ''}`),
  );
  console.log(`\n######## ${p}\n${text.slice(0, 1800)}\n-- controls: ${controls.join(' | ')}`);
}
await browser.close();
