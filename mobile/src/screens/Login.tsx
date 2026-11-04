import { FormEvent, useState } from 'react';
import { Button, ErrorText, Field, Input } from '../components/ui';
import { ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';

export function Login() {
  const { login } = useAuth();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<'pending' | 'revoked' | null>(null);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(phone, password);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'DEVICE_PENDING') setDevice('pending');
      else if (err instanceof ApiError && err.code === 'DEVICE_REVOKED') setDevice('revoked');
      else setError(err instanceof Error ? err.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  }

  if (device) {
    return (
      <div className="safe-top flex min-h-full flex-col justify-center gap-4 p-6">
        <div className="text-5xl">{device === 'pending' ? '⏳' : '⛔'}</div>
        <h1 className="text-2xl font-semibold">{device === 'pending' ? 'Máy này đang chờ duyệt' : 'Máy này đã bị thu hồi'}</h1>
        <p className="text-lg text-slate-600">
          {device === 'pending'
            ? 'Mỗi bảo vệ chỉ dùng một điện thoại. Báo HR hoặc đội trưởng duyệt máy mới trên trang Thiết bị, rồi bấm Thử lại.'
            : 'Liên hệ HR để được duyệt lại máy, hoặc đăng nhập bằng điện thoại đã được duyệt.'}
        </p>
        <ErrorText error={error} />
        {device === 'pending' && <Button onClick={() => void submit()} disabled={busy}>{busy ? 'Đang kiểm tra…' : 'Thử lại'}</Button>}
        <Button tone="secondary" onClick={() => { setDevice(null); setPassword(''); }}>Dùng tài khoản khác</Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="safe-top flex min-h-full flex-col justify-center gap-4 p-6">
      <div className="mb-4 text-center">
        <div className="text-5xl">🛡️</div>
        <h1 className="mt-2 text-3xl font-bold text-teal-800">IntelShield</h1>
        <p className="text-slate-500">Bảo vệ · Tuần tra · Sự cố</p>
      </div>
      <Field label="Số điện thoại"><Input type="tel" inputMode="tel" autoComplete="username" value={phone} onChange={(e) => setPhone(e.target.value)} required /></Field>
      <Field label="Mật khẩu"><Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
      <ErrorText error={error} />
      <Button type="submit" disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</Button>
      <p className="text-center text-sm text-slate-500">Quên mật khẩu: nhờ HR hoặc đội trưởng đặt lại.</p>
    </form>
  );
}
