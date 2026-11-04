import { studio } from '../lib.mjs';
import { PASSWORD } from '../setup.mjs';

const plusDays = (n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date(Date.now() + n * 86_400_000));

export default async function guardVideo(ctx, photos) {
  const { guard, site } = ctx;
  const s = await studio({
    name: '1-bao-ve',
    mobile: true,
    role: 'BẢO VỆ',
    who: `Ví dụ: ${guard.name} · ${site.name}`,
    title: 'Vai trò Bảo vệ',
    intro: 'Vào ca · Tuần tra quét QR · Sổ trực · Báo sự cố · SOS · Xin nghỉ',
    geolocation: { latitude: site.lat + 0.00008, longitude: site.lng - 0.00005, accuracy: 8 },
  });
  const app = s.app;
  const back = () => s.tap(app.getByRole('button', { name: 'Quay lại' }), { wait: 1200 });
  await s.start();

  s.chapter('Đăng nhập');
  await s.say('Mở ứng dụng IntelShield trên điện thoại. Đăng nhập bằng số điện thoại và mật khẩu do HR hoặc đội trưởng cấp.');
  await s.type(app.getByLabel('Số điện thoại'), guard.phone);
  await s.type(app.getByLabel('Mật khẩu'), PASSWORD);
  await s.say('Lần đầu đăng nhập, điện thoại này được gắn với tài khoản của bạn. Mỗi bảo vệ chỉ chấm công trên một máy — đổi máy mới thì báo HR duyệt.');
  await s.tap(app.getByRole('button', { name: 'Đăng nhập' }), { wait: 2500 });
  const current = app.getByLabel('Mật khẩu hiện tại');
  if (await current.isVisible()) {
    await s.say('Lần đầu đăng nhập, ứng dụng yêu cầu đổi mật khẩu do người khác đặt sang mật khẩu của riêng bạn.');
    await s.type(current, PASSWORD);
    await s.type(app.getByLabel(/Mật khẩu mới/), PASSWORD);
    await s.type(app.getByLabel('Nhập lại mật khẩu mới'), PASSWORD);
    await s.tap(app.getByRole('button', { name: 'Lưu mật khẩu' }), { wait: 2500 });
  }

  s.chapter('Màn hình Ca trực');
  const card = app.locator('section').filter({ hasText: site.name }).first();
  await card.waitFor();
  await s.show(card, 'Tab "Ca trực" hiện ca hôm nay: giờ ca, mục tiêu và địa chỉ. Các nút trong thẻ ca chỉ hiện khi đang trong giờ trực.');
  await s.show(app.getByRole('navigation'), 'Thanh dưới cùng: "Ca trực" cho công việc hằng ngày, "Tôi" cho đơn từ, đổi mật khẩu và đăng xuất.');

  s.chapter('Vào ca');
  const checkIn = app.getByRole('button', { name: 'Vào ca', exact: true });
  if (await checkIn.isVisible()) {
    await s.say('Đến mục tiêu, bấm "Vào ca". Ứng dụng cần một ảnh khuôn mặt và vị trí GPS của bạn.');
    await s.tap(checkIn, { wait: 1500 });
    await s.say('Bước 1: bấm "Mở camera", nhìn thẳng vào camera trước, chỗ đủ sáng.');
    await s.camera(app.getByRole('button', { name: 'Mở camera' }), photos.selfie, 'Camera trước');
    await app.getByText('Đã lấy vị trí').waitFor();
    await s.show(app.getByText('Đã lấy vị trí'), 'Bước 2: vị trí được lấy tự động ngay sau khi chụp. Phải đứng trong bán kính của mục tiêu.');
    await s.tap(app.getByRole('button', { name: 'Gửi — Vào ca' }), { wait: 2500 });
    await app.getByText('✅').waitFor();
    await s.show(app.locator('section').first(), 'Đã vào ca. Giờ được tính theo đồng hồ máy chủ. Vào trễ sẽ hiện số phút trễ và đội trưởng thấy ngay.');
    await s.tap(app.getByRole('button', { name: 'Về ca trực' }), { wait: 1500 });
  } else {
    await s.say('Đến mục tiêu, bấm "Vào ca", chụp ảnh khuôn mặt và để ứng dụng lấy vị trí GPS. Ở ví dụ này bảo vệ đã vào ca rồi.');
  }

  s.chapter('Tuần tra');
  await s.say('Trong ca, các nút Tuần tra, Sổ trực, Báo sự cố hiện ngay trên thẻ ca. Bắt đầu với Tuần tra.');
  await s.tap(app.getByRole('button', { name: '🚶 Tuần tra' }), { wait: 1800 });
  // The open round that started last has the most time left before it closes.
  const open = app.locator('div.space-y-2').filter({ has: app.getByRole('heading', { name: 'Đang mở' }) }).locator('a[href^="#/tuan-tra/"]').last();
  await open.waitFor();
  await s.show(app.getByText('Đang mở'), 'Danh sách các vòng tuần trong ca: "Đang mở" là vòng cần đi bây giờ, "Sắp tới" là các vòng sau.');
  await s.tap(open, { wait: 1800 });
  await s.show(app.locator('section').first(), 'Vòng tuần có tuyến, mục tiêu và thanh tiến độ các điểm bắt buộc.');
  const qrButton = app.getByRole('button', { name: '📷 Quét mã QR' });
  let first = true;
  for (const cp of ctx.checkpoints.filter((c) => c.qr)) {
    const row = app.locator('section').filter({ hasText: `${cp.code} · ${cp.name}` });
    if (!(await row.count()) || (await row.getByText('✓ Đã xác nhận').count())) continue;
    if (cp.lat !== null) await s.setPosition(cp.lat, cp.lng);
    s.setPhoto(photos.checkpoint);
    if (first) await s.say(`Đi tới điểm ${cp.code} — ${cp.name}. Bấm "Quét mã QR" và đưa tem dán tại điểm vào khung camera.`);
    else await s.say(`Tiếp tục tới ${cp.code} — ${cp.name} và quét tem.`, 2400);
    await s.scan(qrButton, cp.qr);
    await app.getByText(`Đã ghi ${cp.code}`).waitFor().catch(() => undefined);
    if (first) await s.show(row, 'Điểm đã quét chuyển sang "✓ Đã xác nhận", kèm giờ quét. Có điểm yêu cầu chụp thêm ảnh — ứng dụng sẽ tự mở camera.');
    first = false;
    await s.sleep(800);
  }
  await s.say('Mất sóng vẫn quét bình thường: lần quét được lưu trên máy (⏳ Chờ gửi) và tự gửi khi có mạng.');
  const finish = app.getByRole('button', { name: 'Kết thúc vòng' });
  if (await finish.isVisible()) {
    await s.say('Đi hết các điểm thì bấm "Kết thúc vòng". Còn điểm bắt buộc chưa quét, ứng dụng sẽ hỏi lại trước khi kết thúc.');
    await s.tap(finish, { wait: 2500 });
  }
  await s.setPosition(site.lat + 0.00008, site.lng - 0.00005);
  await back();
  await back();

  s.chapter('Sổ trực');
  await s.tap(app.getByRole('button', { name: '📖 Sổ trực' }), { wait: 1800 });
  await s.say('Sổ trực thay sổ giấy: ghi khách, xe, tài sản ra vào và các ghi chú trong ca.');
  await s.tap(app.getByRole('button', { name: '🚗 Xe' }));
  await s.type(app.getByLabel('Biển số'), '30A-123.45');
  await s.type(app.getByLabel('Loại xe'), 'Xe tải nhỏ');
  await s.type(app.getByLabel('Hàng hoá'), 'Giao nước uống cho BQL');
  await s.tap(app.getByRole('button', { name: 'Ghi sổ' }), { wait: 2000 });
  const inside = app.locator('section').filter({ hasText: 'Đang ở trong' });
  await inside.waitFor().catch(() => undefined);
  await s.show(inside, 'Xe và khách chưa ra nằm ở mục "Đang ở trong". Khi họ ra, bấm "Ra" để ghi giờ ra.');
  await s.tap(inside.getByRole('button', { name: 'Ra' }).first(), { wait: 1800 });
  await s.tap(app.getByRole('button', { name: '🚶 Khách' }));
  await s.type(app.getByLabel('Tên khách'), 'Nguyễn Thị Mai');
  await s.type(app.getByLabel('Đơn vị'), 'Điện lạnh Á Châu');
  await s.type(app.getByLabel('Gặp ai'), 'Ban quản lý toà nhà');
  await s.type(app.getByLabel('Việc gì'), 'Bảo trì điều hoà');
  await s.tap(app.getByRole('button', { name: 'Ghi sổ' }), { wait: 2000 });
  await s.say('Mỗi dòng sổ đều có giờ và tên người ghi. Đội trưởng và quản lý xem được ngay.');
  await back();

  s.chapter('Báo sự cố');
  await s.tap(app.getByRole('button', { name: '⚠️ Báo sự cố' }), { wait: 1800 });
  await s.say('Gặp sự cố trong ca: chọn loại sự cố, mô tả ngắn và chụp ảnh nếu có.');
  await s.choose(app.getByLabel(/^Loại sự cố/), { label: 'Vệ sinh / an toàn' });
  await s.type(app.getByLabel('Chuyện gì đang xảy ra?'), 'Ống nước tầng 1 bị rò, nước tràn ra hành lang gần thang máy.', { delay: 35 });
  await s.camera(app.locator('button', { hasText: 'Chụp' }), photos.leak, 'Camera sau');
  await s.say('Vị trí GPS được gắn tự động. Mức độ để "Theo loại sự cố", trừ khi bạn thấy nghiêm trọng hơn.');
  await s.tap(app.getByRole('button', { name: 'Gửi báo cáo' }), { wait: 2500 });
  await s.show(app.getByText(/Đã báo|Đã lưu/), 'Gửi xong, đội trưởng nhận thông báo ngay. Không có mạng thì báo cáo được lưu và tự gửi khi có sóng.');
  await s.tap(app.getByRole('button', { name: 'Về ca trực' }), { wait: 1500 });

  s.chapter('SOS khẩn cấp');
  const sos = app.getByRole('button', { name: /SOS/ });
  await s.scroll(600);
  await s.show(sos, 'Nút SOS ở cuối màn hình Ca trực. Chỉ dùng khi nguy hiểm: GIỮ 2 GIÂY để gửi — đội trưởng và quản lý được báo cùng vị trí của bạn.');
  await s.say('Sau khi gửi SOS, hãy giữ an toàn và gọi điện ngay cho đội trưởng.');
  await s.scrollTop();

  s.chapter('Giao ca');
  await s.say('Gần hết ca, thẻ ca hiện thêm nút "🔁 Giao ca": đánh dấu từng mục bàn giao Đủ / Thiếu / Có vấn đề, ghi chú cho ca sau. Người nhận ca xác nhận trên máy của họ.');

  s.chapter('Xin nghỉ');
  await s.tap(app.getByRole('link', { name: /Tôi/ }), { wait: 1500 });
  await s.tap(app.getByRole('button', { name: /Đơn của tôi/ }), { wait: 1500 });
  await s.say('Trong "Đơn của tôi": xin nghỉ, xem đơn đã duyệt chưa, và xin bổ sung chấm công khi quên vào/ra ca.');
  await s.tap(app.getByRole('button', { name: '📝 Xin nghỉ' }), { wait: 1500 });
  await s.tap(app.getByRole('button', { name: 'Việc riêng' }));
  const day = plusDays(2);
  await s.point(app.getByLabel('Từ ngày'));
  await app.getByLabel('Từ ngày').fill(day);
  await app.getByLabel('Đến ngày').fill(day);
  await s.sleep(600);
  await s.type(app.getByLabel('Lý do'), 'Về quê có việc gia đình', { delay: 45 });
  await s.tap(app.getByRole('button', { name: 'Gửi đơn' }), { wait: 2200 });
  await s.show(app.locator('section').filter({ hasText: 'Chờ duyệt' }).first(), 'Đơn gửi tới đội trưởng duyệt. Kết quả hiện ở đây và có thông báo. Đơn còn "Chờ duyệt" thì rút lại được.');
  // The form replaced itself with the list: two steps back to "Tôi".
  await back();
  if (!(await app.getByRole("navigation").isVisible())) await back();

  s.chapter('Trang Tôi');
  await s.show(app.locator('section').first(), 'Trang "Tôi": thông tin tài khoản và tình trạng máy đã được duyệt.');
  await s.show(app.locator('section').nth(1), '"Chờ gửi khi có mạng" liệt kê những gì máy chưa gửi được. Đừng đăng xuất khi còn mục chờ gửi.');
  await s.show(app.getByRole('link', { name: 'Thông báo' }), 'Biểu tượng chuông góc trên: thông báo về ca, đơn từ và sự cố của bạn.');

  await s.end('Vào ca đúng giờ · Quét đủ điểm tuần tra · Ghi sổ trực · Báo sự cố ngay khi phát hiện');
}
