import { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { Bell } from './Bell';

const TONE = {
  primary: 'bg-teal-700 text-white active:bg-teal-800',
  secondary: 'border border-slate-300 bg-white text-slate-800 active:bg-slate-100',
  danger: 'bg-red-600 text-white active:bg-red-700',
};

export function Button({ tone = 'primary', className = '', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof TONE }) {
  return <button {...props} className={`w-full rounded-xl px-4 py-3.5 text-lg font-semibold disabled:opacity-50 ${TONE[tone]} ${className}`} />;
}

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-lg ${className}`} />;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm font-medium text-slate-600">{label}</span>
      {children}
    </label>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm ${className}`}>{children}</section>;
}

export function ErrorText({ error }: { error: string | null }) {
  return error ? <p className="rounded-lg bg-red-50 p-3 text-base text-red-700">{error}</p> : null;
}

export function Screen({ title, children, action, back }: { title: string; children: ReactNode; action?: ReactNode; back?: boolean }) {
  return (
    <div className="min-h-full pb-24">
      <header className="safe-top sticky top-0 z-10 flex items-center gap-2 bg-teal-800 px-4 py-3 text-white">
        {back && <button onClick={() => window.history.back()} className="-ml-1 pr-1 text-2xl" aria-label="Quay lại">‹</button>}
        <h1 className="flex-1 truncate text-xl font-semibold">{title}</h1>
        {action}
        <Bell />
      </header>
      <div className="space-y-3 p-4">{children}</div>
    </div>
  );
}

export function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className={`inline-block rounded-md px-2 py-0.5 text-sm font-medium ${tone}`}>{children}</span>;
}
