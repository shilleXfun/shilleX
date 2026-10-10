import { useSidebar } from './RightRail';
import s from './layout.module.css';

export function DemoWorldNote() {
  const { data } = useSidebar();
  return (
    <p className={s.demoNote}>
      <strong>Demo world.</strong> Seeded people, communities and tokens are fictional. Market numbers on DEMO tokens are invented; live tokens show their data source.
      {data?.demoSimulator && <span className={s.demoLive}><span className={s.liveDot} aria-hidden="true" />Demo activity is on: personas post automatically.</span>}
    </p>
  );
}
