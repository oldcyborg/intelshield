import { studio } from '../lib.mjs';
import { PASSWORD } from '../setup.mjs';

const local = (offsetMonths) => {
  const [y, m] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date()).split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offsetMonths, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export default async function accountantVideo(ctx) {
  const { accountant, guard } = ctx;
  const s = await studio({
    name: '5-ke-toan',
    role: 'KẾ TOÁN',
    title: 'Vai trò Kế toán',
    intro: 'Hồ sơ lương · Bảng lương & phiếu lương · Đối soát với khách · Đề nghị thanh toán · Thu tiền & công nợ',
  });
  const p = s.page;
  const main = p.locator('main');
  const nav = (name) => s.tap(p.locator('aside').getByRole('link', { name, exact: true }), { wait: 2200 });
  const card = (title) => main.locator('section').filter({ has: p.getByRole('heading', { name: title }) }).first();
  await s.start('/dang-nhap');

  s.chapter('Đăng nhập');
  await s.say('Kế toán làm việc trên trang web quản lý. Đăng nhập bằng số điện thoại hoặc email.');
  await s.type(p.getByLabel('Số điện thoại hoặc email'), accountant.phone);
  await s.type(p.getByLabel('Mật khẩu'), PASSWORD);
  await s.tap(p.getByRole('button', { name: 'Đăng nhập' }), { wait: 3000 });
  await main.getByText('Xin chào').waitFor();
  await s.show(p.locator('aside'), 'Menu của kế toán: khách hàng, hợp đồng và đơn giá, chấm công, vi phạm, nhân viên — và hai mục chính: "Bảng lương", "Đối soát & công nợ".');

  s.chapter('Hồ sơ lương');
  await nav('Nhân viên');
  await s.tap(main.getByRole('link', { name: guard.name }), { wait: 2500 });
  const pay = main.locator('section').filter({ hasText: 'Hình thức trả lương' }).first();
  await pay.scrollIntoViewIfNeeded();
  await s.show(pay, 'Mỗi nhân viên có hồ sơ lương: trả theo tháng, theo ca hoặc theo giờ; lương cơ bản, phụ cấp, BHXH trừ mỗi tháng, tài khoản ngân hàng. Chỉ kế toán, HR và giám đốc thấy phần này.');

  s.chapter('Quy tắc tính lương');
  await nav('Bảng lương');
  const rules = card('Quy tắc tính lương');
  await rules.scrollIntoViewIfNeeded();
  await s.tap(rules.getByRole('button', { name: /Xem/ }), { wait: 1200 });
  await s.show(rules, 'Quy tắc dùng cho cả công ty: số công chuẩn của lương tháng, hệ số ngày lễ và tăng ca, danh sách ngày lễ, mức trừ cho từng loại vi phạm đã được quản lý xác nhận.', 7000);
  await s.scroll(500);
  await s.sleep(1200);
  await s.scrollTop();

  s.chapter('Lập bảng lương');
  await s.say('Đầu tháng, lập bảng lương tháng trước. Hệ thống tự tính từ chấm công thực tế (kể cả giờ đã điều chỉnh qua đơn), vi phạm đã xác nhận và hồ sơ lương.');
  await s.point(main.getByLabel('Tháng', { exact: true }));
  await main.getByLabel('Tháng', { exact: true }).fill(local(-1));
  await s.sleep(700);
  await s.tap(main.getByRole('button', { name: 'Lập và tính lương' }), { wait: 3500 });
  await main.getByText('Tổng thực lĩnh').waitFor();
  await s.show(main.locator('.grid').first(), 'Tổng quan kỳ lương: số người, tổng thu nhập, tổng khấu trừ và tổng thực lĩnh phải trả.');
  await s.show(main.locator('table').first(), 'Mỗi dòng một người: số công (hoặc giờ), lương chính, lễ và tăng ca, phụ cấp, trừ vi phạm, BHXH, điều chỉnh và thực lĩnh. Dòng có ⚠ cần xem lại, ví dụ ca chưa có giờ ra.', 7500);

  s.chapter('Chi tiết và điều chỉnh');
  const row = main.locator('tbody tr').filter({ hasText: guard.name }).first();
  await s.tap(row, { wait: 1500 });
  await s.say('Bấm vào một người: thấy từng ca đã làm, giờ làm thực tế so với kế hoạch, các vi phạm đã xác nhận và tài khoản chuyển khoản.');
  await s.tap(main.getByRole('button', { name: '+ Thêm khoản' }));
  await s.type(main.getByPlaceholder('Số tiền').last(), '300000');
  await s.type(main.getByPlaceholder('Ghi chú').last(), 'Thưởng chuyên cần');
  await s.say('Kế toán nhập thêm thưởng, tạm ứng, thuế TNCN hoặc khoản khác (số âm là trừ). Bấm "Tính lại" khi có chấm công sửa muộn — các khoản nhập tay vẫn giữ nguyên.');
  await s.tap(main.getByRole('button', { name: 'Lưu điều chỉnh' }), { wait: 2000 });

  s.chapter('Chốt và trả lương');
  await s.scrollTop();
  await s.say('Kiểm tra xong, bấm "Chốt bảng lương". Từ lúc này không sửa được nữa; mỗi bảo vệ nhận thông báo và xem phiếu lương của mình trên ứng dụng.');
  await s.tap(main.getByRole('button', { name: 'Chốt bảng lương' }), { wait: 2500 });
  await main.getByText('Đã chốt').first().waitFor();
  await s.say('Cần sửa sau khi chốt: bấm "Mở lại" và ghi lý do — hệ thống lưu lại ai mở, vì sao.');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
  await s.prompt('Ngày trả lương (YYYY-MM-DD):', today, main.getByRole('button', { name: 'Đánh dấu đã trả' }));
  await s.say('Chuyển khoản xong thì "Đánh dấu đã trả". Kỳ lương đã trả thì không mở lại được nữa.');

  s.chapter('Đối soát với khách');
  await nav('Đối soát & công nợ');
  await s.say('Mỗi tháng, mỗi hợp đồng có một bảng đối soát: tính theo đơn giá hợp đồng — theo người/tháng, theo ca hoặc theo giờ trực thực tế.');
  const terms = card('Điều khoản thu tiền');
  await terms.scrollIntoViewIfNeeded();
  await s.show(terms, 'Điều khoản thu tiền: VAT mặc định, số ngày được thanh toán sau khi chốt, và thông tin chuyển khoản in trên đề nghị thanh toán.');
  await s.scrollTop();
  const month = main.locator('input[type=month]');
  await s.point(month);
  await month.fill(local(0));
  await s.sleep(1500);
  await s.tap(main.getByRole('button', { name: /Lập đối soát/ }), { wait: 3000 });
  await s.show(main.locator('table').last(), 'Mỗi hợp đồng một dòng: trạng thái nháp, tổng tiền, số đề nghị, hạn thanh toán, đã thu và còn lại.');
  await s.tap(main.getByRole('link', { name: 'Khu đô thị Mỹ Đình Pearl' }), { wait: 2500 });

  s.chapter('Giảm trừ thiếu người');
  await s.show(main.locator('table').first(), 'Các dòng theo hợp đồng được tính tự động. Ca đã xếp mà không ai trực (và không có người trực thay) hiện thành dòng gợi ý giảm trừ — mặc định chưa trừ.', 7500);
  await s.maybe('giảm trừ', async () => {
    await s.tap(main.getByRole('button', { name: 'xem ca' }).first(), { wait: 1200 });
    await s.say('"xem ca" liệt kê từng ca thiếu: ngày, mục tiêu, người vắng. Thoả thuận với khách xong, tick để áp dụng giảm trừ.');
    await s.tap(main.locator('input[type=checkbox]').first(), { wait: 1800 });
  });
  await s.type(main.getByPlaceholder('VD: Tăng cường bảo vệ dịp lễ'), 'Tăng cường 2 bảo vệ sự kiện cuối tuần', { delay: 35 });
  await s.type(main.getByLabel('Số tiền (âm = giảm trừ)'), '1500000');
  await s.tap(main.getByRole('button', { name: 'Thêm dòng' }), { wait: 1800 });
  await s.say('Thêm dòng phát sinh (số âm là giảm giá), sửa VAT riêng nếu hợp đồng khác mặc định. Tổng cộng tự cập nhật.');

  s.chapter('Đề nghị thanh toán');
  await s.scrollTop();
  await s.tap(main.getByRole('button', { name: 'Chốt đề nghị thanh toán' }), { wait: 2500 });
  await s.say('Chốt bảng thành đề nghị thanh toán: hệ thống đánh số (DNTT-…) và tính hạn thanh toán.');
  const url = p.url();
  const id = url.split('/').pop();
  await s.point(main.getByRole('link', { name: /In \/ lưu PDF/ }));
  await p.goto(`http://localhost:3000/de-nghi-thanh-toan/${id}`);
  await p.getByRole('heading', { name: 'ĐỀ NGHỊ THANH TOÁN' }).waitFor();
  await s.say('Trang in đề nghị thanh toán: bảng đối soát, VAT, tổng tiền bằng chữ, hạn thanh toán, thông tin chuyển khoản. Bấm In và chọn "Lưu dưới dạng PDF" để gửi khách.', 7500);
  await s.scroll(500, { x: 640 });
  await s.sleep(1500);
  await p.goto(url);
  await main.getByText('Tiền thu').first().waitFor();

  s.chapter('Ghi nhận tiền thu');
  const money = card('Tiền thu');
  await money.scrollIntoViewIfNeeded();
  await s.say('Khách chuyển tiền: ghi ngày thu, số tiền, hình thức và số chứng từ. Thu từng phần cũng được — "Còn lại" tự giảm.');
  await s.type(money.getByLabel('Số tiền', { exact: true }), '50000000');
  await s.choose(money.getByLabel('Hình thức'), 'transfer');
  await s.type(money.getByLabel('Số chứng từ'), 'UNC 1024');
  await s.tap(money.getByRole('button', { name: 'Ghi nhận tiền thu' }), { wait: 2200 });
  await s.show(card('Tiền thu'), 'Ghi nhầm thì bấm × và ghi lý do xoá. Còn khoản thu thì không mở lại đề nghị được — tránh sửa số đã gửi khách.');

  s.chapter('Công nợ');
  await nav('Đối soát & công nợ');
  await s.show(card('Công nợ theo khách hàng'), 'Bảng công nợ theo khách hàng: đã đề nghị, đã thu, còn phải thu, và số tiền quá hạn bao nhiêu ngày — để nhắc khách đúng lúc.');

  await s.end('Lập bảng lương đầu tháng · Chốt để bảo vệ xem phiếu lương · Đối soát và gửi đề nghị thanh toán · Ghi nhận tiền thu');
}
