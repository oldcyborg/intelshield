'use client';

import { useEffect, useState } from 'react';
import { Empty, MinePage } from '@/components/mine';
import { Card, ErrorText, errorMessage } from '@/components/ui';
import { api } from '@/lib/api';
import { date, DOCUMENT_KIND } from '@/lib/format';

interface MyDocument {
  id: string;
  kind: string;
  number: string | null;
  issued_on: string | null;
  expires_on: string | null;
  days_left: number | null;
  file: { id: string; original_name: string } | null;
  note: string | null;
}

/** The labour contract first: it is what a guard opens this page for. */
const rank = (d: MyDocument) => (d.kind === 'labor_contract' ? 0 : 1);

export default function MyDocumentsPage() {
  const [rows, setRows] = useState<MyDocument[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<MyDocument[]>('/me/documents')
      .then((r) => setRows([...r].sort((a, b) => rank(a) - rank(b))))
      .catch((e) => setError(errorMessage(e)));
  }, []);
  return (
    <MinePage>
      <ErrorText error={error} />
      <Card title="Hợp đồng lao động & giấy tờ">
        <ul className="divide-y divide-slate-100 text-sm">
          {rows?.map((d) => (
            <li key={d.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2">
              <span>
                <b>{DOCUMENT_KIND[d.kind] ?? d.kind}</b>
                {d.number && <span className="ml-2 text-slate-500">số {d.number}</span>}
                {d.note && <div className="text-slate-500">{d.note}</div>}
              </span>
              <span className="text-slate-500">
                {d.issued_on && <>từ {date(d.issued_on)} </>}
                {d.expires_on && <>đến {date(d.expires_on)}</>}
                {d.days_left !== null && d.days_left < 0 && <span className="ml-1 text-red-700">(đã hết hạn)</span>}
                {d.days_left !== null && d.days_left >= 0 && d.days_left <= 30 && <span className="ml-1 text-amber-700">(còn {d.days_left} ngày)</span>}
                {d.file && (
                  <a href={`/api/files/${d.file.id}`} className="ml-3 text-teal-700 hover:underline">
                    Xem bản scan
                  </a>
                )}
              </span>
            </li>
          ))}
        </ul>
        {rows && !rows.length && <Empty>Công ty chưa lưu hợp đồng hay giấy tờ nào của bạn. Cần bản hợp đồng, hãy hỏi phòng nhân sự.</Empty>}
      </Card>
    </MinePage>
  );
}
