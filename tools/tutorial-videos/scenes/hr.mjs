import { studio } from '../lib.mjs';
import { call, PASSWORD } from '../setup.mjs';

const plusDays = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(Date.now() + n * 86_400_000));
const NEW = { code: 'BV018', name: 'Nguyễn Văn Tâm', phone: '0910000018' };

export default async function hrVideo(ctx) {
  const { hr, guard, site } = ctx;
  // The guard signs in on a new phone: it waits for HR on the Thiết bị page. (A first phone is trusted on
  // sight, so one is recorded first in case the guard's video did not run.)
  const signIn = (device_id, device_label) => call('/auth/login', { json: { identifier: guard.phone, password: PASSWORD, device_id, platform: 'android', device_label } }).catch(() => undefined);
  await signIn('redmi-note-cu', 'Xiaomi Redmi Note 12');
  await signIn('samsung-a15-moi', 'Samsung Galaxy A15');

  const s = await studio({
    name: '4-hr',
    role: 'HR',
    title: 'Vai trò HR (nhân sự)',
    intro: 'Hồ sơ nhân viên · Lương & phép · Điều động · Đội · Tài khoản · Xếp ca · Duyệt điện thoại mới',
  });
  const p = s.page;
  const main = p.locator('main');
  const nav = (name) => s.tap(p.locator('aside').getByRole('link', { name, exact: true }), { wait: 2200 });
  const card = (title) => main.locator('section, div').filter({ has: p.getByRole('heading', { name: title }) }).last();
  await s.start('/dang-nhap');

  s.chapter('Đăng nhập');
  await s.say('HR làm việc trên trang web quản lý. Đăng nhập bằng số điện thoại hoặc email.');
  await s.type(p.getByLabel('Số điện thoại hoặc email'), hr.phone);
  await s.type(p.getByLabel('Mật khẩu'), PASSWORD);
  await s.tap(p.getByRole('button', { name: 'Đăng nhập' }), { wait: 3000 });
  await main.getByText('Xin chào').waitFor();
  await s.show(p.locator('aside'), 'Menu của HR: nhân viên, người dùng, tổ chức, xếp ca, chấm công và thiết bị.');
  await s.scroll(500);
  await s.show(main.getByText(/Giấy tờ sắp hết hạn/), 'Tổng quan của HR có thêm "Giấy tờ sắp hết hạn" trong 30 ngày tới: CCCD, chứng chỉ nghiệp vụ, giấy khám sức khoẻ…');
  await s.scrollTop();

  s.chapter('Thêm nhân viên');
  await nav('Nhân viên');
  await s.say('Bước đầu khi nhận người mới: tạo hồ sơ nhân viên với mã, họ tên và số điện thoại.');
  await s.type(main.getByLabel('Mã nhân viên'), NEW.code);
  await s.type(main.getByLabel('Họ tên'), NEW.name);
  await s.type(main.getByLabel('Số điện thoại'), NEW.phone);
  await s.tap(main.getByRole('button', { name: 'Thêm', exact: true }), { wait: 2200 });
  await s.tap(main.getByRole('link', { name: NEW.name }), { wait: 2500 });

  s.chapter('Hồ sơ, lương & giấy tờ');
  await s.say('Trang nhân viên gồm hồ sơ cá nhân, lương và ngày phép, giấy tờ chứng chỉ, lịch sử điều động.');
  await s.maybe('hồ sơ', async () => {
    await p.getByLabel('Ngày sinh').fill('1992-05-14');
    await s.type(p.getByLabel('Số CCCD'), '001092012345');
    await p.getByLabel('Ngày vào làm').fill(plusDays(0));
    await s.type(p.getByLabel('Địa chỉ'), 'Cầu Giấy, Hà Nội');
    await s.type(p.getByLabel('Liên hệ khẩn cấp'), 'Vợ: 0987 654 321');
    await s.tap(main.getByRole('button', { name: 'Lưu hồ sơ' }), { wait: 1800 });
  });
  await s.maybe('lương', async () => {
    await p.getByLabel('Lương cơ bản (đ/tháng)').scrollIntoViewIfNeeded();
    await s.say('Lương & ngày phép chỉ HR và kế toán thấy: hình thức trả lương, lương cơ bản, phụ cấp, số ngày phép năm, tài khoản ngân hàng.');
    await s.type(p.getByLabel('Lương cơ bản (đ/tháng)'), '7500000');
    await s.type(p.getByLabel('Phụ cấp (đ/tháng)'), '500000');
    await s.type(p.getByLabel(/Số ngày phép năm/), '12');
    await s.tap(main.getByRole('button', { name: 'Lưu lương & phép' }), { wait: 1800 });
  });
  await s.maybe('giấy tờ', async () => {
    await p.getByRole('button', { name: 'Thêm', exact: true }).scrollIntoViewIfNeeded();
    await s.say('Giấy tờ, chứng chỉ: ghi số, ngày cấp, ngày hết hạn và đính kèm ảnh/PDF. Sắp hết hạn sẽ hiện ở Tổng quan.');
    await s.choose(main.locator('select').filter({ hasText: 'Chứng chỉ nghiệp vụ bảo vệ' }), { label: 'Chứng chỉ nghiệp vụ bảo vệ' });
    await s.type(main.getByLabel('Số', { exact: true }), 'NVBV-2026-0418');
    await main.getByLabel('Ngày cấp').fill(plusDays(-30));
    await main.getByLabel('Hết hạn').fill(plusDays(700));
    await s.tap(main.getByRole('button', { name: 'Thêm', exact: true }), { wait: 1800 });
  });

  s.chapter('Điều động tới khách');
  await nav('Khách hàng');
  await s.tap(main.getByRole('link', { name: 'Khu đô thị Mỹ Đình Pearl' }), { wait: 2500 });
  await s.maybe('điều động', async () => {
    const pick = main.getByLabel('Điều động nhân viên');
    await pick.scrollIntoViewIfNeeded();
    await s.say('Điều động: đưa nhân viên tới khách hàng theo hợp đồng. Chỉ người đã điều động mới xếp ca được ở mục tiêu của khách đó.');
    await s.chooseText(pick, NEW.name);
    const contract = main.getByLabel('Theo hợp đồng');
    if ((await contract.locator('option').count()) > 1) await s.choose(contract, { index: 1 });
    await main.getByLabel('Từ ngày').last().fill(plusDays(0));
    await s.tap(main.getByRole('button', { name: 'Điều động', exact: true }), { wait: 2200 });
    await s.show(main.locator('tr').filter({ hasText: NEW.name }).first(), 'Nhân viên đã có trong danh sách "Bảo vệ đang làm" của khách. "Rút về" khi kết thúc điều động.');
  });

  s.chapter('Xếp vào đội');
  await nav('Tổ chức');
  await s.say('Tổ chức: nhóm do quản lý phụ trách, gồm các đội do đội trưởng phụ trách. Chọn một đội để xem và thêm thành viên.');
  await s.maybe('thêm vào đội', async () => {
    await s.tap(main.getByRole('button', { name: new RegExp(`^Đội ${site.name.split(' — ')[0]}`) }), { wait: 1800 });
    const add = main.getByLabel(/Thêm \/ chuyển nhân viên vào đội/);
    await s.chooseText(add, NEW.name);
    await s.tap(add.locator('xpath=ancestor::form').getByRole('button', { name: 'Thêm' }), { wait: 2000 });
    await s.say('Đội trưởng của đội sẽ thấy người mới trong tab "Đội" trên điện thoại.');
  });

  s.chapter('Tạo tài khoản đăng nhập');
  await nav('Người dùng');
  await s.say('Tạo tài khoản để nhân viên đăng nhập ứng dụng. Bảo vệ chọn loại "Bảo vệ / đội trưởng" và gắn với hồ sơ nhân viên.');
  await s.type(main.getByLabel('Họ tên'), NEW.name);
  await s.type(main.getByLabel('Số điện thoại'), NEW.phone);
  await s.type(main.getByLabel(/Mật khẩu ban đầu/), 'Tam@123456');
  await s.choose(main.getByLabel('Loại tài khoản'), 'guard');
  await s.maybe('gắn nhân viên', async () => s.chooseText(main.getByLabel('Gắn với nhân viên'), NEW.name));
  await s.tap(main.getByLabel('Bảo vệ', { exact: true }), { wait: 600 });
  await s.say('Vai trò quyết định người đó thấy và làm được gì. Lần đầu đăng nhập, họ phải đổi mật khẩu ban đầu.');
  await s.tap(main.getByRole('button', { name: 'Tạo tài khoản' }), { wait: 2200 });
  await s.maybe('dòng tài khoản', async () => {
    const row = main.locator('tr').filter({ hasText: NEW.phone }).first();
    await s.show(row, 'Mỗi tài khoản có: Sửa quyền, Đặt lại mật khẩu (khi bảo vệ quên), Khoá (khi nghỉ việc).');
  });

  s.chapter('Xếp ca');
  await nav('Xếp ca');
  await s.choose(main.locator('select').first(), { label: `Khu đô thị Mỹ Đình Pearl · ${site.name}` });
  await s.tap(main.getByRole('button', { name: '→' }), { wait: 2000 });
  await s.maybe('xếp ca người mới', async () => {
    const row = main.locator('tbody tr').filter({ hasText: NEW.name });
    await s.show(row, 'Người mới đã hiện trong lịch ca của mục tiêu. Chọn mẫu ca ở ô "+ ca" từng ngày.');
    await s.choose(row.locator('select').first(), { index: 1 });
    await s.choose(row.locator('select').nth(1), { index: 1 });
    await s.say('Ca vừa xếp hiện ngay trong tab "Ca trực" trên điện thoại của bảo vệ.');
  });

  s.chapter('Duyệt điện thoại mới');
  await nav('Thiết bị');
  await s.say('Mỗi bảo vệ chỉ chấm công trên một điện thoại. Khi họ đổi máy, máy mới hiện ở đây với nền vàng, chờ duyệt.');
  await s.maybe('duyệt máy', async () => {
    const row = main.locator('tr').filter({ hasText: 'Chờ duyệt' }).first();
    await s.show(row, `${guard.name} vừa đăng nhập trên máy mới. Gọi xác nhận với bảo vệ rồi bấm "Duyệt" — máy cũ sẽ tự đăng xuất.`);
    await s.tap(row.getByRole('button', { name: 'Duyệt' }), { wait: 2200 });
  });
  await s.say('"Thu hồi" khi máy bị mất hoặc bảo vệ nghỉ việc.');

  s.chapter('Chấm công');
  await nav('Chấm công');
  await s.choose(main.locator('select').first(), { label: `Khu đô thị Mỹ Đình Pearl · ${site.name}` });
  await s.say('HR xem bảng chấm công từng mục tiêu theo ngày để đối chiếu công, trễ, vắng khi tính lương.');

  await s.end('Hồ sơ đầy đủ · Điều động và xếp đội · Cấp tài khoản · Duyệt điện thoại mới');
}
