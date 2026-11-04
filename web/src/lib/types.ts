export interface Profile {
  id: string;
  tenant_id: string | null;
  user_type: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  employee_id: string | null;
  must_change_password: boolean;
}

export interface Me {
  user: Profile;
  permissions: string[];
  team_visibility: { all: boolean; team_ids: string[] };
}

export interface Employee {
  id: string;
  code: string;
  full_name: string;
  phone: string | null;
  position: string;
  status: 'active' | 'inactive';
  team: { id: string; name: string } | null;
}

export interface TeamRow {
  id: string;
  name: string;
  team_group_id: string | null;
  leader_employee_id: string | null;
  leader_name: string | null;
  member_count: number;
}

export interface GroupRow {
  id: string;
  name: string;
  manager_user_id: string | null;
  manager_name: string | null;
}

export interface ChartNode {
  group: GroupRow | null;
  teams: TeamRow[];
}

export interface Member {
  id: string;
  employee_id: string;
  code: string;
  full_name: string;
  phone: string | null;
  start_date: string;
  is_leader: boolean;
}

export interface RoleView {
  id: string;
  code: string;
  name: string;
  is_system: boolean;
  permissions: string[];
}

export interface UserRow {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  user_type: 'staff' | 'guard' | 'platform_admin' | 'client_user';
  status: 'active' | 'locked';
  employee_id: string | null;
  last_login_at: string | null;
  roles: { id: string; code: string; name: string }[];
}

export interface UserView extends UserRow {
  must_change_password: boolean;
  scopes: { scope_type: string; scope_id: string | null }[];
}

export interface FileView {
  id: string;
  original_name: string;
  mime: string;
  size: number;
}

export interface ClientView {
  id: string;
  code: string;
  name: string;
  management_mode: 'managed' | 'self_managed';
  tax_code: string | null;
  address: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  account_manager_id: string | null;
  account_manager_name: string | null;
  status: 'active' | 'inactive';
  note: string | null;
  guards_today: number;
  active_contracts: number;
}

export type ContractStatus = 'draft' | 'upcoming' | 'active' | 'expiring' | 'expired' | 'terminated';

export interface LineView {
  id: string;
  position: string;
  headcount: number;
  unit: 'per_guard_month' | 'per_shift' | 'per_hour';
  unit_price: string;
  shift_hours: string | null;
  effective_from: string;
  effective_to: string | null;
}

export interface ContractView {
  id: string;
  client_id: string;
  client_name: string;
  contract_no: string;
  signed_at: string | null;
  start_date: string;
  end_date: string;
  notice_days: number;
  auto_renew: boolean;
  state: 'draft' | 'signed' | 'terminated';
  terminated_on: string | null;
  status: ContractStatus;
  days_left: number;
  file: FileView | null;
  note: string | null;
  lines?: LineView[];
}

export interface DeploymentView {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  client_id: string;
  client_name: string;
  contract_id: string | null;
  contract_no: string | null;
  position: string;
  start_date: string;
  end_date: string | null;
  end_reason: string | null;
}

export interface DocumentView {
  id: string;
  kind: string;
  number: string | null;
  issued_on: string | null;
  expires_on: string | null;
  days_left: number | null;
  file: FileView | null;
  note: string | null;
}

export interface EmployeeProfile extends Employee {
  date_of_birth: string | null;
  national_id: string | null;
  address: string | null;
  hire_date: string | null;
  emergency_contact: string | null;
  note: string | null;
  documents: DocumentView[];
}

export interface CompanyDashboard {
  guards: { active: number; deployed: number; idle: number };
  expiring_contracts: { id: string; contract_no: string; client_id: string; client_name: string; end_date: string; days_left: number; status: ContractStatus }[];
  shortfalls: { client_id: string; client_name: string; contract_id: string; contract_no: string; position: string; headcount: number; deployed: number }[];
  expiring_documents: { employee_id: string; employee_name: string; kind: string; expires_on: string; days_left: number }[];
}

export interface SiteRow {
  id: string;
  client_id: string;
  client_name: string;
  code: string;
  name: string;
  address: string | null;
  lat: string | null;
  lng: string | null;
  geofence_radius_m: number;
  responsible_team_id: string | null;
  responsible_team_name: string | null;
  status: 'active' | 'inactive';
  note: string | null;
  checkpoint_count: number;
  route_count: number;
}

export interface SiteDetail extends SiteRow {
  posts: { id: string; name: string; note: string | null }[];
}

export type CheckMethod = 'qr' | 'gps' | 'photo' | 'nfc';

export type PhotoRule = 'never' | 'always' | 'random';

export interface CheckpointView {
  id: string;
  site_id: string;
  code: string;
  name: string;
  lat: string | null;
  lng: string | null;
  radius_m: number;
  allowed_methods: CheckMethod[];
  photo_rule: PhotoRule;
  instructions: string | null;
  status: 'active' | 'inactive';
}

export interface RouteView {
  id: string;
  site_id: string;
  name: string;
  note: string | null;
  checkpoints: { checkpoint_id: string; code: string; name: string; seq: number; required: boolean }[];
}

export interface SettingsValues {
  late_after_minutes: number;
  absent_after_minutes: number;
  early_checkout_minutes: number;
  round_tolerance_minutes: number;
  patrol_photo_random_percent: number;
  incident_escalate_medium_minutes: number;
  incident_escalate_high_minutes: number;
  incident_escalate_critical_minutes: number;
  incident_close_by_leader_up_to: 'none' | 'low' | 'medium';
}
export type SettingKey = keyof SettingsValues;

export interface CompanySettings {
  values: SettingsValues;
  defaults: SettingsValues;
}

export interface SiteSettingsView {
  values: SettingsValues;
  source: Record<SettingKey, 'site' | 'company' | 'default'>;
  overrides: Partial<SettingsValues>;
  company: SettingsValues;
}

export interface TemplateView {
  id: string;
  site_id: string;
  name: string;
  start_time: string;
  end_time: string;
  overnight: boolean;
  headcount: number;
  position: string;
  status: 'active' | 'inactive';
}

export interface AssignmentRow {
  id: string;
  site_id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  template_id: string | null;
  template_name: string | null;
  shift_date: string;
  planned_start: string;
  planned_end: string;
  status: 'planned' | 'cancelled';
  substitute_for_id: string | null;
  attendance: { check_in_at: string; check_out_at: string | null; late_minutes: number } | null;
}

export type AttendanceStatus = 'upcoming' | 'waiting' | 'late' | 'absent' | 'on_duty' | 'done' | 'cancelled';

export interface BoardRow {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  template_name: string | null;
  planned_start: string;
  planned_end: string;
  status: AttendanceStatus;
  check_in_at: string | null;
  check_out_at: string | null;
  late_minutes: number | null;
  early_minutes: number | null;
  check_in_flags: string[] | null;
  check_out_flags: string[] | null;
  check_in_distance_m: number | null;
  check_in_selfie_id: string | null;
  check_out_selfie_id: string | null;
  late_in: boolean;
  early_out: boolean;
  corrected_at: string | null;
  leave_request_id: string | null;
}

export interface LeaveBalance {
  year: number;
  allowance: number | null;
  used: number;
  remaining: number | null;
}

export interface PayInfo {
  pay: {
    pay_type: 'monthly' | 'per_shift' | 'per_hour';
    monthly_mode: 'attendance' | 'fixed';
    base_pay: number | null;
    allowance: number | null;
    bank_name: string | null;
    bank_account: string | null;
    tax_code: string | null;
    social_insurance_no: string | null;
    social_insurance: number | null;
    annual_leave_days: number | null;
    note: string | null;
    updated_at: string;
  } | null;
  leave: LeaveBalance;
}

export interface LeaveShift {
  id: string;
  site_id: string;
  site_name: string;
  planned_start: string;
  planned_end: string;
  status: 'planned' | 'cancelled';
  checked_in: boolean;
  substitute: string | null;
}

export interface LeaveRow {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  type: 'annual' | 'sick' | 'personal' | 'unpaid';
  from_date: string;
  to_date: string;
  days: number;
  reason: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  urgent: boolean;
  created_at: string;
  created_by_name: string;
  decided_at: string | null;
  decided_by_name: string | null;
  decision_note: string | null;
  file_ids: string[];
  shifts: LeaveShift[];
  balance: LeaveBalance | null;
}

export interface CorrectionRow {
  id: string;
  /** False: someone else's team — seen, not decided here. */
  can_judge?: boolean;
  assignment_id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  site_id: string;
  site_name: string;
  planned_start: string;
  planned_end: string;
  check_in_at: string | null;
  check_out_at: string | null;
  reason_code: string;
  reason: string | null;
  status: 'pending' | 'proposed_approve' | 'proposed_reject' | 'approved' | 'rejected' | 'cancelled';
  before: { check_in_at: string | null; check_out_at: string | null } | null;
  created_at: string;
  created_by_name: string;
  proposed_note: string | null;
  proposed_by_name: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
  current: { check_in_at: string | null; check_out_at: string | null } | null;
  file_ids: string[];
  evidence: { scans: number; first_scan_at: string | null; last_scan_at: string | null; logbook: number; handovers: { role: 'gave' | 'took'; at: string | null }[] };
}

export interface DeviceRow {
  id: string;
  user_id: string;
  full_name: string;
  phone: string | null;
  employee_code: string | null;
  device_id: string;
  platform: string | null;
  restricted: boolean;
  status: 'pending' | 'active' | 'revoked';
  created_at: string;
  last_seen_at: string | null;
}

export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type IncidentStatus = 'new' | 'acknowledged' | 'in_progress' | 'resolved' | 'closed' | 'rejected';

export interface IncidentCategory {
  id: string;
  name: string;
  default_severity: Severity;
  sort: number;
  status: 'active' | 'inactive';
}

export interface IncidentRow {
  id: string;
  code: string;
  client_id: string;
  client_name: string;
  site_id: string | null;
  site_name: string | null;
  category_name: string | null;
  severity: Severity;
  is_sos: boolean;
  title: string;
  description: string | null;
  lat: number | null;
  lng: number | null;
  source: 'guard_app' | 'staff' | 'client_report';
  client_reporter_name: string | null;
  client_channel: string | null;
  reported_by: string;
  reporter_name: string | null;
  assignee_user_id: string | null;
  assignee_name: string | null;
  status: IncidentStatus;
  acknowledged_at: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  closed_at: string | null;
  rejected_reason: string | null;
  escalation_level: number;
  created_at: string;
  occurred_at?: string;
  sent_late?: boolean;
}

export interface IncidentEvent {
  id: string;
  type: string;
  actor_name: string | null;
  body: string | null;
  from_status: IncidentStatus | null;
  to_status: IncidentStatus | null;
  data: { level?: number; user_id?: string; file_ids?: string[] };
  created_at: string;
}

export interface IncidentDetail extends IncidentRow {
  events: IncidentEvent[];
  files: { id: string; original_name: string; mime: string; size: number; created_at: string }[];
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  data: { incident_id?: string };
  priority: 'normal' | 'high' | 'critical';
  read_at: string | null;
  created_at: string;
}

export interface PatrolScheduleView {
  id: string;
  site_id: string;
  route_id: string;
  route_name: string;
  name: string;
  start_time: string;
  end_time: string;
  interval_minutes: number;
  days: number[];
  status: 'active' | 'inactive';
  rounds_per_day: number;
}

export type RoundStatus = 'pending' | 'in_progress' | 'completed' | 'partial' | 'missed';

export interface RoundRow {
  id: string;
  expected_start: string;
  expected_end: string;
  status: RoundStatus;
  late: boolean;
  backdated: boolean;
  started_at: string | null;
  ended_at: string | null;
  ended_by: 'guard' | 'system' | null;
  required_count: number;
  done_required: number;
  route_name: string;
  schedule_name: string;
  employee_name: string | null;
  scan_count: number;
  suspicious_count: number;
}

export interface RoundStop {
  checkpoint_id: string;
  seq: number;
  required: boolean;
  code: string;
  name: string;
  allowed_methods: CheckMethod[];
  photo_required: boolean;
  scanned_at: string | null;
  method: string | null;
  validity: 'valid' | 'suspicious' | null;
  flags: string[];
}

export interface ScanRow {
  id: string;
  checkpoint_code: string;
  checkpoint_name: string;
  method: 'qr' | 'gps' | 'photo';
  scanned_at: string;
  device_time: string;
  server_time: string;
  captured_offline: boolean;
  lat: string | null;
  lng: string | null;
  accuracy_m: number | null;
  distance_m: number | null;
  photo_id: string | null;
  flags: string[];
  validity: 'valid' | 'suspicious';
  employee_name: string;
}

export interface RoundDetail {
  id: string;
  site_id: string;
  site_name: string;
  route_name: string;
  schedule_name: string;
  expected_start: string;
  expected_end: string;
  status: RoundStatus;
  late: boolean;
  started_at: string | null;
  ended_at: string | null;
  ended_by: 'guard' | 'system' | null;
  employee_name: string | null;
  required_count: number;
  done_required: number;
  stops: RoundStop[];
  scans: ScanRow[];
}

export interface PatrolToday {
  site_id: string;
  site_name: string;
  total: number;
  completed: number;
  partial: number;
  missed: number;
  in_progress: number;
  suspicious: number;
}

export type ViolationType = 'late_check_in' | 'absent' | 'early_check_out' | 'missed_round' | 'missed_checkpoint' | 'suspicious_scan';
export type ViolationStatus = 'auto' | 'proposed_confirm' | 'proposed_waive' | 'confirmed' | 'waived';

export interface ViolationRow {
  id: string;
  can_judge?: boolean;
  type: ViolationType;
  status: ViolationStatus;
  occurred_at: string;
  minutes: number | null;
  detail: { converted_from?: string; missing?: { code: string; name: string }[]; flags?: string[]; checkpoint_code?: string; checkpoint_name?: string; round_id?: string; route_name?: string };
  ref_type: 'assignment' | 'round' | 'scan';
  ref_id: string;
  site_id: string;
  site_name: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  proposed_note: string | null;
  proposed_at: string | null;
  proposed_by_name: string | null;
  review_note: string | null;
  reviewed_at: string | null;
  reviewed_by_name: string | null;
}

export interface ViolationSummary {
  auto: number;
  proposed_confirm: number;
  proposed_waive: number;
  confirmed_30d: number;
  waived_30d: number;
}

export type LogbookType = 'note' | 'visitor' | 'vehicle' | 'asset' | 'other';

export interface LogbookRow {
  id: string;
  site_id: string;
  type: LogbookType;
  body: string | null;
  data: {
    visitor_name?: string; visitor_org?: string; meet_whom?: string; purpose?: string;
    plate?: string; vehicle_kind?: string; cargo?: string;
    item?: string; quantity?: number; asset_action?: 'received' | 'handed_out' | 'lent' | 'returned'; counterpart?: string;
  };
  occurred_at: string;
  exited_at: string | null;
  captured_offline: boolean;
  author_name: string;
  exited_by_name: string | null;
  files: { id: string; mime: string }[];
}

export interface HandoverRow {
  id: string;
  site_id: string;
  from_name: string;
  to_name: string | null;
  to_employee_id: string | null;
  items: { label: string; status: 'ok' | 'missing' | 'issue'; note?: string }[];
  notes: string | null;
  status: 'submitted' | 'accepted' | 'disputed';
  submitted_at: string;
  receiver_note: string | null;
  answered_at: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  reviewed_by_name: string | null;
  file_ids: string[];
}

export type ContactLevel = 'staff' | 'leader' | 'guard';

export interface SiteContact {
  id: string;
  site_id: string;
  full_name: string;
  title: string | null;
  phone: string | null;
  zalo: string | null;
  email: string | null;
  hours: string | null;
  priority: number;
  visibility: ContactLevel;
  note: string | null;
}

export interface FinanceSettings {
  standard_shifts: number;
  holiday_coefficient: number;
  overtime_coefficient: number;
  holidays: string[];
  penalties: Partial<Record<ViolationType, number>>;
  vat_rate: number;
  payment_terms_days: number;
  payment_info: string | null;
}

export type PayrollStatus = 'draft' | 'locked' | 'paid';
export type AdjustmentKind = 'bonus' | 'advance' | 'tax' | 'other';

export interface PayrollAdjustment {
  kind: AdjustmentKind;
  amount: number;
  note?: string;
}

export interface PayrollPeriodRow {
  id: string;
  month: string;
  status: PayrollStatus;
  computed_at: string | null;
  locked_at: string | null;
  locked_by_name: string | null;
  paid_on: string | null;
  paid_by_name: string | null;
  note: string | null;
  people?: number;
  total_net?: number;
}

export interface PayrollLine {
  id: string;
  employee_id: string;
  employee_code: string;
  employee_name: string;
  pay_type: 'monthly' | 'per_shift' | 'per_hour' | null;
  unit: 'cong' | 'gio';
  shifts: number;
  normal_units: number;
  holiday_units: number;
  overtime_units: number;
  base_amount: number;
  holiday_amount: number;
  overtime_amount: number;
  allowance_amount: number;
  violation_amount: number;
  social_insurance: number;
  adjustments: PayrollAdjustment[];
  gross: number;
  deductions: number;
  net: number;
  warnings: string[];
  bank_name: string | null;
  bank_account: string | null;
  detail: {
    /** Present when a monthly salary is counted as fixed. */
    fixed?: { unpaid_days: number; employed_fraction: number };
    pay: { pay_type: string; base_pay: number; allowance: number } | null;
    shifts: { date: string; site: string; planned_minutes: number; worked_minutes: number | null; holiday: boolean }[];
    violations: Partial<Record<ViolationType, number>>;
  };
}

export interface PayrollPeriod extends PayrollPeriodRow {
  rules: FinanceSettings;
  lines: PayrollLine[];
}

export interface BillingStatementRow {
  id: string;
  code: string | null;
  month: string;
  status: 'draft' | 'issued';
  client_id: string;
  client_name: string;
  contract_id: string;
  contract_no: string;
  vat_rate: number;
  subtotal: number;
  vat_amount: number;
  total: number;
  issued_on: string | null;
  issued_by_name: string | null;
  due_date: string | null;
  note: string | null;
  computed_at: string | null;
  paid: number;
  balance: number;
  overdue_days: number;
}

export interface BillingLine {
  id: string;
  kind: 'contract' | 'shortfall' | 'extra';
  description: string;
  quantity: number | null;
  unit: string | null;
  unit_price: number | null;
  amount: number;
  applied: boolean;
  note: string | null;
  detail: { shifts?: { date: string; site: string; employee: string; reason: 'absent' | 'leave' }[] };
}

export interface BillingPayment {
  id: string;
  paid_on: string;
  amount: number;
  method: 'transfer' | 'cash' | 'other';
  reference: string | null;
  note: string | null;
  created_by_name: string;
}

export interface BillingStatement extends BillingStatementRow {
  lines: BillingLine[];
  payments: BillingPayment[];
  client: { name: string; tax_code: string | null; address: string | null; contact_name: string | null; contact_phone: string | null; contact_email: string | null };
  company_name: string;
  payment_info: string | null;
}

export interface ClientDebt {
  client_id: string;
  client_name: string;
  statements: number;
  billed: number;
  paid: number;
  balance: number;
  overdue: number;
  max_overdue_days: number;
}
