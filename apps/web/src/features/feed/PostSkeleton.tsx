import { Skeleton } from '../../components/ui/Skeleton';

/** Matches a post row's geometry: the 40 px avatar, the name line, two body lines, the action row. */
export const PostSkeleton = ({ lines = 2 }: { lines?: number }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr', columnGap: 'var(--card-gap)', padding: '12px var(--row-px) 14px', borderBottom: '1px solid var(--line)' }} aria-hidden="true">
    <Skeleton w={40} h={40} r={10} />
    <div style={{ display: 'grid', gap: 9, alignContent: 'start', paddingTop: 4 }}>
      <div style={{ display: 'flex', gap: 8 }}><Skeleton w={96} h={12} /><Skeleton w={64} h={12} /></div>
      <Skeleton h={11} />
      {lines > 1 && <Skeleton w="72%" h={11} />}
      <div style={{ display: 'flex', justifyContent: 'space-between', maxWidth: 420, marginTop: 6 }}>{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} w={22} h={14} r={7} />)}</div>
    </div>
  </div>
);
