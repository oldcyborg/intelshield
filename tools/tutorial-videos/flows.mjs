// QA: the flows the tutorial scenes do not reach, end to end through the screens, on a freshly rebuilt demo:
// handover between two shifts (with a dispute) and its review, check-out, SOS, an attendance correction through
// both levels, a password reset by HR, and a contract the accountant drafts and signs.
//   docker compose --profile video run --rm video flows.mjs
import { chromium } from 'playwright';
import { issues, makePhotos, MOBILE, WEB, watch } from './lib.mjs';
import { ACCOUNTANT, call, HR, login, MANAGER, PASSWORD, prepare } from './setup.mjs';

const ctx = await prepare();
const photos = await makePhotos('/tmp/photos');
const browser = await chromium.launch();
const boss = await login('0900000001');
let where = '';
let lastPage = null;
let shot = 0;
const ok = [];
const at = (minutes) => new Date(Date.now() + minutes * 60_000).toISOString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One flow: its failure is written down and the next flow still runs. */
async function flow(label, fn) {
  where = label;
  console.log(`● ${label}`);
  try {
    await fn();
    ok.push(label);
  } catch (e) {
    issues.push({ where, kind: 'LUỒNG HỎNG', detail: String(e.message).split('\n').slice(0, 3).join(' | ') });
    shot += 1;
    await lastPage?.screenshot({ path: `out/luong-${shot}.png`, fullPage: true }).catch(() => undefined);
  }
}

async function phone(who, password = PASSWORD) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh', permissions: ['geolocation'],
    geolocation: { latitude: ctx.site.lat, longitude: ctx.site.lng, accuracy: 8 },
  });
  const page = await context.newPage();
  lastPage = page;
  page.setDefaultTimeout(12_000);
  watch(page, () => where);
  const answers = [];
  page.on('dialog', (d) => void (d.type() === 'prompt' ? d.accept(answers.shift() ?? 'Đồng ý') : d.accept()));
  page.on('filechooser', (fc) => void fc.setFiles(photos.selfie));
  await page.goto(`${MOBILE}/`);
  await page.getByLabel('Số điện thoại').fill(who);
  await page.getByLabel('Mật khẩu').fill(password);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.waitForTimeout(2500);
  return { page, answers, close: () => context.close() };
}

async function changeFirstPassword(page) {
  if (!(await page.getByLabel('Mật khẩu hiện tại').isVisible())) return false;
  await page.getByLabel('Mật khẩu hiện tại').fill(PASSWORD);
  await page.getByLabel(/Mật khẩu mới/).fill(PASSWORD);
  await page.getByLabel('Nhập lại mật khẩu mới').fill(PASSWORD);
  await page.getByRole('button', { name: 'Lưu mật khẩu' }).click();
  await page.waitForTimeout(2000);
  return true;
}

async function webAs(who) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: 'vi-VN', timezoneId: 'Asia/Ho_Chi_Minh' });
  const page = await context.newPage();
  lastPage = page;
  page.setDefaultTimeout(12_000);
  watch(page, () => where);
  const answers = [];
  page.on('dialog', (d) => void (d.type() === 'prompt' ? d.accept(answers.shift() ?? 'Đồng ý') : d.accept()));
  await page.goto(`${WEB}/dang-nhap`);
  await page.getByLabel('Số điện thoại hoặc email').fill(who);
  await page.getByLabel('Mật khẩu').fill(PASSWORD);
  await page.getByRole('button', { name: 'Đăng nhập' }).click();
  await page.waitForURL((u) => !u.pathname.startsWith('/dang-nhap'));
  return { page, answers, close: () => context.close() };
}

async function checkIn(page, way = 'Vào ca') {
  await page.getByRole('button', { name: way, exact: true }).click();
  await page.getByRole('button', { name: 'Mở camera' }).click();
  await page.getByText('Đã lấy vị trí').waitFor();
  await page.getByRole('button', { name: `Gửi — ${way}` }).click();
  await page.getByText('✅').waitFor();
  await page.getByRole('button', { name: 'Về ca trực' }).click();
  await page.waitForTimeout(1500);
}

// Two guards of the site's team with nothing rostered now: one ending a shift within the hour, one starting after.
const users = await call('/users', { token: boss });
const employees = await call('/employees', { token: boss });
// Not the leader (one phone, kept for every flow) and not the guard already on duty there.
const phoneOf = (id) => users.find((u) => u.employee_id === id)?.phone;
const team = employees.filter((e) => e.team && ctx.site.name.includes(e.team.name.replace('Đội ', '')) && ![ctx.leader.phone, ctx.guard.phone].includes(phoneOf(e.id)));
const shifts = [];
for (const e of team) {
  if (shifts.length === 2) break;
  const [from, to] = shifts.length === 0 ? [at(-11 * 60), at(50)] : [at(55), at(12 * 60 + 55)];
  try {
    await call('/roster', { token: boss, json: { site_id: ctx.site.id, employee_id: e.id, start_at: from, end_at: to } });
    shifts.push({ ...e, phone: users.find((u) => u.employee_id === e.id)?.phone });
  } catch { /* already rostered then */ }
}
const [g1, g2] = shifts;
console.log(`Giao ca: ${g1?.full_name} → ${g2?.full_name}`);
let first;
// Guards and leaders are bound to one phone: the leader keeps a single session through all the flows.
let leadSession;
const leader = async () => (leadSession ??= await phone(ctx.leader.phone));

await flow('Bảo vệ vào ca, giao ca có mục thiếu', async () => {
  first = await phone(g1.phone);
  await changeFirstPassword(first.page);
  await checkIn(first.page);
  await first.page.getByRole('button', { name: '🔁 Giao ca' }).click();
  const item = first.page.locator('section').filter({ has: first.page.getByRole('button', { name: 'Thiếu' }) }).first();
  await item.getByRole('button', { name: 'Thiếu' }).click();
  await first.page.getByPlaceholder('Thiếu gì, hỏng gì…').fill('Thiếu 1 bộ đàm');
  await first.page.getByPlaceholder('Việc còn dở, khách hẹn, lưu ý…').fill('Khách tầng 12 hẹn 8h sửa điều hoà');
  await first.page.getByRole('button', { name: 'Giao ca', exact: true }).click();
  const choice = first.page.getByRole('button', { name: new RegExp(g2.full_name) });
  if (await choice.isVisible().catch(() => false)) await choice.click();
  await first.page.getByText(/Đã giao ca/).waitFor();
});

await flow('Người nhận ca không đồng ý biên bản', async () => {
  const next = await phone(g2.phone);
  await changeFirstPassword(next.page);
  await next.page.getByText(/giao ca cho bạn/).click();
  await next.page.getByRole('button', { name: 'Không đồng ý' }).click();
  await next.page.getByPlaceholder('Thiếu gì, khác gì so với biên bản?').fill('Thiếu cả chìa khoá kho');
  await next.page.getByRole('button', { name: 'Gửi — không đồng ý' }).click();
  await next.page.waitForTimeout(2000);
  if (await next.page.getByText(/giao ca cho bạn/).isVisible().catch(() => false)) throw new Error('Biên bản vẫn còn chờ người nhận');
  await next.close();
});

await flow('Đội trưởng duyệt biên bản giao ca bị phản đối', async () => {
  const lead = await leader();
  lastPage = lead.page;
  await lead.page.goto(`${MOBILE}/#/duyet`);
  await lead.page.waitForTimeout(2500);
  const picker = lead.page.locator('select').last();
  const option = (await picker.locator('option').allTextContents()).find((t) => t.includes(ctx.site.name));
  if (option) await picker.selectOption({ label: option });
  await lead.page.waitForTimeout(1500);
  const h =lead.page.locator('section').filter({ hasText: g1.full_name }).filter({ hasText: 'KHÔNG đồng ý' }).first();
  await h.waitFor();
  lead.answers.push('Đã kiểm tra, bổ sung bộ đàm');
  await h.getByRole('button', { name: 'Duyệt biên bản' }).click();
  await lead.page.waitForTimeout(2000);
  if (await h.isVisible().catch(() => false)) throw new Error('Biên bản vẫn ở danh sách chờ duyệt');
});

await flow('Bảo vệ ra ca', async () => {
  lastPage = first.page;
  await first.page.goto(`${MOBILE}/#/`);
  await first.page.waitForTimeout(1500);
  await checkIn(first.page, 'Ra ca');
  const card = first.page.locator('section').filter({ hasText: 'Ra ca' }).first();
  await card.getByText(/Ra ca \d{2}:\d{2}/).waitFor();
});

await flow('Bảo vệ bấm SOS, đội trưởng thấy ngay', async () => {
  lastPage = first.page;
  await first.page.goto(`${MOBILE}/#/`);
  await first.page.waitForTimeout(1500);
  const sos = first.page.getByRole('button', { name: /SOS/ });
  // At the very bottom, clear of the tab bar.
  await first.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await first.page.waitForTimeout(500);
  const b = await sos.boundingBox();
  await first.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await first.page.mouse.down();
  await sleep(2600);
  await first.page.mouse.up();
  await first.page.getByText('ĐÃ GỬI SOS').waitFor();
  const lead = await leader();
  lastPage = lead.page;
  await lead.page.goto(`${MOBILE}/#/su-co`);
  await lead.page.locator('a[href^="#/su-co/"]').filter({ hasText: 'SOS' }).filter({ hasText: g1.full_name }).first().waitFor();
  await first.close();
});

await flow('Bổ sung chấm công: bảo vệ gửi, đội trưởng đề xuất, quản lý duyệt', async () => {
  // A shift of this morning that a guard never clocked into.
  const g3 = team.find((e) => !shifts.some((s) => s.id === e.id));
  let placed = false;
  for (const back of [14, 20, 26, 32, 38]) {
    placed = await call('/roster', { token: boss, json: { site_id: ctx.site.id, employee_id: g3.id, start_at: at(-back * 60), end_at: at(-(back - 1) * 60) } })
      .then(() => true, () => false);
    if (placed) break;
  }
  if (!placed) throw new Error('Không xếp được ca đã qua cho bảo vệ thử');
  const g3phone = users.find((u) => u.employee_id === g3.id)?.phone;
  const guard = await phone(g3phone);
  await changeFirstPassword(guard.page);
  await guard.page.getByRole('button', { name: '🕒 Bổ sung chấm công' }).first().click();
  await guard.page.getByRole('button', { name: 'Quên chấm' }).click();
  await guard.page.getByRole('button', { name: 'Gửi đơn' }).click();
  await guard.page.getByText(/Đơn của tôi|Bổ sung chấm công/).first().waitFor();
  await guard.close();

  const lead = await leader();
  lastPage = lead.page;
  await lead.page.goto(`${MOBILE}/#/duyet`);
  const c = lead.page.locator('section').filter({ hasText: g3.full_name }).filter({ has: lead.page.getByRole('button', { name: 'Đề xuất duyệt' }) }).first();
  await c.waitFor();
  lead.answers.push('Đã xem sổ trực, có mặt');
  await c.getByRole('button', { name: 'Đề xuất duyệt' }).click();
  await lead.page.waitForTimeout(2000);

  const manager = await webAs(MANAGER.phone);
  await manager.page.goto(`${WEB}/don-tu`);
  await manager.page.getByRole('button', { name: 'Bổ sung chấm công' }).click();
  const row = manager.page.locator('tr').filter({ hasText: g3.full_name }).filter({ hasText: 'Quên chấm' }).first();
  await row.waitFor();
  manager.answers.push('Đồng ý');
  await row.getByRole('button', { name: 'Duyệt', exact: true }).click();
  await manager.page.waitForTimeout(2000);
  await manager.close();
  const board = await call(`/attendance/board?site_id=${ctx.site.id}&date=${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(Date.now() - 14 * 3_600_000))}`, { token: boss });
  const fixed = board.rows.find((r) => r.employee_name === g3.full_name && r.check_in_at);
  if (!fixed) throw new Error('Chấm công chưa được bổ sung sau khi duyệt');
});

await flow('HR đặt lại mật khẩu, bảo vệ phải đổi khi đăng nhập', async () => {
  const hr = await webAs(HR.phone);
  await hr.page.goto(`${WEB}/nguoi-dung`);
  const row = hr.page.locator('tr').filter({ hasText: g2.phone }).first();
  hr.answers.push('MatKhau@2026');
  await row.getByRole('button', { name: 'Đặt lại mật khẩu' }).click();
  await hr.page.waitForTimeout(1500);
  await hr.close();
  // Signed in without a phone id (no new device to approve): the account must ask for a new password.
  // Sign-ins are rate limited: after this many, wait for the window to pass.
  let signedIn;
  for (let i = 0; i < 4 && !signedIn; i += 1) {
    signedIn = await call('/auth/login', { json: { identifier: g2.phone, password: 'MatKhau@2026' } }).catch(async (e) => {
      if (!String(e.message).includes('429')) throw e;
      await sleep(30_000);
      return null;
    });
  }
  if (!signedIn.user.must_change_password) throw new Error('Không bắt đổi mật khẩu sau khi HR đặt lại');
});

await flow('Kế toán tạo hợp đồng nháp và đánh dấu đã ký', async () => {
  const acc = await webAs(ACCOUNTANT.phone);
  await acc.page.goto(`${WEB}/khach-hang`);
  await acc.page.getByRole('link', { name: 'Kho Long Biên Logistics' }).click();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  await acc.page.getByLabel('Số hợp đồng').fill('HD-QA-001');
  await acc.page.getByLabel('Từ ngày').first().fill(today);
  await acc.page.getByLabel('Đến ngày').fill(`${Number(today.slice(0, 4)) + 1}${today.slice(4)}`);
  await acc.page.getByLabel('Đơn giá (đ)').fill('8200000');
  await acc.page.getByRole('button', { name: 'Tạo hợp đồng (nháp)' }).click();
  await acc.page.getByRole('link', { name: 'HD-QA-001' }).click();
  await acc.page.getByRole('button', { name: 'Đánh dấu đã ký' }).click();
  await acc.page.waitForTimeout(1500);
  const contracts = await call('/contracts', { token: boss });
  const k = contracts.find((c) => c.contract_no === 'HD-QA-001');
  if (k?.state !== 'signed') throw new Error(`Hợp đồng ở trạng thái ${k?.state ?? 'không thấy'}`);
  await acc.close();
});

await browser.close();
console.log(`\n===== LUỒNG: ${ok.length} chạy được, ${issues.length} vấn đề =====`);
for (const i of issues) console.log(`[${i.kind}] ${i.where}\n    ${i.detail}`);
