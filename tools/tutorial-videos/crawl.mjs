// QA sweep: every screen of the web and of the app, as each role, on a freshly rebuilt demo company. Collects script
// errors, failed API calls and error messages shown on screen — and how pages a role may not use behave.
//   docker compose --profile video run --rm video crawl.mjs
import { chromium } from 'playwright';
import { issues, MOBILE, WEB, watch } from './lib.mjs';
import { ACCOUNTANT, HR, MANAGER, PASSWORD, prepare } from './setup.mjs';

const ALL_WEB = ['/', '/su-co', '/khach-hang', '/hop-dong', '/muc-tieu', '/xep-ca', '/cham-cong', '/tuan-tra', '/vi-pham', '/don-tu', '/bang-luong',
  '/cong-no', '/so-truc', '/to-chuc', '/nhan-vien', '/nguoi-dung', '/thiet-bi', '/cai-dat', '/doi-mat-khau'];
const DETAILS = ['/khach-hang/', '/muc-tieu/', '/su-co/', '/nhan-vien/', '/tuan-tra/', '/bang-luong/', '/cong-no/'];

const ctx = await prepare();
const browser = await chromium.launch();
let where = '';
const seen = [];

async function shown(page, selector) {
  const texts = await page.locator(selector).allInnerTexts().catch(() => []);
  for (const t of texts.filter((x) => x.trim())) issues.push({ where, kind: 'thông báo lỗi trên màn hình', detail: t.trim().slice(0, 200) });
}

async function web(role, phone) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  watch(page, () => where);
  page.on('dialog', (d) => void d.dismiss());
  where = `web ${role} › đăng nhập`;
  await page.goto(`${WEB}/dang-nhap`);
  await page.getByLabel('Số điện thoại hoặc email').fill(phone);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/dang-nhap'));
  await page.locator('aside a').first().waitFor();
  const nav = await page.locator('aside a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
  const visit = async (path, label) => {
    where = `web ${role} › ${label ?? path}`;
    await page.goto(`${WEB}${path}`);
    await page.waitForTimeout(1800);
    await shown(page, 'main p.text-red-600');
    seen.push(where);
  };
  for (const path of nav) {
    await visit(path);
    const detail = DETAILS.find((d) => d.startsWith(`${path}/`) || d === `${path}/`);
    if (detail) {
      const href = await page.locator(`main a[href^="${detail}"]`).first().getAttribute('href').catch(() => null);
      if (href) await visit(href, `${path} › chi tiết`);
    }
  }
  for (const path of ALL_WEB.filter((p) => !nav.includes(p) && p !== '/doi-mat-khau')) {
    await visit(path, `${path} (ngoài quyền)`);
    const body = (await page.locator('main').innerText().catch(() => '')).trim();
    issues.push({ where, kind: 'trang ngoài quyền', detail: body ? body.slice(0, 120).replace(/\s+/g, ' ') : '(trống)' });
  }
  await visit('/doi-mat-khau');
  await context.close();
}

async function app(role, phone, routes) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', permissions: ['geolocation'],
    geolocation: { latitude: ctx.site.lat, longitude: ctx.site.lng, accuracy: 8 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  watch(page, () => where);
  page.on('dialog', (d) => void d.dismiss());
  where = `app ${role} › đăng nhập`;
  await page.goto(`${MOBILE}/`);
  await page.getByLabel('Số điện thoại').fill(phone);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.waitForTimeout(2500);
  if (await page.getByLabel('Mật khẩu hiện tại').isVisible()) {
    await page.getByLabel('Mật khẩu hiện tại').fill(PASSWORD);
    await page.getByLabel(/Mật khẩu mới/).fill(PASSWORD);
    await page.getByLabel('Nhập lại mật khẩu mới').fill(PASSWORD);
    await page.getByRole('button', { name: 'Lưu mật khẩu' }).click();
    await page.waitForTimeout(2000);
  }
  if (await page.getByText('Máy này đang chờ duyệt').isVisible()) {
    issues.push({ where, kind: 'không vào được', detail: 'Máy chờ duyệt' });
    await context.close();
    return;
  }
  await page.locator('nav a').first().waitFor().catch(() => undefined);
  const tabs = await page.locator('nav a').evaluateAll((as) => as.map((a) => a.getAttribute('href')?.replace(/^#/, '')));
  const visit = async (path, label) => {
    where = `app ${role} › ${label ?? path}`;
    await page.goto(`${MOBILE}/#${path}`);
    await page.waitForTimeout(2000);
    await shown(page, 'p.bg-red-50');
    seen.push(where);
  };
  for (const t of tabs) await visit(t, `tab ${t}`);
  for (const r of routes) await visit(r);
  // The first card of each list that opens a detail screen.
  for (const [tab, prefix] of [['/su-co', '#/su-co/'], ['/doi', '#/doi/ca/'], ['/tuan-tra', '#/tuan-tra/']]) {
    if (!tabs.includes(tab) && tab !== '/tuan-tra') continue;
    await visit(tab);
    const href = await page.locator(`a[href^="${prefix}"]`).first().getAttribute('href').catch(() => null);
    if (href) await visit(href.slice(1), `${tab} › chi tiết`);
  }
  await context.close();
}

const site = ctx.site.id;
await web('giám đốc', '0900000001');
await web('quản lý', MANAGER.phone);
await web('HR', HR.phone);
await web('kế toán', ACCOUNTANT.phone);

const fieldRoutes = ['/thong-bao', '/tuan-tra', '/don', '/don/nghi', '/phieu-luong', `/lien-he/${site}`, `/so-truc/${site}`, `/bao-su-co?site=${site}`, '/doi-mat-khau'];
await app('bảo vệ', ctx.guard.phone, [...fieldRoutes, '/duyet', '/doi', '/tong-quan', '/su-co']);
await app('đội trưởng', ctx.leader.phone, [...fieldRoutes, '/su-co/moi']);
await app('quản lý', MANAGER.phone, ['/thong-bao', '/su-co/moi', `/lien-he/${site}`, '/doi-mat-khau', '/phieu-luong', '/don']);
await app('HR', HR.phone, ['/thong-bao', `/lien-he/${site}`, '/doi-mat-khau']);
await app('kế toán', ACCOUNTANT.phone, ['/thong-bao', '/doi-mat-khau']);
await app('giám đốc', '0900000001', ['/thong-bao', '/su-co/moi', `/lien-he/${site}`]);
await browser.close();

console.log(`\nĐã mở ${seen.length} màn hình.`);
console.log(`===== QUÉT: ${issues.length} mục =====`);
for (const i of issues) console.log(`[${i.kind}] ${i.where}\n    ${i.detail}`);
