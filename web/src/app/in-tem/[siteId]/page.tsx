'use client';

import { useParams } from 'next/navigation';
import QRCode from 'qrcode';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { AuthProvider } from '@/lib/auth';

interface Sheet {
  site: { id: string; code: string; name: string; client_name: string };
  tags: { id: string; code: string; name: string; payload: string }[];
}

function Tags() {
  const { siteId } = useParams<{ siteId: string }>();
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [svgs, setSvgs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const data = await api<Sheet>(`/sites/${siteId}/qr-sheet`);
      // Error correction H: a tag stays readable with a scratch or a bit of tape over it.
      const pairs = await Promise.all(
        data.tags.map(async (t) => [t.id, await QRCode.toString(t.payload, { type: 'svg', errorCorrectionLevel: 'H', margin: 1 })] as const),
      );
      setSvgs(Object.fromEntries(pairs));
      setSheet(data);
    })().catch((e) => setError(e instanceof Error ? e.message : 'Không tải được danh sách tem'));
  }, [siteId]);

  if (error) return <p className="p-8 text-red-600">{error}</p>;
  if (!sheet) return <p className="p-8 text-slate-500">Đang tạo tem…</p>;

  return (
    <div className="mx-auto max-w-[210mm] p-4 print:p-0">
      <style>{`@page { size: A4; margin: 10mm; } @media print { .no-print { display: none !important; } body { background: white; } }`}</style>
      <div className="no-print mb-4 flex items-center justify-between rounded bg-amber-50 p-3 text-sm text-amber-900">
        <span>
          {sheet.tags.length} tem cho <b>{sheet.site.name}</b> ({sheet.site.client_name}). Dán tem ở nơi khô, ngang tầm mắt; mỗi tem chỉ dán đúng điểm của nó.
        </span>
        <button onClick={() => window.print()} className="rounded bg-teal-700 px-3 py-1.5 font-medium text-white">In / Lưu PDF</button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {sheet.tags.map((t) => (
          <div key={t.id} className="flex break-inside-avoid flex-col items-center rounded border-2 border-slate-800 p-3 text-center" style={{ height: '64mm' }}>
            <div className="text-[10px] uppercase tracking-wide text-slate-500">{sheet.site.name}</div>
            <div className="h-[36mm] w-[36mm]" dangerouslySetInnerHTML={{ __html: svgs[t.id] ?? '' }} />
            <div className="mt-1 text-sm font-semibold leading-tight">{t.name}</div>
            <div className="font-mono text-xs text-slate-600">{t.code}</div>
            <div className="mt-auto text-[9px] text-slate-400">Quét bằng ứng dụng IntelShield</div>
          </div>
        ))}
      </div>
      {!sheet.tags.length && <p className="text-slate-500">Mục tiêu chưa có điểm tuần tra đang hoạt động.</p>}
    </div>
  );
}

export default function PrintTagsPage() {
  return (
    <AuthProvider>
      <Tags />
    </AuthProvider>
  );
}
