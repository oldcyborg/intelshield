import { Link } from 'react-router-dom';
import { useUnread } from '../lib/unread';

export function Bell() {
  const { unread } = useUnread();
  return (
    <Link to="/thong-bao" className="relative px-1 text-2xl" aria-label="Thông báo">
      🔔
      {unread > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-red-600 px-1.5 text-xs font-semibold text-white">{unread > 99 ? '99+' : unread}</span>}
    </Link>
  );
}
