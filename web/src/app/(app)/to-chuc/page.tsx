'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ChartNode, Employee, Member, TeamRow, UserRow } from '@/lib/types';

export default function OrgPage() {
  const { can } = useAuth();
  const manage = can('org.manage');
  // Managers staff the teams they oversee; creating or removing teams stays with HR and the director.
  const staffing = can('org.member.manage');
  const [chart, setChart] = useState<ChartNode[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [staff, setStaff] = useState<UserRow[]>([]);
  const [selected, setSelected] = useState<TeamRow | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [groupName, setGroupName] = useState('');
  const [teamName, setTeamName] = useState('');
  const [teamGroup, setTeamGroup] = useState('');
  const [joinEmployee, setJoinEmployee] = useState('');
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  const load = useCallback(async () => {
    const nextChart = await api<ChartNode[]>('/org/chart');
    setChart(nextChart);
    if (can('employee.view')) setEmployees(await api<Employee[]>('/employees'));
    if (manage && can('user.view')) setStaff((await api<UserRow[]>('/users')).filter((u) => u.user_type === 'staff'));
    return nextChart;
  }, [can, manage]);

  const openTeam = useCallback(async (team: TeamRow) => {
    setSelected(team);
    setMembers(await api<Member[]>(`/org/teams/${team.id}/members`));
  }, []);

  /** Reload everything, keeping the open team open with fresh numbers. */
  const refresh = useCallback(async () => {
    const nextChart = await load();
    if (selected) {
      const fresh = nextChart.flatMap((n) => n.teams).find((t) => t.id === selected.id);
      if (fresh) await openTeam(fresh);
      else setSelected(null);
    }
  }, [load, openTeam, selected]);

  useEffect(() => {
    void run(load);
  }, [load, run]);

  const groups = chart.flatMap((n) => (n.group ? [n.group] : []));
  const available = employees.filter((e) => e.status === 'active' && e.team?.id !== selected?.id);

  async function createGroup(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api('/org/groups', { method: 'POST', json: { name: groupName } });
      setGroupName('');
      await refresh();
    });
  }

  async function createTeam(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api('/org/teams', { method: 'POST', json: { name: teamName, ...(teamGroup ? { team_group_id: teamGroup } : {}) } });
      setTeamName('');
      await refresh();
    });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Tổ chức</h1>
      <ErrorText error={error} />

      {manage && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Thêm nhóm">
            <form onSubmit={createGroup} className="flex items-end gap-2">
              <Field label="Tên nhóm">
                <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} required />
              </Field>
              <Button type="submit">Thêm</Button>
            </form>
          </Card>
          <Card title="Thêm đội">
            <form onSubmit={createTeam} className="flex items-end gap-2">
              <Field label="Tên đội">
                <Input value={teamName} onChange={(e) => setTeamName(e.target.value)} required />
              </Field>
              <Field label="Thuộc nhóm">
                <Select value={teamGroup} onChange={(e) => setTeamGroup(e.target.value)}>
                  <option value="">— Không thuộc nhóm —</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </Select>
              </Field>
              <Button type="submit">Thêm</Button>
            </form>
          </Card>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {chart.map((node) => (
            <Card
              key={node.group?.id ?? 'ungrouped'}
              title={node.group ? `Nhóm: ${node.group.name}` : 'Đội không thuộc nhóm'}
              actions={
                node.group && manage ? (
                  <div className="flex items-center gap-2">
                    {can('user.view') && (
                      <Select
                        value={node.group.manager_user_id ?? ''}
                        onChange={(e) =>
                          run(async () => {
                            await api(`/org/groups/${node.group!.id}`, {
                              method: 'PATCH',
                              json: { manager_user_id: e.target.value || null },
                            });
                            await refresh();
                          })
                        }
                      >
                        <option value="">— Chưa có quản lý —</option>
                        {staff.map((u) => (
                          <option key={u.id} value={u.id}>{u.full_name}</option>
                        ))}
                      </Select>
                    )}
                    <Button
                      variant="secondary"
                      onClick={() =>
                        run(async () => {
                          await api(`/org/groups/${node.group!.id}`, { method: 'DELETE' });
                          await refresh();
                        })
                      }
                    >
                      Xoá
                    </Button>
                  </div>
                ) : node.group?.manager_name ? (
                  <span className="text-sm text-slate-500">Quản lý: {node.group.manager_name}</span>
                ) : null
              }
            >
              <ul className="divide-y divide-slate-100">
                {node.teams.map((team) => (
                  <li key={team.id}>
                    <button
                      onClick={() => run(() => openTeam(team))}
                      className={`flex w-full items-center justify-between px-2 py-2 text-left text-sm hover:bg-slate-50 ${
                        selected?.id === team.id ? 'bg-teal-50' : ''
                      }`}
                    >
                      <span className="font-medium">{team.name}</span>
                      <span className="text-slate-500">
                        {team.leader_name ? `Đội trưởng: ${team.leader_name} · ` : ''}
                        {team.member_count} người
                      </span>
                    </button>
                  </li>
                ))}
                {!node.teams.length && <li className="py-2 text-sm text-slate-400">Chưa có đội</li>}
              </ul>
            </Card>
          ))}
          {!chart.length && <p className="text-sm text-slate-400">Chưa có nhóm hay đội nào trong phạm vi của bạn.</p>}
        </div>

        {selected && (
          <Card
            title={`Đội ${selected.name}`}
            actions={
              manage ? (
                <Button
                  variant="danger"
                  onClick={() =>
                    run(async () => {
                      await api(`/org/teams/${selected.id}`, { method: 'DELETE' });
                      setSelected(null);
                      await refresh();
                    })
                  }
                >
                  Xoá đội
                </Button>
              ) : undefined
            }
          >
            {staffing && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await api(`/org/teams/${selected.id}/members`, { method: 'POST', json: { employee_id: joinEmployee } });
                    setJoinEmployee('');
                    await refresh();
                  });
                }}
                className="mb-3 flex items-end gap-2"
              >
                <Field label="Thêm / chuyển nhân viên vào đội (từ hôm nay)">
                  <Select value={joinEmployee} onChange={(e) => setJoinEmployee(e.target.value)} required>
                    <option value="">— Chọn nhân viên —</option>
                    {available.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.code} · {e.full_name}
                        {e.team ? ` (đang ở ${e.team.name})` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button type="submit">Thêm</Button>
              </form>
            )}
            <div className="overflow-x-auto"><table className="w-full text-left text-sm">
              <thead className="text-slate-500">
                <tr>
                  <th className="py-2">Nhân viên</th>
                  <th>Vào đội từ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id} className="border-t border-slate-100">
                    <td className="py-2">
                      {m.full_name} <span className="font-mono text-slate-400">{m.code}</span>
                      {m.is_leader && <span className="ml-2 rounded bg-teal-100 px-1.5 text-xs text-teal-800">Đội trưởng</span>}
                    </td>
                    <td>{m.start_date}</td>
                    <td className="space-x-2 text-right">
                      {staffing && !m.is_leader && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            run(async () => {
                              await api(`/org/teams/${selected.id}/leader`, { method: 'PUT', json: { employee_id: m.employee_id } });
                              await refresh();
                            })
                          }
                        >
                          Làm đội trưởng
                        </Button>
                      )}
                      {staffing && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            run(async () => {
                              await api(`/org/teams/${selected.id}/members/${m.employee_id}/leave`, { method: 'POST', json: {} });
                              await refresh();
                            })
                          }
                        >
                          Rời đội
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {!members.length && (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-slate-400">Đội chưa có thành viên</td>
                  </tr>
                )}
              </tbody>
            </table></div>
          </Card>
        )}
      </div>
    </div>
  );
}
