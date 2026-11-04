import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, ErrorText, Field, Input, Screen } from '../components/ui';
import { useAuth } from '../lib/auth';
import { api } from '../lib/client';

/** Forced on first sign-in with a password someone else set; also reachable from the "Tôi" tab. */
export function ChangePassword({ forced = false }: { forced?: boolean }) {
  const { reload, logout } = useAuth();
  const navigate = useNavigate();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (next !== again) return setError('Hai lần nhập mật khẩu mới không khớp');
    if (next.length < 8) return setError('Mật khẩu mới cần ít nhất 8 ký tự');
    setBusy(true);
    setError(null);
    try {
      await api.request('/auth/change-password', { json: { current_password: current, new_password: next } });
      await reload();
      if (!forced) navigate('/toi');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen title="Đổi mật khẩu">
      {forced && <p className="rounded-lg bg-amber-50 p-3 text-amber-800">Bạn đang dùng mật khẩu do người khác đặt. Đổi mật khẩu của riêng bạn để tiếp tục.</p>}
      <form onSubmit={submit} className="space-y-3">
        <Field label="Mật khẩu hiện tại"><Input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required /></Field>
        <Field label="Mật khẩu mới (ít nhất 8 ký tự)"><Input type="password" value={next} onChange={(e) => setNext(e.target.value)} required /></Field>
        <Field label="Nhập lại mật khẩu mới"><Input type="password" value={again} onChange={(e) => setAgain(e.target.value)} required /></Field>
        <ErrorText error={error} />
        <Button type="submit" disabled={busy}>Lưu mật khẩu</Button>
        {forced && <Button type="button" tone="secondary" onClick={() => void logout()}>Đăng xuất</Button>}
      </form>
    </Screen>
  );
}
