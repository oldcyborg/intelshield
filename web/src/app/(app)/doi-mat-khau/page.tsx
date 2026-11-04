'use client';

import { FormEvent, useState } from 'react';
import { Button, Card, ErrorText, Field, Input, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function ChangePasswordPage() {
  const { reload } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (next !== confirm) {
      setError('Hai lần nhập mật khẩu mới không khớp');
      return;
    }
    try {
      await api('/auth/change-password', { method: 'POST', json: { current_password: current, new_password: next } });
      setDone(true);
      setCurrent('');
      setNext('');
      setConfirm('');
      await reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="max-w-md">
      <Card title="Đổi mật khẩu">
        <form onSubmit={submit} className="space-y-3">
          <Field label="Mật khẩu hiện tại">
            <Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </Field>
          <Field label="Mật khẩu mới (ít nhất 8 ký tự)">
            <Input type="password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
          </Field>
          <Field label="Nhập lại mật khẩu mới">
            <Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          </Field>
          <ErrorText error={error} />
          {done && <p className="text-sm text-teal-700">Đã đổi mật khẩu. Các thiết bị khác đã bị đăng xuất.</p>}
          <Button type="submit">Lưu</Button>
        </form>
      </Card>
    </div>
  );
}
