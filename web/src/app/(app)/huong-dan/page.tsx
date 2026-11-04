'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';

/**
 * One video per role, played from where they are hosted rather than copied into this app: the files are large
 * and one copy is one copy to update. The cost is that watching needs the internet. Where they live is set at
 * build time (NEXT_PUBLIC_VIDEO_BASE_URL, ending in '/'); left empty, the page says there are none.
 */
const VIDEOS = [
  { key: 'bao-ve', title: 'Bảo vệ', minutes: 6, note: 'trên ứng dụng điện thoại' },
  { key: 'doi-truong', title: 'Đội trưởng', minutes: 5 },
  { key: 'quan-ly', title: 'Quản lý', minutes: 6 },
  { key: 'nhan-su', title: 'Nhân sự', minutes: 5 },
  { key: 'ke-toan', title: 'Kế toán', minutes: 5 },
] as const;

const BASE = (process.env.NEXT_PUBLIC_VIDEO_BASE_URL ?? '').trim();

/** A first guess at the viewer's own video, read from what they may do — never from a role name. */
function guess(can: (p: string) => boolean, guard: boolean): string {
  if (guard) return can('leave.review') ? 'doi-truong' : 'bao-ve';
  // A director holds everything and lands on the manager's video; these two are told apart by what they
  // manage that the others do not.
  if (can('payroll.manage') && !can('roster.manage')) return 'ke-toan';
  if (can('employee.manage') && !can('payroll.manage')) return 'nhan-su';
  return 'quan-ly';
}

export default function VideoGuidePage() {
  const { me, can } = useAuth();
  const [active, setActive] = useState(() => guess(can, me.user.user_type === 'guard'));
  const video = VIDEOS.find((v) => v.key === active) ?? VIDEOS[0];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Video hướng dẫn</h1>
        <p className="text-sm text-slate-500">Mỗi video theo một vai trò. Video không có tiếng; cần có internet để xem.</p>
      </div>
      <div role="tablist" aria-label="Chọn vai trò" className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0">
        {VIDEOS.map((v) => (
          <button
            key={v.key}
            type="button"
            role="tab"
            aria-selected={v.key === video.key}
            onClick={() => setActive(v.key)}
            className={`shrink-0 whitespace-nowrap rounded-full border px-4 py-1.5 text-sm font-medium ${
              v.key === video.key ? 'border-teal-700 bg-teal-700 text-white' : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {v.title}
          </button>
        ))}
      </div>
      {!BASE && (
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          Chưa cấu hình video hướng dẫn. Người cài đặt đặt <code>NEXT_PUBLIC_VIDEO_BASE_URL</code> lúc build để bật.
        </p>
      )}
      {BASE && <video key={video.key} controls preload="metadata" className="w-full max-w-4xl rounded-lg border border-slate-200 bg-black">
        <source src={`${BASE}${video.key}.mp4`} type="video/mp4" />
      </video>}
      <p className="text-sm text-slate-500">
        {video.title} · khoảng {video.minutes} phút
        {'note' in video ? ` · ${video.note}` : ''}
      </p>
    </div>
  );
}
