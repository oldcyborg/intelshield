/**
 * Every permission the API checks. Adding one later needs a migration that grants
 * it to the system roles of existing companies — templates only seed new ones.
 */
export const PERMISSIONS = {
  'tenant.settings.manage': 'Cài đặt công ty',
  'user.view': 'Xem người dùng',
  'user.manage': 'Tạo, sửa, khoá người dùng',
  'role.view': 'Xem vai trò',
  'role.manage': 'Tạo, sửa vai trò',
  'org.view': 'Xem nhóm, đội',
  'org.manage': 'Quản lý nhóm, đội, thành viên',
  'org.member.manage': 'Điều chuyển bảo vệ giữa các đội trong phạm vi',
  'employee.view': 'Xem nhân viên',
  'employee.manage': 'Thêm, sửa nhân viên',
  'employee.pay.view': 'Xem lương và ngày phép',
  'employee.pay.manage': 'Sửa lương và ngày phép',
  'client.view': 'Xem khách hàng',
  'client.manage': 'Thêm, sửa khách hàng',
  'contract.view': 'Xem hợp đồng và giá',
  'contract.manage': 'Tạo, sửa hợp đồng và giá',
  'deployment.view': 'Xem điều động bảo vệ',
  'deployment.manage': 'Điều động bảo vệ tới khách',
  'site.view': 'Xem mục tiêu, điểm tuần tra, tuyến',
  'site.manage': 'Cấu hình mục tiêu, điểm tuần tra, tuyến',
  'roster.view': 'Xem lịch ca',
  'roster.manage': 'Xếp ca, đổi ca',
  'attendance.view': 'Xem chấm công',
  'attendance.correct.propose': 'Đề xuất duyệt đơn bổ sung chấm công',
  'attendance.correct.review': 'Duyệt đơn bổ sung chấm công, sửa chấm công',
  'leave.review': 'Duyệt đơn nghỉ (người mình xếp ca được)',
  'device.manage': 'Duyệt, thu hồi máy của bảo vệ',
  'patrol.view': 'Xem vòng tuần tra và các lần quét',
  'patrol.perform': 'Đi tuần: bắt đầu vòng, quét điểm',
  'violation.view': 'Xem vi phạm trong phạm vi',
  'violation.propose': 'Đề xuất xác nhận hoặc miễn vi phạm',
  'violation.review': 'Duyệt vi phạm',
  'logbook.view': 'Xem sổ trực, biên bản giao ca',
  'logbook.write': 'Ghi sổ trực, giao ca (khi có ca ở mục tiêu)',
  'logbook.manage': 'Ghi sổ trực từ văn phòng',
  'handover.review': 'Duyệt biên bản giao ca',
  'incident.view': 'Xem sự cố trong phạm vi',
  'incident.report': 'Báo sự cố, bấm SOS',
  'incident.manage': 'Tiếp nhận, giao việc, xử lý sự cố',
  'incident.close': 'Đóng sự cố',
  'incident.final_escalation': 'Nhận leo thang cuối của sự cố',
  // Each contact of a site is marked for who may reach it; seeing one level includes the wider ones below it.
  'contact.view.staff': 'Xem mọi đầu mối liên hệ của mục tiêu (cả mức văn phòng)',
  'contact.view.leader': 'Xem đầu mối liên hệ mức đội trưởng và bảo vệ',
  'contact.view.guard': 'Xem đầu mối liên hệ mức bảo vệ (khi có ca ở mục tiêu)',
  'contact.manage': 'Thêm, sửa, xoá đầu mối liên hệ của mục tiêu',
  'payroll.view': 'Xem bảng lương các kỳ',
  'payroll.manage': 'Tính, chỉnh, chốt bảng lương; cài đặt quy tắc lương',
  'billing.view': 'Xem đối soát, đề nghị thanh toán, công nợ khách hàng',
  'billing.manage': 'Lập đối soát, chốt đề nghị thanh toán, ghi nhận tiền thu; cài đặt VAT, hạn thanh toán',
} as const;

export type Permission = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

/** The one role defined by identity: it cannot be edited and a company always keeps a holder. */
export const ADMIN_ROLE_CODE = 'admin';

export const ROLE_TEMPLATES: { code: string; name: string; permissions: Permission[] }[] = [
  { code: ADMIN_ROLE_CODE, name: 'Quản trị (giám đốc)', permissions: ALL_PERMISSIONS },
  { code: 'manager', name: 'Quản lý', permissions: ['user.view', 'org.view', 'org.member.manage', 'employee.view', 'client.view', 'deployment.view', 'site.view', 'site.manage', 'roster.view', 'roster.manage', 'attendance.view',
    'incident.view', 'incident.report', 'incident.manage', 'incident.close', 'patrol.view',
    'violation.view', 'violation.propose', 'violation.review', 'logbook.view', 'logbook.manage', 'handover.review',
    'leave.review', 'attendance.correct.propose', 'attendance.correct.review', 'contact.view.staff', 'contact.view.leader', 'contact.view.guard', 'contact.manage'] },
  { code: 'team_leader', name: 'Đội trưởng', permissions: ['org.view', 'employee.view', 'site.view', 'roster.view', 'roster.manage', 'attendance.view',
    'incident.view', 'incident.report', 'incident.manage', 'patrol.view', 'patrol.perform', 'violation.view', 'violation.propose',
    'logbook.view', 'logbook.write', 'handover.review', 'leave.review', 'attendance.correct.propose', 'contact.view.leader', 'contact.view.guard'] },
  { code: 'guard', name: 'Bảo vệ', permissions: ['incident.report', 'patrol.perform', 'logbook.write', 'contact.view.guard'] },
  {
    code: 'hr',
    name: 'HR (nhân sự)',
    permissions: ['user.view', 'user.manage', 'role.view', 'org.view', 'org.manage', 'org.member.manage', 'employee.view', 'employee.manage',
      'client.view', 'deployment.view', 'deployment.manage', 'site.view',
      'roster.view', 'roster.manage', 'attendance.view', 'device.manage', 'incident.view', 'incident.report', 'patrol.view', 'patrol.perform', 'violation.view', 'logbook.view', 'logbook.write',
      'employee.pay.view', 'employee.pay.manage', 'contact.view.staff', 'contact.view.leader', 'contact.view.guard', 'payroll.view',
    ],
  },
  {
    code: 'accountant',
    name: 'Kế toán',
    permissions: [
      'employee.view', 'client.view', 'client.manage', 'contract.view', 'contract.manage', 'deployment.view', 'site.view',
      'roster.view', 'attendance.view', 'patrol.view', 'violation.view', 'employee.pay.view', 'employee.pay.manage', 'contact.view.staff', 'contact.view.leader', 'contact.view.guard',
      'payroll.view', 'payroll.manage', 'billing.view', 'billing.manage',
    ],
  },
];
