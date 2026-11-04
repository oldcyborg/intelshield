import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, Screen } from '../components/ui';
import { navFor } from '../lib/nav';
import { API_BASE, APP_VERSION } from '../config';
import { useAuth } from '../lib/auth';
import { queue } from '../lib/client';
import { stamp } from '../lib/format';
import { QueueItem } from '../lib/queue';

export function Me() {
  const { me, logout } = useAuth();
  const [pending, setPending] = useState<QueueItem[]>([]);
  const [failed, setFailed] = useState<QueueItem[]>([]);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setPending(await queue.list());
    setFailed(await queue.failed());
  }, []);
  useEffect(() => {
    void load();
    return queue.subscribe(() => void load());
  }, [load]);

  if (!me) return null;
  return (
    <Screen title="Tôi">
      <Card>
        <div className="text-xl font-semibold">{me.user.full_name}</div>
        <div className="text-slate-500">{me.user.phone}</div>
        <div className="mt-2 text-sm text-slate-500">Máy: {me.device ? (me.device.status === 'active' ? 'đã duyệt' : me.device.status) : 'chưa gắn máy'}</div>
      </Card>

      <Card>
        <div className="flex items-center justify-between">
          <b>Chờ gửi khi có mạng</b>
          <span className={pending.length ? 'font-semibold text-amber-700' : 'text-slate-400'}>{pending.length} mục</span>
        </div>
        {pending.map((i) => <div key={i.id} className="mt-1 text-sm text-slate-600">{i.label} · {stamp(i.created_at)}</div>)}
        {pending.length > 0 && (
          <Button tone="secondary" className="mt-3" disabled={sending} onClick={async () => { setSending(true); await queue.flush(); setSending(false); }}>
            {sending ? 'Đang gửi…' : 'Gửi ngay'}
          </Button>
        )}
        {failed.length > 0 && (
          <div className="mt-3 space-y-2">
            <b className="text-red-700">Không gửi được</b>
            {failed.map((i) => (
              <div key={i.id} className="rounded-lg bg-red-50 p-2 text-sm">
                <div>{i.label} · {stamp(i.created_at)}</div>
                <div className="text-red-700">{i.error}</div>
                <div className="mt-1 flex gap-2">
                  <button className="underline" onClick={() => void queue.retry(i.id)}>Gửi lại</button>
                  <button className="underline" onClick={() => window.confirm('Bỏ mục này?') && void queue.discard(i.id)}>Bỏ</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {(me.permissions.includes('client.view') || me.permissions.includes('violation.review')) && !navFor(me.permissions, Boolean(me.user.employee_id)).some((t) => t.to === '/tong-quan') && (
        <Link to="/tong-quan" className="block"><Button tone="secondary">Tổng quan công ty</Button></Link>
      )}
      {me.user.employee_id && <Link to="/don" className="block"><Button tone="secondary">📝 Đơn của tôi — xin nghỉ, bổ sung chấm công</Button></Link>}
      {me.user.employee_id && <Link to="/phieu-luong" className="block"><Button tone="secondary">💰 Phiếu lương</Button></Link>}
      <Link to="/doi-mat-khau" className="block"><Button tone="secondary">Đổi mật khẩu</Button></Link>
      <Button
        tone="danger"
        onClick={() => window.confirm(pending.length ? `Còn ${pending.length} mục chưa gửi — đăng xuất sẽ xoá chúng. Vẫn đăng xuất?` : 'Đăng xuất khỏi máy này?') && void logout()}
      >
        Đăng xuất
      </Button>
      <p className="pt-2 text-center text-xs text-slate-400">IntelShield {APP_VERSION} · {API_BASE}</p>
    </Screen>
  );
}
