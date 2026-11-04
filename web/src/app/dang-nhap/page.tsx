'use client';

import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { Button, ErrorText, Field, Input, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/auth/login', { method: 'POST', json: { identifier, password, device_label: 'web' } });
      router.replace('/');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-lg bg-white p-6 shadow">
        <h1 className="text-lg font-semibold">Đăng nhập IntelShield</h1>
        <Field label="Số điện thoại hoặc email">
          <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoFocus required />
        </Field>
        <Field label="Mật khẩu">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorText error={error} />
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </Button>
      </form>
    </div>
  );
}
