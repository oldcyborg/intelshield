import { App as CapApp } from '@capacitor/app';
import { Network } from '@capacitor/network';
import { useEffect, useRef } from 'react';
import { HashRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { Layout } from './components/Layout';
import { AuthProvider, useAuth } from './lib/auth';
import { api, queue } from './lib/client';
import { navFor, routeFor } from './lib/nav';
import { registerPush } from './lib/push';
import { UnreadProvider, useUnread } from './lib/unread';
import { Check } from './screens/Check';
import { ChangePassword } from './screens/ChangePassword';
import { Login } from './screens/Login';
import { Me } from './screens/Me';
import { Notifications } from './screens/Notifications';
import { IncidentDetail } from './screens/IncidentDetail';
import { Incidents } from './screens/Incidents';
import { NewIncident } from './screens/NewIncident';
import { Overview } from './screens/Overview';
import { PersonShift } from './screens/PersonShift';
import { Reviews } from './screens/Reviews';
import { RoundDetail } from './screens/RoundDetail';
import { Shifts } from './screens/Shifts';
import { SiteContacts } from './screens/SiteContacts';
import { Team } from './screens/Team';
import { GiveHandover } from './screens/GiveHandover';
import { GuardLogbook } from './screens/GuardLogbook';
import { MyRounds } from './screens/MyRounds';
import { ReportIncident } from './screens/ReportIncident';
import { RoundRun } from './screens/RoundRun';
import { TakeHandover } from './screens/TakeHandover';
import { MyRequests } from './screens/MyRequests';
import { NewCorrection } from './screens/NewCorrection';
import { NewLeave } from './screens/NewLeave';
import { Payslip, Payslips } from './screens/Payslips';

/** While signed in: push registration, and the offline queue sent whenever there is a chance. */
function Background() {
  const navigate = useNavigate();
  const { refresh } = useUnread();
  const { me } = useAuth();
  const perms = useRef<string[]>([]);
  perms.current = me?.permissions ?? [];
  // The router's navigate changes with every page: kept in refs so this runs once per sign-in.
  const go = useRef(navigate);
  const reread = useRef(refresh);
  go.current = navigate;
  reread.current = refresh;
  useEffect(() => {
    void registerPush(api, (data) => go.current(routeFor(data, perms.current)), () => void reread.current());
    void queue.flush();
    const timer = setInterval(() => void queue.flush(), 60_000);
    const net = Network.addListener('networkStatusChange', (s) => { if (s.connected) void queue.flush(); });
    const resume = CapApp.addListener('resume', () => { void queue.flush(); void reread.current(); });
    return () => {
      clearInterval(timer);
      void net.then((h) => h.remove());
      void resume.then((h) => h.remove());
    };
  }, []);
  return null;
}

/** First tab of this person: the overview for managers, the shifts for everyone with a shift. */
function Home() {
  const { me } = useAuth();
  const first = navFor(me?.permissions ?? [], Boolean(me?.user.employee_id))[0];
  // '/' is the shifts tab, only offered to people with a shift — so this never loops.
  return <Navigate to={first?.to ?? '/toi'} replace />;
}

function Gate() {
  const { state, me } = useAuth();
  if (state === 'loading') return <div className="flex h-full items-center justify-center text-4xl">🛡️</div>;
  if (state === 'out' || !me) return <Login />;
  if (me.user.must_change_password) return <ChangePassword forced />;
  return (
    <UnreadProvider>
      <Background />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={me.user.employee_id ? <Shifts /> : <Home />} />
          <Route path="/tong-quan" element={<Overview />} />
          <Route path="/doi" element={<Team />} />
          <Route path="/su-co" element={<Incidents />} />
          <Route path="/duyet" element={<Reviews />} />
          <Route path="/toi" element={<Me />} />
        </Route>
        <Route path="/thong-bao" element={<Notifications />} />
        <Route path="/check/:id/:way" element={<Check />} />
        <Route path="/doi-mat-khau" element={<ChangePassword />} />
        <Route path="/doi/ca/:siteId/:assignmentId" element={<PersonShift />} />
        <Route path="/doi/vong/:id" element={<RoundDetail />} />
        <Route path="/su-co/moi" element={<NewIncident />} />
        <Route path="/su-co/:id" element={<IncidentDetail />} />
        <Route path="/tuan-tra" element={<MyRounds />} />
        <Route path="/tuan-tra/:id" element={<RoundRun />} />
        <Route path="/bao-su-co" element={<ReportIncident />} />
        <Route path="/so-truc/:siteId" element={<GuardLogbook />} />
        <Route path="/lien-he/:siteId" element={<SiteContacts />} />
        <Route path="/giao-ca/:siteId/:assignmentId" element={<GiveHandover />} />
        <Route path="/nhan-ca/:id" element={<TakeHandover />} />
        <Route path="/don" element={<MyRequests />} />
        <Route path="/don/nghi" element={<NewLeave />} />
        <Route path="/phieu-luong" element={<Payslips />} />
        <Route path="/phieu-luong/:id" element={<Payslip />} />
        <Route path="/don/cham-cong/:assignmentId" element={<NewCorrection />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </UnreadProvider>
  );
}

export function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </HashRouter>
  );
}
