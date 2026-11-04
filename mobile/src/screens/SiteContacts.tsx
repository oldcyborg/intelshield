import { useParams } from 'react-router-dom';
import { ContactList } from '../components/ContactList';
import { Screen } from '../components/ui';

/** Who to call at the client while on shift at this site. */
export function SiteContacts() {
  const { siteId } = useParams<{ siteId: string }>();
  return (
    <Screen title="Đầu mối liên hệ" back>
      <p className="text-sm text-slate-500">Người của khách hàng tại mục tiêu bạn được phép liên hệ. Gọi theo thứ tự từ trên xuống.</p>
      <ContactList siteId={siteId!} empty="Mục tiêu chưa có đầu mối nào bạn được liên hệ — gọi đội trưởng." />
    </Screen>
  );
}
