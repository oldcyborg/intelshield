// Prepares the demo company for one recording: rebuilt fresh (shifts and rounds follow the clock), plus an HR
// account, and picks the guard on duty right now with the site's QR tags and coordinates.
export const API = 'http://localhost:3001/api';
export const PASSWORD = 'Demo@123456';
export const HR = { phone: '0900000003', name: 'Đặng Thu Hà' };
export const MANAGER = { phone: '0900000002', name: 'Trần Quản Lý' };
export const ACCOUNTANT = { phone: '0900000004', name: 'Phạm Kế Toán' };
const DIRECTOR = '0900000001';
/** The demo's team leaders, by site code; Kho Long Biên has none. */
const LEADERS = { 'MDP-A': '0910000001', 'MDP-B': '0910000002' };

export async function call(path, { token, json, method } = {}) {
  const res = await fetch(`${API}${path}`, {
    method: method ?? (json ? 'POST' : 'GET'),
    headers: { 'content-type': 'application/json', 'x-client': 'mobile', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: json ? JSON.stringify(json) : undefined,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(`${method ?? (json ? 'POST' : 'GET')} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return body?.data;
}

/** No device_id: these sessions never bind a phone, so the browser stays the guard's first phone. */
export const login = async (phone, password = PASSWORD) => (await call('/auth/login', { json: { identifier: phone, password } })).access_token;

const day = (offset = 0) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(Date.now() + offset * 86_400_000));

export async function prepare() {
  const key = process.env.DEMO_RESET_KEY?.trim();
  if (!key) throw new Error('Cần DEMO_RESET_KEY trong backend/.env để dựng lại công ty demo');
  const demo = await call('/demo/reset', { json: { key } });
  console.log(`Đã dựng lại ${demo.company}`);

  const boss = await login(DIRECTOR);
  const roles = await call('/roles', { token: boss });
  const hrRole = roles.find((r) => r.code === 'hr');
  await call('/users', {
    token: boss,
    json: { user_type: 'staff', full_name: HR.name, phone: HR.phone, password: 'TamThoi@123', role_ids: [hrRole.id], scopes: [{ scope_type: 'tenant' }] },
  });
  // The first password was set by someone else: changing it once removes the "đổi mật khẩu" banner.
  await call('/auth/change-password', { token: await login(HR.phone, 'TamThoi@123'), json: { current_password: 'TamThoi@123', new_password: PASSWORD } });

  const users = await call('/users', { token: boss });
  const phoneOf = (name) => users.find((u) => u.full_name === name)?.phone;
  const sites = await call('/sites', { token: boss });
  const now = Date.now();
  let pick = null;
  for (const site of sites.filter((s) => LEADERS[s.code])) {
    // A night shift that began yesterday is still on after midnight.
    const rows = [];
    for (const d of [day(-1), day(0)]) rows.push(...(await call(`/attendance/board?site_id=${site.id}&date=${d}`, { token: boss })).rows);
    const onNow = rows.filter((r) => new Date(r.planned_start).getTime() - 3_600_000 <= now && new Date(r.planned_end).getTime() > now + 1_800_000);
    const candidate = onNow.find((r) => !r.check_in_at) ?? onNow[0];
    if (candidate && (!pick || (!candidate.check_in_at && pick.row.check_in_at))) pick = { site, row: candidate };
  }
  if (!pick) throw new Error('Không có bảo vệ nào đang trong ca ở Toà A/Toà B lúc này');

  const site = await call(`/sites/${pick.site.id}`, { token: boss });
  const checkpoints = await call(`/sites/${pick.site.id}/checkpoints`, { token: boss });
  const sheet = await call(`/sites/${pick.site.id}/qr-sheet`, { token: boss });
  const guard = { phone: phoneOf(pick.row.employee_name), name: pick.row.employee_name, checkedIn: Boolean(pick.row.check_in_at) };
  const leaderPhone = LEADERS[pick.site.code];
  const leader = { phone: leaderPhone, name: users.find((u) => u.phone === leaderPhone)?.full_name };
  const ctx = {
    guard, leader, manager: MANAGER, hr: HR, accountant: ACCOUNTANT,
    site: { id: site.id, code: site.code, name: site.name, lat: Number(site.lat), lng: Number(site.lng) },
    checkpoints: checkpoints.map((c) => ({
      id: c.id, code: c.code, name: c.name, lat: c.lat === null ? null : Number(c.lat), lng: c.lng === null ? null : Number(c.lng),
      methods: c.allowed_methods, qr: sheet.tags.find((t) => t.id === c.id)?.payload ?? null,
    })),
  };
  // Demo accounts start with a password someone else set. The guard's video shows that first change; the
  // leader's, the manager's and the accountant's videos start past it.
  for (const phone of [leader.phone, MANAGER.phone, ACCOUNTANT.phone]) {
    await call('/auth/change-password', { token: await login(phone), json: { current_password: PASSWORD, new_password: PASSWORD } });
  }
  console.log(`Bảo vệ: ${guard.name} (${guard.phone}) · ${site.name}${guard.checkedIn ? ' · đã vào ca' : ''} · đội trưởng ${leader.name}`);
  return ctx;
}

if (process.argv[1]?.endsWith('setup.mjs')) console.log(JSON.stringify(await prepare(), null, 2));
