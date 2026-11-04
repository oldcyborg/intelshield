import { studio } from '../lib.mjs';
import { PASSWORD } from '../setup.mjs';

export default async function managerVideo(ctx) {
  const { manager, guard, leader, site } = ctx;
  const s = await studio({
    name: '3-quan-ly',
    role: 'QUẢN LÝ',
    title: 'Vai trò Quản lý',
    intro: 'Trang web quản lý: tổng quan · sự cố · vi phạm · đơn từ · chấm công · tuần tra · xếp ca · mục tiêu',
  });
  const p = s.page;
  const main = p.locator('main');
  const nav = (name) => s.tap(p.locator('aside').getByRole('link', { name, exact: true }), { wait: 2200 });
  const siteOption = { label: `Khu đô thị Mỹ Đình Pearl · ${site.name}` };
  const pickSite = async () => s.choose(main.locator('select').first(), siteOption);
  await s.start('/dang-nhap');

  s.chapter('Đăng nhập');
  await s.say('Quản lý làm việc trên trang web, mở bằng máy tính. Đăng nhập bằng số điện thoại hoặc email.');
  await s.type(p.getByLabel('Số điện thoại hoặc email'), manager.phone);
  await s.type(p.getByLabel('Mật khẩu'), PASSWORD);
  await s.tap(p.getByRole('button', { name: 'Đăng nhập' }), { wait: 3000 });
  await main.getByText('Xin chào').waitFor();

  s.chapter('Tổng quan');
  await s.show(p.locator('aside'), 'Menu bên trái hiện đúng những trang vai trò Quản lý được dùng.');
  await s.show(main.getByRole('link', { name: /Vi phạm chờ xử lý/ }), 'Trang Tổng quan: số vi phạm đang chờ, gồm cả đề xuất của đội trưởng cần quản lý duyệt.');
  await s.show(main.getByText(/Sự cố đang mở/).first(), 'Sự cố đang mở của các mục tiêu, cái nào chưa ai nhận hiện ngay đây.');
  await s.show(main.getByText('Tuần tra hôm nay').first(), 'Bảng tuần tra hôm nay theo từng mục tiêu: đủ điểm, thiếu, bỏ lỡ, nghi vấn.');
  await s.scroll(400);
  await s.say('Phía dưới: số bảo vệ đang làm, được điều động, và khách nào đang thiếu người so với hợp đồng.');
  await s.scrollTop();
  await s.show(p.getByRole('banner').locator('a, button').first(), 'Chuông thông báo ở góc trên: SOS, sự cố leo thang, đơn từ mới.');

  s.chapter('Sự cố');
  await nav('Sự cố');
  await s.say('Trang Sự cố lọc theo trạng thái và mức độ. "Ghi nhận sự cố" dùng khi khách báo qua điện thoại hoặc Zalo.');
  await s.maybe('đóng sự cố', async () => {
    await s.choose(main.locator('select').first(), { label: 'Chờ đóng' });
    const row = main.locator('tr').filter({ hasText: guard.name }).first();
    await s.show(row, `Sự cố bảo vệ ${guard.name} báo, đội trưởng ${leader.name} đã xử lý — đang chờ quản lý đóng.`);
    await s.tap(row.getByRole('link').first(), { wait: 2200 });
    await s.show(main.locator('section, div.rounded-lg').filter({ hasText: 'Đã xử lý' }).first(), 'Xem mô tả, ảnh hiện trường, ghi chú xử lý và dòng thời gian từng bước.');
    await s.tap(main.getByRole('button', { name: 'Đóng sự cố' }), { wait: 2200 });
    await s.say('Đã đóng. Nếu chưa ổn, bấm "Mở lại" kèm lý do để đội xử lý tiếp.');
    await s.scroll(500);
    await s.sleep(1500);
    await nav('Sự cố');
  });
  await s.maybe('tiếp nhận sự cố mới', async () => {
    await s.choose(main.locator('select').first(), { label: 'Chưa ai nhận' });
    const row = main.locator('tbody tr').first();
    await s.tap(row.getByRole('link').first(), { wait: 2200 });
    await s.say('Sự cố mới chưa ai nhận: bấm "Tôi tiếp nhận", hoặc chọn người trong ô "Giao cho…" để giao việc.');
    await s.tap(main.getByRole('button', { name: 'Tôi tiếp nhận' }), { wait: 2000 });
    await s.choose(main.locator('select').filter({ hasText: 'Giao cho…' }), { label: leader.name });
    await s.say(`Đã giao cho đội trưởng ${leader.name}. Người được giao nhận thông báo trên điện thoại.`);
  });

  s.chapter('Vi phạm');
  await nav('Vi phạm');
  await s.say('Hệ thống tự ghi vi phạm theo mốc giờ của từng mục tiêu. Đội trưởng đề xuất, quản lý duyệt. Chỉ vi phạm đã xác nhận mới tính vào lương.');
  await s.maybe('duyệt đề xuất miễn', async () => {
    const row = main.locator('tr').filter({ hasText: guard.name }).filter({ hasText: /đề xuất miễn/i }).first();
    await s.show(row, `Đề xuất miễn của đội trưởng kèm lý do. Quản lý chọn "Miễn" để đồng ý, hoặc "Xác nhận" nếu không chấp nhận lý do.`);
    await s.prompt('Lý do miễn (bắt buộc):', 'Đồng ý với đề xuất của đội trưởng', row.getByRole('button', { name: 'Miễn' }));
  });
  await s.maybe('xác nhận vi phạm', async () => {
    const row = main.locator('tbody tr').filter({ hasText: 'Vào ca trễ' }).first();
    await s.show(row, 'Vi phạm không có lý do chính đáng: bấm "Xác nhận" — khoản này sẽ được tính khi làm lương.');
    await s.prompt('Ghi chú (không bắt buộc):', 'Đã nhắc nhở lần 2', row.getByRole('button', { name: 'Xác nhận' }));
  });

  s.chapter('Đơn từ');
  await nav('Đơn từ');
  await s.say('Trang Đơn từ: đơn nghỉ và đơn bổ sung chấm công. Duyệt đơn nghỉ sẽ huỷ các ca trong ngày nghỉ — chọn người trực thay ngay dưới mỗi ca.');
  await s.maybe('duyệt đơn nghỉ', async () => {
    const leave = main.locator('div, section').filter({ has: p.getByRole('button', { name: 'Không duyệt' }) }).last();
    await s.prompt('Ghi chú (không bắt buộc):', 'Đồng ý', leave.getByRole('button', { name: 'Duyệt', exact: true }));
  });
  await s.scroll(500);
  await s.say('Bảo vệ gọi điện xin nghỉ? Dùng "Ghi đơn nghỉ thay" ở cuối trang.');
  await s.scrollTop();
  await s.tap(main.getByRole('button', { name: 'Bổ sung chấm công' }), { wait: 1800 });
  await s.say('Đơn bổ sung chấm công kèm bằng chứng trong ca: số lần quét tuần tra, dòng sổ trực, giao ca — để quyết định đúng.');

  s.chapter('Chấm công');
  await nav('Chấm công');
  await pickSite();
  await s.show(main.locator('table').first(), 'Bảng chấm công theo mục tiêu và ngày: ai đang trực, ai trễ, ai vắng, giờ vào/ra và khoảng cách lúc chấm công.');
  const fix = main.getByRole('button', { name: 'Sửa giờ' }).first();
  if (await fix.isVisible()) await s.show(fix, '"Sửa giờ" khi máy hỏng hoặc chấm nhầm. Mọi lần sửa đều được ghi lại.');
  else await s.say('Nút "Sửa giờ" ở cuối mỗi dòng dùng khi máy hỏng hoặc chấm nhầm. Mọi lần sửa đều được ghi lại.');

  s.chapter('Tuần tra');
  await nav('Tuần tra');
  await pickSite();
  await s.say('Bảng tuần tra theo mục tiêu: số vòng đủ điểm, thiếu, bỏ lỡ, bắt đầu trễ, có lần quét nghi vấn.');
  await s.maybe('xem vòng', async () => {
    const row = main.locator('tr').filter({ hasText: guard.name }).first();
    await s.tap(row.getByRole('link').first(), { wait: 2200 });
    await s.say('Chi tiết vòng: từng điểm xác nhận lúc nào, cách vị trí điểm bao xa, và mọi lần quét.');
    await s.scroll(400);
    await s.sleep(1500);
  });

  s.chapter('Xếp ca');
  await nav('Xếp ca');
  await pickSite();
  await s.show(main.locator('table').first(), 'Lịch ca theo tuần của từng mục tiêu. Ô màu xanh là ca đã chấm công.');
  await s.maybe('thêm ca', async () => {
    await s.tap(main.getByRole('button', { name: '→' }), { wait: 2000 });
    const cell = main.locator('tbody tr').first().locator('select').nth(1);
    await s.say('Thêm ca: chọn mẫu ca trong ô "+ ca" của người và ngày cần xếp.');
    await s.choose(cell, { index: 1 });
  });
  await s.show(main.getByRole('button', { name: 'Chép từ tuần trước' }), '"Chép từ tuần trước" dựng nhanh lịch tuần mới; người đang nghỉ hoặc không còn điều động sẽ được bỏ qua.');

  s.chapter('Mục tiêu');
  await nav('Mục tiêu');
  await s.tap(main.getByRole('link', { name: site.name }), { wait: 2500 });
  await s.say('Trang mục tiêu: toạ độ và bán kính chấm công, chốt gác, mẫu ca, và cài đặt riêng (mốc trễ, vắng, leo thang).');
  await s.show(main.getByRole('link', { name: /In tem QR/ }), '"In tem QR" in tem dán tại các điểm tuần tra. In lại một tem sẽ vô hiệu tem cũ.');
  await s.scroll(1400);
  await s.say('Phía dưới là danh sách điểm tuần tra, tuyến tuần và lịch tuần tra tự sinh các vòng mỗi ngày.');
  await s.scroll(900);
  await s.sleep(1500);

  s.chapter('Sổ trực & giao ca');
  await nav('Sổ trực & giao ca');
  await pickSite();
  await s.say('Sổ trực điện tử của mục tiêu: khách, xe đang ở trong, mọi dòng sổ trong ngày và biên bản giao ca. Văn phòng cũng ghi chú được vào sổ.');
  await s.scroll(400);
  await s.sleep(1200);

  s.chapter('Tổ chức & tài khoản');
  await nav('Tổ chức');
  await s.say('Tổ chức: các nhóm và đội, ai là đội trưởng. Trang Nhân viên và Người dùng để xem hồ sơ và tài khoản trong phạm vi quản lý.');
  await s.show(p.getByRole('banner'), 'Góc trên bên phải: đổi mật khẩu và đăng xuất.');

  await s.end('Xem Tổng quan mỗi ngày · Đóng sự cố đã xử lý · Duyệt vi phạm và đơn từ đúng hạn');
}
