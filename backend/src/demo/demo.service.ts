import { Injectable, Logger } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { resolve } from 'path';
import { DataSource, EntityManager } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { ClientsService } from '../clients/clients.service';
import { addDays, todayLocal } from '../common/date';
import { BusinessException } from '../common/errors/business.exception';
import { uploadDir } from '../config/env';
import { ContractsService } from '../contracts/contracts.service';
import { DeploymentsService } from '../deployments/deployments.service';
import { EmployeesService } from '../employees/employees.service';
import { IncidentsService } from '../incidents/incidents.service';
import { HandoversService } from '../logbook/handovers.service';
import { LogbookService } from '../logbook/logbook.service';
import { OrgService } from '../org/org.service';
import { RoundsScheduler } from '../patrol/rounds.scheduler';
import { SchedulesService } from '../patrol/schedules.service';
import { CorrectionsService } from '../requests/corrections.service';
import { LeaveService } from '../requests/leave.service';
import { PayService } from '../requests/pay.service';
import { FinanceSettingsService } from '../finance/finance-settings.service';
import { PayrollService } from '../finance/payroll.service';
import { CheckpointsService } from '../sites/checkpoints.service';
import { SiteContactsService } from '../sites/contacts.service';
import { RoutesService } from '../sites/routes.service';
import { SitesService } from '../sites/sites.service';
import { TemplatesService } from '../shifts/templates.service';
import { TenantsService } from '../tenants/tenants.service';
import { UsersService } from '../users/users.service';
import { ViolationsEngine } from '../violations/engine.service';

export const DEMO_CODE = 'demo';
export const DEMO_PASSWORD = 'Demo@123456';
const HOUR = 3_600_000;
/** Advisory lock key: one reset at a time. */
const LOCK = 742_001;

export interface DemoAccount {
  role: string;
  name: string;
  phone: string;
  note?: string;
}

export interface DemoResult {
  company: string;
  password: string;
  built_at: string;
  accounts: DemoAccount[];
  figures: { shifts: number; attendances: number; violations: number };
}

/** The same "random" every reset: the demo looks alike each time, shifted to the day it is rebuilt. */
function prng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A Vietnam wall-clock time on a local date, as an instant. */
const at = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+07:00`);

const GUARD_NAMES = [
  'Phạm Văn Cường', 'Hoàng Văn Dũng', 'Vũ Văn Đức', 'Đỗ Minh Hải', 'Bùi Văn Hùng',
  'Ngô Quang Huy', 'Đặng Văn Khánh', 'Trịnh Văn Long', 'Lý Văn Mạnh', 'Phan Văn Nam',
  'Hồ Văn Phúc', 'Dương Văn Quân', 'Mai Văn Sơn', 'Tạ Văn Thắng', 'Lương Văn Tùng',
];

interface SitePlan {
  id: string;
  name: string;
  lat: number;
  lng: number;
  team: string[]; // employee ids, rotation order
  day: { template: string; from: string; to: string; people: number };
  night: { template: string; from: string; to: string };
  leaderUser: string | null;
}

/**
 * The demo company: 1 director, 1 manager, 2 team leaders, 15 guards; a client with two towers (a leader and
 * five guards each) and a warehouse client renting five guards by the month; a month of clock-ins behind it.
 * Rebuilt from scratch, relative to the moment it is (re)built.
 */
@Injectable()
export class DemoService {
  private readonly logger = new Logger('Demo');

  constructor(
    private readonly ds: DataSource,
    private readonly refs: ModuleRef,
  ) {}

  private svc<T>(type: new (...args: never[]) => T): T {
    return this.refs.get(type, { strict: false });
  }

  async exists(): Promise<boolean> {
    return (await this.ds.query(`SELECT 1 FROM tenants WHERE code = $1`, [DEMO_CODE])).length > 0;
  }

  /** Wipes the demo company and builds it again. Only ever touches the company coded "demo". */
  async reset(): Promise<DemoResult> {
    const runner = this.ds.createQueryRunner();
    await runner.connect();
    try {
      const [{ ok }] = await runner.query(`SELECT pg_try_advisory_lock($1) AS ok`, [LOCK]);
      if (!ok) throw new BusinessException('DEMO_BUSY');
      try {
        await this.purge();
        return await this.build();
      } finally {
        await runner.query(`SELECT pg_advisory_unlock($1)`, [LOCK]);
      }
    } finally {
      await runner.release();
    }
  }

  /** Every row of the demo company, children before parents, then its files on disk. */
  async purge(): Promise<void> {
    const [tenant] = await this.ds.query(`SELECT id FROM tenants WHERE code = $1`, [DEMO_CODE]);
    if (!tenant) return;
    const id: string = tenant.id;
    const paths: string[] = (await this.ds.query(`SELECT path FROM files WHERE tenant_id = $1`, [id])).map((r: { path: string }) => r.path);
    await this.ds.transaction(async (m) => {
      // Lets this transaction, and only it, remove this company's incident timeline (append-only otherwise).
      await m.query(`SELECT set_config('app.purging_tenant', $1, true)`, [id]);
      await m.query(`DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1)`, [id]);
      await m.query(`DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE tenant_id = $1)`, [id]);
      await m.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE tenant_id = $1)`, [id]);
      await m.query(`DELETE FROM route_checkpoints WHERE route_id IN (SELECT id FROM routes WHERE tenant_id = $1)`, [id]);
      let tables: string[] = (await m.query(
        `SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'tenant_id' AND table_name <> 'tenants'`,
      )).map((r: { table_name: string }) => r.table_name);
      // Delete what nothing else points at, again and again, until all is gone.
      while (tables.length) {
        const left: string[] = [];
        for (const table of tables) {
          await m.query(`SAVEPOINT purge`);
          try {
            await m.query(`DELETE FROM "${table}" WHERE tenant_id = $1`, [id]);
            await m.query(`RELEASE SAVEPOINT purge`);
          } catch {
            await m.query(`ROLLBACK TO SAVEPOINT purge`);
            left.push(table);
          }
        }
        if (left.length === tables.length) throw new Error(`Không xoá được dữ liệu demo: ${left.join(', ')}`);
        tables = left;
      }
      await m.query(`DELETE FROM tenants WHERE id = $1`, [id]);
    });
    for (const p of paths) await fs.rm(resolve(uploadDir(), p), { force: true }).catch(() => undefined);
  }

  async build(): Promise<DemoResult> {
    const now = new Date();
    const today = todayLocal(now);
    const rnd = prng(20261015);
    const accounts: DemoAccount[] = [];

    const { tenant, admin_user_id } = await this.svc(TenantsService).createTenant(
      { code: DEMO_CODE, name: 'Công ty Bảo vệ Demo', admin: { full_name: 'Giám đốc Demo', phone: '0900000001', password: DEMO_PASSWORD } },
      null,
    );
    const actor: AuthUser = { id: admin_user_id, tenant_id: tenant.id, user_type: 'staff', employee_id: null, session_id: 'demo' };
    accounts.push({ role: 'Giám đốc', name: 'Giám đốc Demo', phone: '0900000001' });
    const users = this.svc(UsersService);
    const org = this.svc(OrgService);
    const employees = this.svc(EmployeesService);
    const role = async (code: string): Promise<string> =>
      (await this.ds.query(`SELECT id FROM roles WHERE tenant_id = $1 AND code = $2`, [tenant.id, code]))[0].id;
    const since = addDays(today, -90);

    const manager = await users.create(actor, {
      user_type: 'staff', full_name: 'Trần Quản Lý', phone: '0900000002', password: DEMO_PASSWORD, role_ids: [await role('manager')], scopes: [],
    });
    accounts.push({ role: 'Quản lý', name: 'Trần Quản Lý', phone: '0900000002', note: 'quản lý cả 3 đội' });
    await users.create(actor, {
      user_type: 'staff', full_name: 'Phạm Kế Toán', phone: '0900000004', password: DEMO_PASSWORD, role_ids: [await role('accountant')], scopes: [{ scope_type: 'tenant' }],
    });
    accounts.push({ role: 'Kế toán', name: 'Phạm Kế Toán', phone: '0900000004', note: 'bảng lương, đối soát, công nợ' });

    const group = await org.createGroup(actor, { name: 'Nhóm Hà Nội', manager_user_id: manager.id });
    const teamA = await org.createTeam(actor, { name: 'Đội Toà A', team_group_id: group.id });
    const teamB = await org.createTeam(actor, { name: 'Đội Toà B', team_group_id: group.id });
    const teamK = await org.createTeam(actor, { name: 'Đội Kho Long Biên', team_group_id: group.id });

    const people: { id: string; name: string; phone: string; userId: string; team: string; leader: boolean }[] = [];
    const add = async (code: string, name: string, phone: string, team: string, leader: boolean) => {
      const e = await employees.create(actor, { code, full_name: name, phone, position: leader ? 'team_leader' : 'guard', hire_date: addDays(today, -400) });
      await org.addMember(actor, team, { employee_id: e.id, start_date: since });
      const u = await users.create(actor, {
        user_type: 'guard', full_name: name, phone, password: DEMO_PASSWORD, employee_id: e.id,
        role_ids: [await role(leader ? 'team_leader' : 'guard')], scopes: [],
      });
      people.push({ id: e.id, name, phone, userId: u.id, team, leader });
      return e.id;
    };
    const leadA = await add('BV001', 'Nguyễn Văn An', '0910000001', teamA.id, true);
    const leadB = await add('BV002', 'Lê Văn Bảo', '0910000002', teamB.id, true);
    await org.updateTeam(actor, teamA.id, { leader_employee_id: leadA });
    await org.updateTeam(actor, teamB.id, { leader_employee_id: leadB });
    accounts.push({ role: 'Đội trưởng Toà A', name: 'Nguyễn Văn An', phone: '0910000001' });
    accounts.push({ role: 'Đội trưởng Toà B', name: 'Lê Văn Bảo', phone: '0910000002' });
    for (const [i, name] of GUARD_NAMES.entries()) {
      const n = i + 3;
      const team = i < 5 ? teamA.id : i < 10 ? teamB.id : teamK.id;
      const phone = `09100000${String(n).padStart(2, '0')}`;
      await add(`BV${String(n).padStart(3, '0')}`, name, phone, team, false);
      accounts.push({ role: `Bảo vệ ${i < 5 ? 'Toà A' : i < 10 ? 'Toà B' : 'Kho Long Biên'}`, name, phone });
    }
    const of = (team: string) => people.filter((p) => p.team === team).map((p) => p.id);

    // Clients and contracts.
    const clients = this.svc(ClientsService);
    const contracts = this.svc(ContractsService);
    const deployments = this.svc(DeploymentsService);
    const pearl = await clients.create(actor, { code: 'MDP', name: 'Khu đô thị Mỹ Đình Pearl', contact_name: 'Chị Lan — BQL', contact_phone: '0912000111' });
    const kho = await clients.create(actor, { code: 'KLB', name: 'Kho Long Biên Logistics', contact_name: 'Anh Tâm — Thủ kho', contact_phone: '0912000222' });
    const k1 = await contracts.create(actor, {
      client_id: pearl.id, contract_no: 'HD-2026-001', start_date: addDays(today, -200), end_date: addDays(today, 165),
      lines: [
        { position: 'team_leader', headcount: 2, unit: 'per_guard_month', unit_price: 10_000_000 },
        { position: 'guard', headcount: 10, unit: 'per_guard_month', unit_price: 8_500_000 },
      ],
    });
    await contracts.update(actor, k1.id, { state: 'signed' });
    const k2 = await contracts.create(actor, {
      client_id: kho.id, contract_no: 'HD-2026-002', start_date: addDays(today, -120), end_date: addDays(today, 25),
      lines: [{ position: 'guard', headcount: 5, unit: 'per_guard_month', unit_price: 8_000_000 }],
      note: 'Thuê 5 bảo vệ, thanh toán theo tháng',
    });
    await contracts.update(actor, k2.id, { state: 'signed' });
    for (const p of people) {
      const toKho = p.team === teamK.id;
      await deployments.create(actor, { employee_id: p.id, client_id: toKho ? kho.id : pearl.id, contract_id: toKho ? k2.id : k1.id, start_date: since });
    }

    // Sites, checkpoints, routes, patrol schedules, shift templates.
    const sites = this.svc(SitesService);
    const checkpoints = this.svc(CheckpointsService);
    const routes = this.svc(RoutesService);
    const schedules = this.svc(SchedulesService);
    const templates = this.svc(TemplatesService);
    const handovers = this.svc(HandoversService);
    const makeSite = async (s: { client: string; code: string; name: string; address: string; lat: number; lng: number; team: string; points: [string, string][]; dayFrom: string; dayTo: string; dayPeople: number }) => {
      const site = await sites.create(actor, {
        client_id: s.client, code: s.code, name: s.name, address: s.address, lat: s.lat, lng: s.lng, geofence_radius_m: 150, responsible_team_id: s.team,
      });
      await sites.addPost(actor, site.id, { name: 'Chốt cổng chính' });
      const made: { id: string }[] = [];
      for (const [i, [code, name]] of s.points.entries()) {
        made.push(await checkpoints.create(actor, site.id, {
          code, name, lat: s.lat + (i - 2) * 0.0003, lng: s.lng + ((i % 2) - 0.5) * 0.0004, radius_m: 40,
          photo_rule: i === s.points.length - 1 ? 'always' : i === 1 ? 'random' : 'never',
        }));
      }
      const route = await routes.create(actor, site.id, { name: 'Vòng tuần tra chính', checkpoints: made.map((c) => ({ checkpoint_id: c.id })) });
      await schedules.create(actor, site.id, { route_id: route.id, name: 'Tuần tra ngày', start_time: s.dayFrom, end_time: s.dayTo, interval_minutes: 180 });
      await schedules.create(actor, site.id, { route_id: route.id, name: 'Tuần tra đêm', start_time: s.dayTo, end_time: s.dayFrom, interval_minutes: 120 });
      const day = await templates.create(actor, site.id, { name: 'Ca ngày', start_time: s.dayFrom, end_time: s.dayTo, headcount: s.dayPeople });
      const night = await templates.create(actor, site.id, { name: 'Ca đêm', start_time: s.dayTo, end_time: s.dayFrom, headcount: 1 });
      await handovers.setItems(actor, site.id, { items: ['Chìa khoá kho (3 chiếc)', 'Bộ đàm (2 cái)', 'Sổ khách', 'Camera hoạt động bình thường', 'Cửa cuốn đã khoá'] });
      return { site, day: day.id, night: night.id };
    };
    const tower = (letter: string): [string, string][] => [
      ['P01', `Sảnh lễ tân Toà ${letter}`], ['P02', 'Cầu thang bộ tầng 1'], ['P03', 'Lối thoát hiểm hầm B1'], ['P04', 'Phòng kỹ thuật'], ['P05', 'Sân sau toà nhà'],
    ];
    const a = await makeSite({ client: pearl.id, code: 'MDP-A', name: 'Toà A — Mỹ Đình Pearl', address: 'Mỹ Đình, Nam Từ Liêm, Hà Nội', lat: 21.028511, lng: 105.776742, team: teamA.id, points: tower('A'), dayFrom: '06:00', dayTo: '18:00', dayPeople: 2 });
    const b = await makeSite({ client: pearl.id, code: 'MDP-B', name: 'Toà B — Mỹ Đình Pearl', address: 'Mỹ Đình, Nam Từ Liêm, Hà Nội', lat: 21.029432, lng: 105.778105, team: teamB.id, points: tower('B'), dayFrom: '06:00', dayTo: '18:00', dayPeople: 2 });
    const k = await makeSite({
      client: kho.id, code: 'KLB-1', name: 'Kho hàng Long Biên', address: 'Phúc Đồng, Long Biên, Hà Nội', lat: 21.040512, lng: 105.902614, team: teamK.id,
      points: [['K01', 'Cổng xuất hàng'], ['K02', 'Dãy kho số 1'], ['K03', 'Dãy kho số 2'], ['K04', 'Bãi container'], ['K05', 'Hàng rào phía sông']],
      dayFrom: '07:00', dayTo: '19:00', dayPeople: 1,
    });

    // Who to call at each site, from the office-only manager down to the desk guards may ring at night.
    const contacts = this.svc(SiteContactsService);
    for (const [site, letter] of [[a.site.id, 'A'], [b.site.id, 'B']] as const) {
      await contacts.create(actor, site, { full_name: 'Chị Lan', title: 'Trưởng BQL toà nhà', phone: '0912000111', zalo: '0912000111', hours: 'Giờ hành chính', priority: 1, visibility: 'staff' });
      await contacts.create(actor, site, { full_name: 'Anh Dũng', title: `Kỹ thuật trực Toà ${letter}`, phone: `091200033${letter === 'A' ? 1 : 2}`, hours: '24/7', priority: 2, visibility: 'leader', note: 'Điện, nước, thang máy' });
      await contacts.create(actor, site, { full_name: `Lễ tân Toà ${letter}`, title: 'Quầy lễ tân', phone: `02437000${letter === 'A' ? 111 : 222}`, hours: '24/7', priority: 3, visibility: 'guard' });
    }
    await contacts.create(actor, k.site.id, { full_name: 'Anh Tâm', title: 'Thủ kho', phone: '0912000222', zalo: '0912000222', hours: '07:00–19:00', priority: 1, visibility: 'leader' });
    await contacts.create(actor, k.site.id, { full_name: 'Phòng điều độ', title: 'Điều độ xe', phone: '0912000444', hours: '24/7', priority: 2, visibility: 'guard' });

    const plans: SitePlan[] = [
      { id: a.site.id, name: a.site.name, lat: 21.028511, lng: 105.776742, team: of(teamA.id), day: { template: a.day, from: '06:00', to: '18:00', people: 2 }, night: { template: a.night, from: '18:00', to: '06:00' }, leaderUser: people[0].userId },
      { id: b.site.id, name: b.site.name, lat: 21.029432, lng: 105.778105, team: of(teamB.id), day: { template: b.day, from: '06:00', to: '18:00', people: 2 }, night: { template: b.night, from: '18:00', to: '06:00' }, leaderUser: people[1].userId },
      { id: k.site.id, name: k.site.name, lat: 21.040512, lng: 105.902614, team: of(teamK.id), day: { template: k.day, from: '07:00', to: '19:00', people: 1 }, night: { template: k.night, from: '19:00', to: '07:00' }, leaderUser: null },
    ];

    // A month behind and a week ahead of shifts, with what happened on each one already over.
    const figures = await this.ds.transaction((m) => this.month(m, tenant.id, admin_user_id, manager.id, plans, today, now, rnd));

    // The latest shift over at Toà A worked by a guard: their phone died, nothing was clocked (the engine marks
    // the absence), and their request to add it waits for the leader.
    const [missed] = await this.ds.query(
      `SELECT a.id, a.employee_id, a.planned_start, a.planned_end FROM shift_assignments a JOIN employees e ON e.id = a.employee_id
        WHERE a.tenant_id = $1 AND a.site_id = $2 AND a.status = 'planned' AND a.planned_end < $3 AND a.planned_end > $3::timestamptz - interval '40 hours'
          AND a.employee_id <> $4 ORDER BY a.planned_end DESC LIMIT 1`,
      [tenant.id, a.site.id, now, leadA],
    );
    if (missed) {
      await this.ds.query(`DELETE FROM violations WHERE ref_type = 'assignment' AND ref_id = $1`, [missed.id]);
      await this.ds.query(`DELETE FROM attendances WHERE assignment_id = $1`, [missed.id]);
    }

    await this.svc(RoundsScheduler).generate(now);
    await this.svc(ViolationsEngine).tick(now);

    // Things waiting for someone on the day of the demo.
    const incidents = this.svc(IncidentsService);
    const [cat] = await this.ds.query(`SELECT id FROM incident_categories WHERE tenant_id = $1 AND name = 'Hư hỏng thiết bị'`, [tenant.id]);
    await incidents.report(actor, {
      site_id: a.site.id, category_id: cat.id, source: 'staff', client_channel: 'phone', client_reporter_name: 'Chị Lan — BQL toà nhà',
      description: 'Đèn lối thoát hiểm tầng hầm B1 không sáng',
    });
    const logbook = this.svc(LogbookService);
    const stamp = () => new Date().toISOString();
    await logbook.write(actor, a.site.id, { client_uuid: randomUUID(), device_time: stamp(), type: 'note', body: 'BQL báo cắt nước 14h–16h để bảo trì bể ngầm' });
    await logbook.write(actor, a.site.id, { client_uuid: randomUUID(), device_time: stamp(), type: 'visitor', visitor_name: 'Anh Hùng', visitor_org: 'Điện lực Nam Từ Liêm', meet_whom: 'BQL toà nhà', purpose: 'Kiểm tra công tơ' });
    await logbook.write(actor, k.site.id, { client_uuid: randomUUID(), device_time: stamp(), type: 'vehicle', plate: '29C-456.78', vehicle_kind: 'Xe tải 5 tấn', cargo: 'Hàng điện máy nhập kho' });

    const asUser = (p: { userId: string; id: string }): AuthUser => ({ id: p.userId, tenant_id: tenant.id, user_type: 'guard', employee_id: p.id, session_id: 'demo' });
    const guardA = people.find((p) => p.team === teamA.id && !p.leader)!;
    const guardB = people.filter((p) => p.team === teamB.id && !p.leader)[1];
    const leave = this.svc(LeaveService);
    await leave.create(asUser(guardA), { client_uuid: randomUUID(), type: 'personal', from_date: addDays(today, 3), to_date: addDays(today, 3), reason: 'Về quê dự đám cưới em trai' });
    const approved = await leave.create(asUser(guardB), { client_uuid: randomUUID(), type: 'sick', from_date: addDays(today, 5), to_date: addDays(today, 6), reason: 'Mổ ruột thừa, bác sĩ cho nghỉ 2 ngày' });
    await leave.approve(asUser(people[1]), approved.id, 'Đã sắp xếp người trực thay');

    if (missed) {
      const who = people.find((p) => p.id === missed.employee_id)!;
      await this.svc(CorrectionsService).create(asUser(who), {
        client_uuid: randomUUID(), assignment_id: missed.id, reason_code: 'phone_dead', reason: 'Máy hết pin lúc vào ca, có trực đủ ca và ghi sổ giấy',
        check_in_at: new Date(new Date(missed.planned_start).getTime() + 4 * 60_000).toISOString(), check_out_at: new Date(missed.planned_end).toISOString(),
      });
    }

    const pay = this.svc(PayService);
    for (const p of people) {
      await pay.set(actor, p.id, {
        pay_type: 'monthly', monthly_mode: p.leader ? 'fixed' : 'attendance', base_pay: p.leader ? 9_500_000 : p.team === teamK.id ? 7_000_000 : 7_500_000, allowance: p.leader ? 1_000_000 : 500_000,
        bank_name: 'Vietcombank', bank_account: `0011000${p.phone.slice(-6)}`, annual_leave_days: p.leader ? 12 : null, social_insurance: 450_000,
      });
    }
    await this.svc(FinanceSettingsService).update(actor, { penalties: { late_check_in: 50_000, absent: 200_000, early_check_out: 50_000, missed_round: 100_000 } });

    // A labour contract for everyone, one of them running out soon, and last month's payroll locked and paid:
    // without them a guard's own pages on the web open empty and nobody can judge them.
    for (const [i, p] of people.entries()) {
      const issued = addDays(today, -400);
      await employees.addDocument(actor, p.id, {
        kind: 'labor_contract', number: `HĐLĐ-${issued.slice(0, 4)}/${String(i + 1).padStart(3, '0')}`, issued_on: issued,
        expires_on: i === 2 ? addDays(today, 18) : addDays(issued, 1095), note: 'Hợp đồng lao động xác định thời hạn 36 tháng',
      });
    }
    const payroll = this.svc(PayrollService);
    const lastMonth = addDays(`${today.slice(0, 7)}-01`, -1).slice(0, 7);
    const period = await payroll.create(actor, lastMonth);
    await payroll.lock(actor, period.id);
    await payroll.paid(actor, period.id, `${today.slice(0, 7)}-05` <= today ? `${today.slice(0, 7)}-05` : today);

    // Every demo account shares one published password, so the forced change on first login — right when an admin
    // picked a real person's password — would let the first visitor lock everyone else out of that account.
    // Scoped to this company: no other tenant's accounts are touched.
    await this.ds.query(`UPDATE users SET must_change_password = false WHERE tenant_id = $1`, [tenant.id]);

    this.logger.log(`Đã dựng công ty demo: ${figures.shifts} ca, ${figures.attendances} lần chấm công, ${figures.violations} vi phạm`);
    return { company: 'Công ty Bảo vệ Demo', password: DEMO_PASSWORD, built_at: now.toISOString(), accounts, figures };
  }

  /**
   * Shifts from 30 days back to 6 days ahead, rostered in rotation; for each one already over (or begun):
   * mostly on time, some late, a few absent, a few leaving early — and the violations a manager would have
   * decided by now (older than a week: decided; the last week: still waiting).
   */
  private async month(
    m: EntityManager, tenantId: string, adminId: string, managerId: string, plans: SitePlan[], today: string, now: Date, rnd: () => number,
  ) {
    let shifts = 0;
    let attendances = 0;
    let violations = 0;
    for (const plan of plans) {
      const n = plan.team.length;
      for (let d = -30; d <= 6; d += 1) {
        const date = addDays(today, d);
        const k = ((d % n) + n) % n;
        const dayPeople = plan.day.people === 2 ? [plan.team[k], plan.team[(k + 1) % n]] : [plan.team[k]];
        const nightPerson = plan.team[(k + (plan.day.people === 2 ? 3 : 2)) % n];
        const entries: { employee: string; template: string; start: Date; end: Date }[] = [
          ...dayPeople.map((employee) => ({ employee, template: plan.day.template, start: at(date, plan.day.from), end: at(date, plan.day.to) })),
          { employee: nightPerson, template: plan.night.template, start: at(date, plan.night.from), end: at(addDays(date, 1), plan.night.to) },
        ];
        for (const e of entries) {
          const [row] = await m.query(
            `INSERT INTO shift_assignments (tenant_id, site_id, employee_id, template_id, shift_date, planned_start, planned_end, status, created_by, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'planned', $8, $6::timestamptz - interval '5 days', $6::timestamptz - interval '5 days') RETURNING id`,
            [tenantId, plan.id, e.employee, e.template, date, e.start, e.end, adminId],
          );
          shifts += 1;
          if (e.start.getTime() > now.getTime()) continue;
          const roll = rnd();
          const ended = e.end.getTime() <= now.getTime();
          const outcome = roll < 0.03 ? 'absent' : roll < 0.1 ? 'late' : roll < 0.14 ? 'early' : 'ok';
          // While the shift runs, an absence shows live on the board (the engine marks it).
          if (outcome === 'absent') {
            if (ended) {
              violations += await this.violation(m, tenantId, plan, e.employee, row.id, 'absent', e.start, null, now, managerId, rnd);
            }
            continue;
          }
          const inAt = new Date(e.start.getTime() + (outcome === 'late' ? (12 + Math.floor(rnd() * 34)) * 60_000 : -(1 + Math.floor(rnd() * 15)) * 60_000));
          if (inAt.getTime() > now.getTime()) continue;
          const outAt = !ended ? null : new Date(e.end.getTime() + (outcome === 'early' ? -(15 + Math.floor(rnd() * 36)) * 60_000 : Math.floor(rnd() * 9) * 60_000));
          const jitter = () => (rnd() - 0.5) * 0.0006;
          const late = Math.max(0, Math.floor((inAt.getTime() - e.start.getTime()) / 60_000));
          const early = outAt ? Math.max(0, Math.ceil((e.end.getTime() - outAt.getTime()) / 60_000)) : null;
          await m.query(
            `INSERT INTO attendances (tenant_id, assignment_id, employee_id, check_in_at, check_in_lat, check_in_lng, check_in_accuracy_m, check_in_distance_m,
                                      check_in_device_time, late_minutes, check_out_at, check_out_lat, check_out_lng, check_out_accuracy_m, check_out_distance_m,
                                      check_out_device_time, early_minutes, worked_minutes, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, 8, $7, $4, $8, $9, $10, $11, $12, $13, $9, $14, $15, $4, $4)`,
            [
              tenantId, row.id, e.employee, inAt, plan.lat + jitter(), plan.lng + jitter(), 5 + Math.floor(rnd() * 40), late,
              outAt, outAt ? plan.lat + jitter() : null, outAt ? plan.lng + jitter() : null, outAt ? 9 : null, outAt ? 5 + Math.floor(rnd() * 40) : null,
              early, outAt ? Math.floor((outAt.getTime() - inAt.getTime()) / 60_000) : null,
            ],
          );
          attendances += 1;
          if (late > 10) violations += await this.violation(m, tenantId, plan, e.employee, row.id, 'late_check_in', inAt, late, now, managerId, rnd);
          if (early !== null && early > 10) violations += await this.violation(m, tenantId, plan, e.employee, row.id, 'early_check_out', outAt!, early, now, managerId, rnd);
        }
      }
    }
    return { shifts, attendances, violations };
  }

  private async violation(
    m: EntityManager, tenantId: string, plan: SitePlan, employee: string, assignment: string, type: string, when: Date, minutes: number | null,
    now: Date, managerId: string, rnd: () => number,
  ): Promise<number> {
    const old = now.getTime() - when.getTime() > 7 * 24 * HOUR;
    const waived = rnd() < 0.25;
    const status = old ? (waived ? 'waived' : 'confirmed') : plan.leaderUser && rnd() < 0.5 ? 'proposed_confirm' : 'auto';
    const proposer = (old || status === 'proposed_confirm') && plan.leaderUser ? plan.leaderUser : null;
    await m.query(
      `INSERT INTO violations (tenant_id, employee_id, site_id, type, ref_type, ref_id, occurred_at, minutes, status,
                               proposed_by, proposed_note, proposed_at, reviewed_by, review_note, reviewed_at)
       VALUES ($1, $2, $3, $4, 'assignment', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT ON CONSTRAINT violations_once DO NOTHING`,
      [
        tenantId, employee, plan.id, type, assignment, when, minutes, status,
        proposer, proposer ? (waived && old ? 'Có báo trước, lý do chính đáng' : 'Xác nhận') : null, proposer ? new Date(when.getTime() + 20 * HOUR) : null,
        old ? managerId : null, old ? (waived ? 'Miễn: có lý do chính đáng' : null) : null, old ? new Date(when.getTime() + 30 * HOUR) : null,
      ],
    );
    return 1;
  }
}
