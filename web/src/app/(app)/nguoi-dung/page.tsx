'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, Select, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ChartNode, Employee, RoleView, UserRow, UserView } from '@/lib/types';

/** One scope per account in this screen: "tenant", "team_group:<id>", "team:<id>" or "" (only what the org chart gives). */
type ScopeKey = string;

const toScopes = (key: ScopeKey) => {
  if (!key) return [];
  if (key === 'tenant') return [{ scope_type: 'tenant' }];
  const [scope_type, scope_id] = key.split(':');
  return [{ scope_type, scope_id }];
};

const fromScopes = (scopes: UserView['scopes']): ScopeKey => {
  const first = scopes[0];
  if (!first) return '';
  return first.scope_type === 'tenant' ? 'tenant' : `${first.scope_type}:${first.scope_id}`;
};

const EMPTY = {
  full_name: '',
  phone: '',
  email: '',
  password: '',
  user_type: 'staff' as 'staff' | 'guard',
  employee_id: '',
  role_ids: [] as string[],
  scope: '' as ScopeKey,
};

export default function UsersPage() {
  const { can, me } = useAuth();
  const manage = can('user.manage');
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleView[]>([]);
  const [chart, setChart] = useState<ChartNode[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState<{ id: string; role_ids: string[]; scope: ScopeKey } | null>(null);
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
    setUsers(await api<UserRow[]>('/users'));
    if (can('role.view')) setRoles(await api<RoleView[]>('/roles'));
    if (can('org.view')) setChart(await api<ChartNode[]>('/org/chart'));
    if (can('employee.view')) setEmployees(await api<Employee[]>('/employees'));
  }, [can]);

  useEffect(() => {
    void run(load);
  }, [load, run]);

  const scopeOptions = [
    { key: '', label: '— Chỉ theo cơ cấu tổ chức (đội trưởng, quản lý nhóm) —' },
    ...(me.team_visibility.all ? [{ key: 'tenant', label: 'Toàn công ty' }] : []),
    ...chart.flatMap((n) => (n.group && me.team_visibility.all ? [{ key: `team_group:${n.group.id}`, label: `Nhóm ${n.group.name}` }] : [])),
    ...chart.flatMap((n) => n.teams.map((t) => ({ key: `team:${t.id}`, label: `Đội ${t.name}` }))),
  ];
  const linkedEmployees = new Set(users.map((u) => u.employee_id).filter(Boolean));

  async function create(event: FormEvent) {
    event.preventDefault();
    await run(async () => {
      await api('/users', {
        method: 'POST',
        json: {
          user_type: form.user_type,
          full_name: form.full_name,
          password: form.password,
          role_ids: form.role_ids,
          scopes: toScopes(form.scope),
          ...(form.phone ? { phone: form.phone } : {}),
          ...(form.email ? { email: form.email } : {}),
          ...(form.employee_id ? { employee_id: form.employee_id } : {}),
        },
      });
      setForm(EMPTY);
      await load();
    });
  }

  async function startEdit(user: UserRow) {
    await run(async () => {
      const detail = await api<UserView>(`/users/${user.id}`);
      setEditing({ id: user.id, role_ids: detail.roles.map((r) => r.id), scope: fromScopes(detail.scopes) });
    });
  }

  async function saveEdit() {
    if (!editing) return;
    await run(async () => {
      await api(`/users/${editing.id}`, {
        method: 'PATCH',
        json: { role_ids: editing.role_ids, scopes: toScopes(editing.scope) },
      });
      setEditing(null);
      await load();
    });
  }

  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const roleBoxes = (selected: string[], onChange: (next: string[]) => void) => (
    <div className="flex flex-wrap gap-3">
      {roles.map((r) => (
        <label key={r.id} className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={selected.includes(r.id)} onChange={() => onChange(toggle(selected, r.id))} />
          {r.name}
        </label>
      ))}
    </div>
  );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Người dùng</h1>
      <ErrorText error={error} />

      {manage && (
        <Card title="Tạo tài khoản">
          <form onSubmit={create} className="space-y-3">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label="Họ tên">
                <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required />
              </Field>
              <Field label="Số điện thoại">
                <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </Field>
              <Field label="Email">
                <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <Field label="Mật khẩu ban đầu (người dùng sẽ phải đổi)">
                <Input minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
              </Field>
              <Field label="Loại tài khoản">
                <Select
                  value={form.user_type}
                  onChange={(e) => setForm({ ...form, user_type: e.target.value as 'staff' | 'guard' })}
                >
                  <option value="staff">Văn phòng (quản lý, HR, kế toán)</option>
                  <option value="guard">Bảo vệ / đội trưởng</option>
                </Select>
              </Field>
              <Field label="Gắn với nhân viên">
                <Select value={form.employee_id} onChange={(e) => setForm({ ...form, employee_id: e.target.value })}>
                  <option value="">— Không —</option>
                  {employees
                    .filter((e) => !linkedEmployees.has(e.id))
                    .map((e) => (
                      <option key={e.id} value={e.id}>{e.code} · {e.full_name}</option>
                    ))}
                </Select>
              </Field>
            </div>
            <Field label="Vai trò">{roleBoxes(form.role_ids, (role_ids) => setForm({ ...form, role_ids }))}</Field>
            <Field label="Phạm vi được xem">
              <Select value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>
                {scopeOptions.map((o) => (
                  <option key={o.key} value={o.key}>{o.label}</option>
                ))}
              </Select>
            </Field>
            <p className="text-xs text-slate-500">
              Cần số điện thoại hoặc email. Không cấp được vai trò hay phạm vi rộng hơn của chính bạn.
            </p>
            <Button type="submit">Tạo tài khoản</Button>
          </form>
        </Card>
      )}

      <Card>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <thead className="text-slate-500">
            <tr>
              <th className="py-2">Họ tên</th>
              <th>Đăng nhập</th>
              <th>Vai trò</th>
              <th>Trạng thái</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100 align-top">
                <td className="py-2">{u.full_name}</td>
                <td>{u.phone ?? u.email}</td>
                <td>
                  {editing?.id === u.id ? (
                    <div className="space-y-2">
                      {roleBoxes(editing.role_ids, (role_ids) => setEditing({ ...editing, role_ids }))}
                      <Select value={editing.scope} onChange={(e) => setEditing({ ...editing, scope: e.target.value })}>
                        {scopeOptions.map((o) => (
                          <option key={o.key} value={o.key}>{o.label}</option>
                        ))}
                      </Select>
                      <div className="space-x-2">
                        <Button onClick={saveEdit}>Lưu</Button>
                        <Button variant="secondary" onClick={() => setEditing(null)}>Huỷ</Button>
                      </div>
                    </div>
                  ) : (
                    u.roles.map((r) => r.name).join(', ') || <span className="text-slate-400">Chưa có</span>
                  )}
                </td>
                <td>{u.status === 'active' ? 'Hoạt động' : <span className="text-red-600">Đã khoá</span>}</td>
                <td className="space-x-2 whitespace-nowrap text-right">
                  {manage && editing?.id !== u.id && (
                    <>
                      {can('role.view') && (
                        <Button variant="secondary" onClick={() => startEdit(u)}>Sửa quyền</Button>
                      )}
                      <Button
                        variant="secondary"
                        onClick={() => {
                          const password = window.prompt(`Mật khẩu mới cho ${u.full_name} (ít nhất 8 ký tự):`);
                          if (password) {
                            void run(async () => {
                              await api(`/users/${u.id}/reset-password`, { method: 'POST', json: { new_password: password } });
                              window.alert('Đã đặt lại mật khẩu. Người dùng phải đổi khi đăng nhập.');
                            });
                          }
                        }}
                      >
                        Đặt lại mật khẩu
                      </Button>
                      {u.id !== me.user.id && (
                        <Button
                          variant={u.status === 'active' ? 'danger' : 'secondary'}
                          onClick={() =>
                            run(async () => {
                              await api(`/users/${u.id}`, {
                                method: 'PATCH',
                                json: { status: u.status === 'active' ? 'locked' : 'active' },
                              });
                              await load();
                            })
                          }
                        >
                          {u.status === 'active' ? 'Khoá' : 'Mở khoá'}
                        </Button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Card>
    </div>
  );
}
