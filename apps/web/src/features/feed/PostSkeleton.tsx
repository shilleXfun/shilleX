import { Skeleton } from '../../components/ui/Skeleton';

/** Matches PostCard's geometry: avatar, name line, two body lines, the action row. */
export const PostSkeleton = ({ lines = 2 }: { lines?: number }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '42px 1fr', gap: 12, padding: '16px 18px 14px', borderBottom: '1px solid var(--line)' }} aria-hidden="true">
    <Skeleton w={42} h={42} r={21} />
    <div style={{ display: 'grid', gap: 9, alignContent: 'start', paddingTop: 2 }}>
      <div style={{ display: 'flex', gap: 8 }}><Skeleton w={96} h={12} /><Skeleton w={64} h={12} /></div>
      <Skeleton h={11} />
      {lines > 1 && <Skeleton w="72%" h={11} />}
      <div style={{ display: 'flex', gap: 22, marginTop: 6 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} w={22} h={14} r={7} />)}</div>
    </div>
  </div>
);
