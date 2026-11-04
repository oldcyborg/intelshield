import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, Card, ErrorText, Screen } from '../components/ui';
import { NetworkError } from '../lib/api';
import { api } from '../lib/client';
import { FLAG_LABEL, time } from '../lib/format';
import { Fix, getPosition, takePhoto } from '../lib/native';

interface Result {
  check_in_at?: string;
  check_out_at?: string | null;
  late_minutes?: number;
  early_minutes?: number | null;
  check_in_flags?: string[];
  check_out_flags?: string[] | null;
}

/** Selfie with the front camera, the phone's position, then one request. Needs the network: the server's clock decides. */
export function Check() {
  const { id, way } = useParams<{ id: string; way: 'in' | 'out' }>();
  const navigate = useNavigate();
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fix, setFix] = useState<Fix | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [uploaded, setUploaded] = useState<string | null>(null);
  const label = way === 'in' ? 'Vào ca' : 'Ra ca';

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function shoot() {
    setError(null);
    try {
      const blob = await takePhoto('front');
      setPhoto(blob);
      setUploaded(null);
      setPreview(URL.createObjectURL(blob));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không chụp được ảnh');
      return;
    }
    await locate();
  }

  async function locate() {
    setError(null);
    setFix(null);
    try {
      setFix(await getPosition());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chưa lấy được vị trí');
    }
  }

  async function send() {
    if (!photo || !fix) return;
    setBusy(true);
    setError(null);
    try {
      // Sent again after a failure: the selfie already uploaded is reused, not uploaded twice.
      const selfie = uploaded ?? (await api.upload(photo, 'selfie.jpg')).id;
      setUploaded(selfie);
      setResult(await api.request<Result>(`/attendance/check-${way}`, {
        json: { assignment_id: id, lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracy_m, device_time: new Date().toISOString(), selfie_file_id: selfie, mock_location: false },
      }));
    } catch (err) {
      setError(err instanceof NetworkError ? 'Không có mạng. Vào/ra ca cần mạng — thử lại khi có sóng.' : err instanceof Error ? err.message : 'Có lỗi xảy ra');
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const flags = (way === 'in' ? result.check_in_flags : result.check_out_flags) ?? [];
    return (
      <Screen title={label}>
        <Card className="text-center">
          <div className="text-5xl">✅</div>
          <div className="mt-2 text-2xl font-semibold">{label} lúc {time(way === 'in' ? result.check_in_at : result.check_out_at)}</div>
          {way === 'in' && result.late_minutes ? <div className="text-lg text-amber-700">Trễ {result.late_minutes} phút</div> : null}
          {flags.length > 0 && <div className="mt-2 text-base text-red-700">Lưu ý: {flags.map((f) => FLAG_LABEL[f] ?? f).join(', ')}</div>}
        </Card>
        <Button onClick={() => navigate('/')}>Về ca trực</Button>
      </Screen>
    );
  }

  return (
    <Screen title={label} action={<button className="text-sm underline" onClick={() => navigate(-1)}>Huỷ</button>}>
      <Card>
        <div className="text-lg font-semibold">1. Chụp ảnh khuôn mặt</div>
        {preview ? <img src={preview} alt="" className="mt-2 aspect-square w-full rounded-xl object-cover" /> : <p className="text-slate-500">Dùng camera trước, nhìn thẳng, đủ sáng.</p>}
        <Button tone={preview ? 'secondary' : 'primary'} className="mt-3" onClick={() => void shoot()} disabled={busy}>{preview ? 'Chụp lại' : 'Mở camera'}</Button>
      </Card>
      <Card>
        <div className="text-lg font-semibold">2. Vị trí</div>
        <p className={fix ? 'text-slate-700' : 'text-slate-500'}>{fix ? `Đã lấy vị trí (sai số khoảng ${fix.accuracy_m} m)` : photo ? 'Chưa có vị trí' : 'Lấy tự động sau khi chụp ảnh.'}</p>
        {photo && !fix && <Button tone="secondary" className="mt-3" onClick={() => void locate()} disabled={busy}>Lấy lại vị trí</Button>}
      </Card>
      <ErrorText error={error} />
      <Button onClick={() => void send()} disabled={!photo || !fix || busy}>{busy ? 'Đang gửi…' : `Gửi — ${label}`}</Button>
    </Screen>
  );
}
