import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { navFor } from '../lib/nav';

export function Layout() {
  const { me } = useAuth();
  const tabs = navFor(me?.permissions ?? [], Boolean(me?.user.employee_id));
  return (
    <div className="h-full">
      <Outlet />
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-20 flex border-t border-slate-200 bg-white">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === '/'} className={({ isActive }) => `flex flex-1 flex-col items-center py-2 text-xs ${isActive ? 'font-semibold text-teal-700' : 'text-slate-500'}`}>
            <span className="text-2xl" aria-hidden>{t.icon}</span>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
