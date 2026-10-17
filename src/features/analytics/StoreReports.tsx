import { Link } from 'react-router-dom';
import { useStaffStore } from '@/features/auth/storeContext';
import { AnalyticsPanel } from '@/features/analytics/AnalyticsPanel';
import { HistoryPanel } from '@/features/analytics/HistoryPanel';
import { ActivityPanel } from '@/features/analytics/ActivityPanel';

export function StoreReports() {
  const { id } = useStaffStore();
  return (
    <main className="container">
      <Link className="back-link" to={'/staff/stores/' + id}>
        ← Вернуться в кухню
      </Link>
      <AnalyticsPanel endpoint={'/staff/stores/' + id + '/analytics'} />
      <HistoryPanel endpoint={'/staff/stores/' + id + '/history'} />
      <ActivityPanel endpoint={'/staff/stores/' + id + '/activity'} />
    </main>
  );
}
