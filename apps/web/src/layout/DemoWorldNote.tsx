import { useQuery } from '@tanstack/react-query';
import type { SidebarView } from '@shillex/shared';
import { get } from '../lib/api';
import s from './layout.module.css';

export function DemoWorldNote() {
  const { data } = useQuery({ queryKey: ['sidebar'], queryFn: () => get<SidebarView>('/sidebar'), refetchInterval: 60_000 });
  return (
    <p className={s.demoNote}>
      <strong>Demo world.</strong> Seeded people, communities and tokens are fictional. Market numbers on DEMO tokens are invented; live tokens show their data source.
      {data?.demoSimulator && <span className={s.demoLive}>Demo activity is on — personas post automatically.</span>}
    </p>
  );
}
