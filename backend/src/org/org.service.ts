import { Injectable } from '@nestjs/common';
import { DataSource, DeepPartial, EntityManager } from 'typeorm';
import { ScopeService } from '../access/scope.service';
import { AuditService } from '../audit/audit.service';
import { AuthUser, tenantOf } from '../auth/auth-user';
import { addDays, todayLocal } from '../common/date';
import { BusinessException } from '../common/errors/business.exception';
import { TenantRepository } from '../common/tenant-repository';
import { AddMemberDto, CreateGroupDto, CreateTeamDto, LeaveTeamDto, UpdateGroupDto, UpdateTeamDto } from './dto';
import { TeamGroup } from './team-group.entity';
import { TeamMember } from './team-member.entity';
import { Team } from './team.entity';

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

export interface MemberRow {
  id: string;
  employee_id: string;
  code: string;
  full_name: string;
  phone: string | null;
  start_date: string;
  is_leader: boolean;
}

interface Stay {
  id: string;
  team_id: string;
  start_date: string;
  end_date: string | null;
}

@Injectable()
export class OrgService {
  constructor(
    private readonly ds: DataSource,
    private readonly scopes: ScopeService,
    private readonly audit: AuditService,
  ) {}

  async teams(actor: AuthUser): Promise<TeamRow[]> {
    const tenantId = tenantOf(actor);
    const visibility = await this.scopes.teamVisibility(actor);
    if (!visibility.all && !visibility.teamIds.length) return [];
    const params: unknown[] = [tenantId, todayLocal()];
    let filter = '';
    if (!visibility.all) {
      params.push(visibility.teamIds);
      filter = 'AND t.id = ANY($3::uuid[])';
    }
    return this.ds.query(
      `SELECT t.id, t.name, t.team_group_id, t.leader_employee_id, le.full_name AS leader_name,
              (SELECT count(*)::int FROM team_members tm
                WHERE tm.team_id = t.id AND tm.start_date <= $2 AND (tm.end_date IS NULL OR tm.end_date >= $2)) AS member_count
         FROM teams t
         LEFT JOIN employees le ON le.id = t.leader_employee_id
        WHERE t.tenant_id = $1 AND t.deleted_at IS NULL ${filter}
        ORDER BY t.name`,
      params,
    );
  }

  /** Groups with their teams, then the teams that belong to no group. */
  async chart(actor: AuthUser): Promise<ChartNode[]> {
    const tenantId = tenantOf(actor);
    const [teams, visibility] = await Promise.all([this.teams(actor), this.scopes.teamVisibility(actor)]);
    const groups: GroupRow[] = await this.ds.query(
      `SELECT g.id, g.name, g.manager_user_id, u.full_name AS manager_name
         FROM team_groups g LEFT JOIN users u ON u.id = g.manager_user_id
        WHERE g.tenant_id = $1 AND g.deleted_at IS NULL
        ORDER BY g.name`,
      [tenantId],
    );
    const nodes: ChartNode[] = groups
      .map((group) => ({ group, teams: teams.filter((t) => t.team_group_id === group.id) }))
      .filter((node) => visibility.all || node.teams.length > 0);
    const ungrouped = teams.filter((t) => !t.team_group_id);
    if (ungrouped.length) nodes.push({ group: null, teams: ungrouped });
    return nodes;
  }

  async members(actor: AuthUser, teamId: string): Promise<MemberRow[]> {
    const tenantId = tenantOf(actor);
    await this.teamRepo().get(tenantId, teamId);
    if (!(await this.scopes.canSeeTeam(actor, teamId))) throw new BusinessException('NOT_FOUND');
    return this.ds.query(
      `SELECT tm.id, tm.employee_id, e.code, e.full_name, e.phone, tm.start_date,
              COALESCE(t.leader_employee_id = e.id, false) AS is_leader
         FROM team_members tm
         JOIN employees e ON e.id = tm.employee_id
         JOIN teams t ON t.id = tm.team_id
        WHERE tm.team_id = $1 AND tm.start_date <= $2 AND (tm.end_date IS NULL OR tm.end_date >= $2)
        ORDER BY is_leader DESC, e.full_name`,
      [teamId, todayLocal()],
    );
  }

  async createGroup(actor: AuthUser, dto: CreateGroupDto): Promise<TeamGroup> {
    const tenantId = await this.writer(actor);
    if (dto.manager_user_id) await this.assertStaffUser(tenantId, dto.manager_user_id);
    const group = await this.groupRepo().create(tenantId, { name: dto.name, manager_user_id: dto.manager_user_id ?? null });
    await this.log(actor, 'org.group.create', 'team_group', group.id, { ...dto });
    return group;
  }

  async updateGroup(actor: AuthUser, id: string, dto: UpdateGroupDto): Promise<TeamGroup> {
    const tenantId = await this.writer(actor);
    await this.groupRepo().get(tenantId, id);
    if (dto.manager_user_id) await this.assertStaffUser(tenantId, dto.manager_user_id);
    const patch: DeepPartial<TeamGroup> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.manager_user_id !== undefined) patch.manager_user_id = dto.manager_user_id;
    const group = await this.groupRepo().update(tenantId, id, patch);
    await this.log(actor, 'org.group.update', 'team_group', id, { ...dto });
    return group;
  }

  async deleteGroup(actor: AuthUser, id: string): Promise<{ ok: true }> {
    const tenantId = await this.writer(actor);
    await this.groupRepo().get(tenantId, id);
    const used = await this.ds.query(`SELECT 1 FROM teams WHERE team_group_id = $1 AND deleted_at IS NULL LIMIT 1`, [id]);
    if (used.length) throw new BusinessException('ORG_GROUP_NOT_EMPTY');
    await this.groupRepo().softDelete(tenantId, id);
    await this.log(actor, 'org.group.delete', 'team_group', id, {});
    return { ok: true };
  }

  async createTeam(actor: AuthUser, dto: CreateTeamDto): Promise<Team> {
    const tenantId = await this.writer(actor);
    if (dto.team_group_id) await this.groupRepo().get(tenantId, dto.team_group_id);
    const team = await this.teamRepo().create(tenantId, { name: dto.name, team_group_id: dto.team_group_id ?? null });
    await this.log(actor, 'org.team.create', 'team', team.id, { ...dto });
    return team;
  }

  async updateTeam(actor: AuthUser, id: string, dto: UpdateTeamDto): Promise<Team> {
    const tenantId = await this.writer(actor);
    await this.teamRepo().get(tenantId, id);
    if (dto.team_group_id) await this.groupRepo().get(tenantId, dto.team_group_id);
    if (dto.leader_employee_id) {
      const stay = await this.stayOn(this.ds.manager, dto.leader_employee_id, todayLocal());
      if (!stay || stay.team_id !== id) throw new BusinessException('ORG_LEADER_NOT_MEMBER');
    }
    const patch: DeepPartial<Team> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.team_group_id !== undefined) patch.team_group_id = dto.team_group_id;
    if (dto.leader_employee_id !== undefined) patch.leader_employee_id = dto.leader_employee_id;
    const team = await this.teamRepo().update(tenantId, id, patch);
    await this.log(actor, 'org.team.update', 'team', id, { ...dto });
    return team;
  }

  async deleteTeam(actor: AuthUser, id: string): Promise<{ ok: true }> {
    const tenantId = await this.writer(actor);
    await this.teamRepo().get(tenantId, id);
    const used = await this.ds.query(
      `SELECT 1 FROM team_members WHERE team_id = $1 AND (end_date IS NULL OR end_date >= $2) LIMIT 1`,
      [id, todayLocal()],
    );
    if (used.length) throw new BusinessException('ORG_TEAM_NOT_EMPTY');
    await this.teamRepo().softDelete(tenantId, id);
    await this.log(actor, 'org.team.delete', 'team', id, {});
    return { ok: true };
  }

  /**
   * Puts an employee in a team from `start_date`. Their current stay elsewhere
   * ends the day before; a stay that began that same day is corrected in place.
   * History after `start_date` is never rewritten.
   */
  async addMember(actor: AuthUser, teamId: string, dto: AddMemberDto) {
    const { tenantId, sees, all } = await this.staffer(actor, teamId);
    const today = todayLocal();
    const startDate = dto.start_date ?? today;
    if (startDate > today) throw new BusinessException('ORG_DATE_IN_FUTURE');

    return this.ds.transaction(async (m) => {
      await this.teamRepo(m).get(tenantId, teamId);
      const employee = await this.lockEmployee(m, tenantId, dto.employee_id);
      if (employee.status !== 'active') throw new BusinessException('EMPLOYEE_INACTIVE');

      const later = await m.query(`SELECT 1 FROM team_members WHERE employee_id = $1 AND start_date > $2 LIMIT 1`, [
        employee.id,
        startDate,
      ]);
      if (later.length) throw new BusinessException('ORG_MEMBERSHIP_CONFLICT');

      const current = await this.stayOn(m, employee.id, startDate);
      const now = startDate === today ? current : await this.stayOn(m, employee.id, today);
      // Moving someone needs sight of the team they are in today as well as the one they join;
      // placing someone who is in no team today needs company-wide scope.
      if (now && !sees(now.team_id)) throw new BusinessException('NOT_FOUND');
      if (!now && !all) throw new BusinessException('AUTH_FORBIDDEN');
      // A stay covering start_date that has since ended is recorded history: a backdated join would overwrite it.
      if (current && current.id !== now?.id) throw new BusinessException('ORG_MEMBERSHIP_CONFLICT');
      if (current?.team_id === teamId) {
        return { id: current.id, team_id: teamId, employee_id: employee.id, start_date: current.start_date };
      }

      let stayId: string;
      if (current && current.start_date === startDate) {
        await m.query(`UPDATE team_members SET team_id = $2, updated_at = now() WHERE id = $1`, [current.id, teamId]);
        stayId = current.id;
      } else {
        if (current) {
          await m.query(`UPDATE team_members SET end_date = $2, updated_at = now() WHERE id = $1`, [
            current.id,
            addDays(startDate, -1),
          ]);
        }
        const row = await m.save(
          m.create(TeamMember, { tenant_id: tenantId, team_id: teamId, employee_id: employee.id, start_date: startDate, end_date: null }),
        );
        stayId = row.id;
      }
      // A leader who moves away stops leading the team they left.
      if (current) await this.dropLeader(m, current.team_id, employee.id);

      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'org.member.add', entity_type: 'team', entity_id: teamId,
        data: { employee_id: employee.id, start_date: startDate, from_team_id: current?.team_id ?? null },
      });
      return { id: stayId, team_id: teamId, employee_id: employee.id, start_date: startDate };
    });
  }

  /** Ends a stay so that `left_on` is the first day out. A stay that would end before it began is removed. */
  async leave(actor: AuthUser, teamId: string, employeeId: string, dto: LeaveTeamDto): Promise<{ ok: true }> {
    const { tenantId } = await this.staffer(actor, teamId);
    const today = todayLocal();
    const leftOn = dto.left_on ?? today;
    if (leftOn > today) throw new BusinessException('ORG_DATE_IN_FUTURE');

    return this.ds.transaction(async (m) => {
      await this.teamRepo(m).get(tenantId, teamId);
      await this.lockEmployee(m, tenantId, employeeId);
      const [stay]: { id: string; start_date: string }[] = await m.query(
        `SELECT id, start_date FROM team_members
          WHERE team_id = $1 AND employee_id = $2 AND start_date <= $3
            AND (end_date IS NULL OR end_date >= $4)`,
        [teamId, employeeId, leftOn, today],
      );
      if (!stay) throw new BusinessException('NOT_FOUND');

      const endDate = addDays(leftOn, -1);
      if (endDate < stay.start_date) await m.query(`DELETE FROM team_members WHERE id = $1`, [stay.id]);
      else await m.query(`UPDATE team_members SET end_date = $2, updated_at = now() WHERE id = $1`, [stay.id, endDate]);
      await this.dropLeader(m, teamId, employeeId);

      await this.audit.record(m, {
        tenant_id: tenantId, actor_user_id: actor.id, action: 'org.member.leave', entity_type: 'team', entity_id: teamId,
        data: { employee_id: employeeId, left_on: leftOn },
      });
      return { ok: true as const };
    });
  }

  /** Names (or clears, with null) the leader of a team the caller staffs. */
  async setLeader(actor: AuthUser, teamId: string, employeeId: string | null): Promise<Team> {
    const { tenantId } = await this.staffer(actor, teamId);
    await this.teamRepo().get(tenantId, teamId);
    if (employeeId) {
      const stay = await this.stayOn(this.ds.manager, employeeId, todayLocal());
      if (!stay || stay.team_id !== teamId) throw new BusinessException('ORG_LEADER_NOT_MEMBER');
    }
    const team = await this.teamRepo().update(tenantId, teamId, { leader_employee_id: employeeId });
    await this.log(actor, 'org.team.leader', 'team', teamId, { leader_employee_id: employeeId });
    return team;
  }

  /**
   * Staffing (org.member.manage, checked by the guard) works team by team: a
   * group's manager moves people among the group's teams; only company-wide
   * scope places someone who belongs to no team yet.
   */
  private async staffer(actor: AuthUser, teamId: string) {
    const tenantId = tenantOf(actor);
    const visibility = await this.scopes.teamVisibility(actor);
    const sees = (id: string) => visibility.all || visibility.teamIds.includes(id);
    if (!sees(teamId)) throw new BusinessException('NOT_FOUND');
    return { tenantId, sees, all: visibility.all };
  }

  /** Organisation changes need org.manage (checked by the guard) and company-wide scope. */
  private async writer(actor: AuthUser): Promise<string> {
    const tenantId = tenantOf(actor);
    await this.scopes.assertTenantScope(actor);
    return tenantId;
  }

  private async stayOn(m: EntityManager, employeeId: string, date: string): Promise<Stay | null> {
    const [stay]: Stay[] = await m.query(
      `SELECT id, team_id, start_date, end_date FROM team_members
        WHERE employee_id = $1 AND start_date <= $2 AND (end_date IS NULL OR end_date >= $2)`,
      [employeeId, date],
    );
    return stay ?? null;
  }

  /** Row lock on the employee: two simultaneous transfers of one person queue up instead of racing. */
  private async lockEmployee(m: EntityManager, tenantId: string, employeeId: string): Promise<{ id: string; status: string }> {
    const [employee]: { id: string; status: string }[] = await m.query(
      `SELECT id, status FROM employees WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [employeeId, tenantId],
    );
    if (!employee) throw new BusinessException('NOT_FOUND');
    return employee;
  }

  private async dropLeader(m: EntityManager, teamId: string, employeeId: string): Promise<void> {
    await m.query(`UPDATE teams SET leader_employee_id = NULL, updated_at = now() WHERE id = $1 AND leader_employee_id = $2`, [
      teamId,
      employeeId,
    ]);
  }

  private async assertStaffUser(tenantId: string, userId: string): Promise<void> {
    const rows = await this.ds.query(
      `SELECT 1 FROM users WHERE id = $1 AND tenant_id = $2 AND user_type = 'staff' AND status = 'active' AND deleted_at IS NULL`,
      [userId, tenantId],
    );
    if (!rows.length) throw new BusinessException('NOT_FOUND');
  }

  private log(actor: AuthUser, action: string, entityType: string, entityId: string, data: Record<string, unknown>) {
    return this.audit.record(null, {
      tenant_id: actor.tenant_id, actor_user_id: actor.id, action, entity_type: entityType, entity_id: entityId, data,
    });
  }

  private groupRepo(m: EntityManager = this.ds.manager) {
    return new TenantRepository(m.getRepository(TeamGroup));
  }

  private teamRepo(m: EntityManager = this.ds.manager) {
    return new TenantRepository(m.getRepository(Team));
  }
}
