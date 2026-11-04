import { studio } from '../lib.mjs';
import { PASSWORD } from '../setup.mjs';

export default async function leaderVideo(ctx) {
  const { leader, guard, site } = ctx;
  const s = await studio({
    name: '2-truong-doi',
    mobile: true,
    role: 'TRƯỞNG ĐỘI',
    who: `Ví dụ: ${leader.name} · Đội ${site.name.split(' — ')[0]}`,
    title: 'Vai trò Trưởng đội',
    intro: 'Theo dõi đội trực · Vòng tuần · Xử lý sự cố · Duyệt đơn nghỉ và vi phạm',
    geolocation: { latitude: site.lat, longitude: site.lng, accuracy: 8 },
  });
  const app = s.app;
  const back = () => s.tap(app.getByRole('button', { name: 'Quay lại' }), { wait: 1300 });
  const tab = (name) => s.tap(app.getByRole('navigation').getByRole('link', { name }), { wait: 1800 });
  const pickSite = async () => {
    const picker = app.locator('select').first();
    if (!(await picker.count()) || (await picker.locator('option').count()) < 2) return;
    const label = (await picker.locator('option').allTextContents()).find((t) => t.includes(site.name));
    if (label) await s.choose(picker, { label });
  };
  await s.start();

  s.chapter('Đăng nhập');
  await s.say('Trưởng đội dùng cùng ứng dụng IntelShield với bảo vệ. Sau khi đăng nhập, các màn hình hiện theo quyền của trưởng đội.');
  await s.type(app.getByLabel('Số điện thoại'), leader.phone);
  await s.type(app.getByLabel('Mật khẩu'), PASSWORD);
  await s.tap(app.getByRole('button', { name: 'Đăng nhập' }), { wait: 2500 });
  await app.getByRole('navigation').waitFor();
  await s.show(app.getByRole('navigation'), 'Thanh dưới có thêm: "Đội" để theo dõi người đang trực, "Sự cố" và "Duyệt" cho đơn nghỉ, vi phạm, biên bản giao ca.');
  await s.say('Tab "Ca trực" là ca của chính bạn — vào ca, tuần tra, sổ trực giống hệt bảo vệ.');

  s.chapter('Thông báo');
  await s.tap(app.getByRole('link', { name: 'Thông báo' }).first(), { wait: 1800 });
  await s.say('Chuông thông báo báo ngay khi bảo vệ trong đội báo sự cố, gửi đơn nghỉ, vào ca trễ hoặc bỏ vòng tuần.');
  await s.maybe('thông báo', async () => {
    await s.show(app.locator('section').first(), 'Chạm vào một thông báo để mở đúng màn hình cần xử lý.');
  });
  await back();

  s.chapter('Đội đang trực');
  await tab(/Đội/);
  await pickSite();
  await s.sleep(1200);
  await s.show(app.locator('.grid-cols-3').first(), 'Phần "Ca trực" đếm số người đang trực, đi trễ và vắng ở mục tiêu, cập nhật mỗi phút.');
  await s.maybe('ca của bảo vệ', async () => {
    const row = app.locator('a[href^="#/doi/ca/"]').filter({ hasText: guard.name }).first();
    await s.show(row, `Mỗi dòng là một ca: trạng thái, giờ vào ca, số phút trễ. Chạm vào để xem chi tiết.`);
    await s.tap(row, { wait: 1800 });
    await s.say('Chi tiết ca có ảnh khuôn mặt lúc vào ca và khoảng cách tới mục tiêu — dùng để kiểm tra vào ca hộ hoặc chấm công sai chỗ.');
    await s.scroll(250);
    await s.sleep(1500);
    await back();
  });

  await s.tap(app.getByRole('button', { name: 'Vòng tuần' }), { wait: 1800 });
  await s.show(app.locator('section').first(), 'Phần "Vòng tuần": số vòng đủ điểm, đang tuần, thiếu điểm và bỏ lỡ trong ngày.');
  await s.maybe('vòng tuần', async () => {
    const round = app.locator('a[href^="#/doi/vong/"]').filter({ hasText: guard.name }).first();
    await s.tap(round, { wait: 1800 });
    await s.say('Chi tiết vòng: điểm nào đã quét, lúc mấy giờ, bằng QR hay GPS. Lần quét nghi vấn (sai vị trí, quét quá nhanh) được đánh dấu đỏ.');
    await s.scroll(300);
    await s.sleep(1500);
    await back();
  });

  await s.tap(app.getByRole('button', { name: 'Sổ trực' }), { wait: 1800 });
  await s.say('Phần "Sổ trực": khách và xe đang ở trong mục tiêu, cùng mọi dòng sổ bảo vệ đã ghi hôm nay.');
  await s.scroll(300);
  await s.sleep(1200);

  s.chapter('Xử lý sự cố');
  await tab(/Sự cố/);
  await s.say('Tab "Sự cố" xếp sự cố chưa ai nhận và nghiêm trọng lên đầu. Nút "+ Ghi nhận" để ghi sự cố khách báo qua điện thoại.');
  await s.maybe('sự cố của bảo vệ', async () => {
    const card = app.locator('a[href^="#/su-co/"]').filter({ hasText: guard.name }).first();
    await s.tap(card, { wait: 1800 });
    await s.say('Sự cố bảo vệ vừa báo: mô tả, ảnh, vị trí trên bản đồ và dòng thời gian.');
    await s.tap(app.getByRole('button', { name: 'Tôi tiếp nhận' }), { wait: 1800 });
    await s.say('Bấm "Tôi tiếp nhận" để mọi người biết đã có người lo. Sự cố không ai nhận sẽ tự leo thang lên quản lý.');
    await s.tap(app.getByRole('button', { name: 'Giao người xử lý' }), { wait: 1500 });
    await s.say('Giao việc cho người đang trực tại chỗ — họ nhận thông báo ngay.');
    await s.tap(app.getByRole('button', { name: new RegExp(guard.name) }), { wait: 1800 });
    await s.tap(app.getByRole('button', { name: 'Đã xử lý xong' }), { wait: 1200 });
    await s.type(app.locator('textarea'), 'Đã khoá van tổng, gọi kỹ thuật toà nhà thay ống. Hành lang đã lau khô.', { delay: 35 });
    await s.tap(app.getByRole('button', { name: 'Gửi' }), { wait: 2200 });
    await s.say('Sự cố chuyển sang "Chờ đóng". Quản lý kiểm tra rồi đóng sự cố trên web.');
    await s.scroll(400);
    await s.sleep(1500);
    await back();
  });

  s.chapter('Duyệt đơn nghỉ');
  await tab(/Duyệt/);
  await s.say('Tab "Duyệt" gom mọi việc cần trưởng đội quyết: đơn nghỉ, bổ sung chấm công, vi phạm và biên bản giao ca.');
  await s.maybe('đơn nghỉ', async () => {
    const leave = app.locator('section').filter({ hasText: guard.name }).filter({ has: app.getByRole('button', { name: 'Không duyệt' }) }).first();
    await s.show(leave, 'Đơn nghỉ hiện loại nghỉ, ngày nghỉ, lý do và các ca bị ảnh hưởng. Đơn gấp (nghỉ trong 12 giờ tới) có nhãn GẤP.');
    await s.prompt('Ghi chú (không bắt buộc):', 'Đồng ý, đã sắp xếp người trực thay', leave.getByRole('button', { name: 'Duyệt', exact: true }));
    await s.say('Duyệt xong, các ca chưa vào trong ngày nghỉ được huỷ — nhớ gọi người trực thay. Bảo vệ nhận kết quả trên máy.');
  });

  s.chapter('Vi phạm');
  await s.maybe('vi phạm', async () => {
    const heading = app.getByText(/Vi phạm chờ xử lý/);
    await heading.scrollIntoViewIfNeeded();
    await s.show(heading, 'Hệ thống tự ghi vi phạm: vào trễ, vắng ca, về sớm, bỏ vòng tuần, thiếu điểm, quét nghi vấn.');
    const v = app.locator('section').filter({ hasText: guard.name }).filter({ has: app.getByRole('button', { name: 'Đề xuất miễn' }) }).first();
    await s.show(v, 'Trưởng đội không tự quyết mà đề xuất: "Đề xuất xác nhận" (tính vào lương) hoặc "Đề xuất miễn" (có lý do chính đáng).');
    await s.prompt('Lý do miễn (bắt buộc):', 'Mưa ngập đường Phạm Hùng, đã gọi báo trước', v.getByRole('button', { name: 'Đề xuất miễn' }));
    await s.say('Đề xuất được gửi lên quản lý duyệt lần cuối. Chỉ vi phạm đã xác nhận mới tính vào lương.');
  });

  s.chapter('Biên bản giao ca');
  await s.maybe('giao ca', async () => {
    const h = app.getByText('Biên bản giao ca chờ duyệt');
    await h.scrollIntoViewIfNeeded();
    await s.show(h, 'Cuối ca, người giao và người nhận ca xác nhận biên bản trên máy. Biên bản có mục Thiếu hoặc bị phản đối hiện viền đỏ để trưởng đội xem và duyệt.');
  });

  s.chapter('Trang Tôi');
  await tab(/Tôi/);
  await s.say('Trang "Tôi" có đơn của chính bạn, đổi mật khẩu và đăng xuất. Quên mật khẩu: trưởng đội hoặc HR đặt lại cho bảo vệ.');

  await s.end('Theo dõi đội mỗi ca · Tiếp nhận sự cố ngay · Duyệt đơn nghỉ và đề xuất vi phạm đúng hạn');
}
