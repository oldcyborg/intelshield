import { useEffect, useMemo } from 'react';
import { takePhoto } from '../lib/native';

/** Photos taken now with the rear camera, shown small; at most `max`. */
export function PhotoStrip({ photos, onChange, max = 5, onError }: { photos: Blob[]; onChange: (p: Blob[]) => void; max?: number; onError: (m: string) => void }) {
  const urls = useMemo(() => photos.map((p) => URL.createObjectURL(p)), [photos]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return (
    <div className="flex flex-wrap gap-2">
      {urls.map((u, i) => (
        <div key={u} className="relative">
          <img src={u} alt="" className="h-20 w-20 rounded-lg object-cover" />
          <button type="button" onClick={() => onChange(photos.filter((_, j) => j !== i))} className="absolute -right-2 -top-2 h-7 w-7 rounded-full bg-slate-800 text-white">×</button>
        </div>
      ))}
      {photos.length < max && (
        <button
          type="button"
          onClick={async () => { try { onChange([...photos, await takePhoto('rear')]); } catch (e) { onError(e instanceof Error ? e.message : 'Không chụp được ảnh'); } }}
          className="flex h-20 w-20 flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 text-sm text-slate-500"
        >
          <span className="text-2xl">📷</span>Chụp
        </button>
      )}
    </div>
  );
}

/** Upload taken photos one by one; returns their ids. */
export async function uploadAll(upload: (b: Blob, name: string) => Promise<{ id: string }>, photos: Blob[]): Promise<string[]> {
  const ids: string[] = [];
  for (const [i, p] of photos.entries()) ids.push((await upload(p, `anh-${i + 1}.jpg`)).id);
  return ids;
}
