import { Skeleton } from '../../components/ui/Skeleton';

export const PostSkeleton = () => (
  <div style={{ display: 'grid', gridTemplateColumns: '40px 1fr', gap: 10, padding: '14px 16px', borderBottom: '1px solid var(--line)' }} aria-hidden="true">
    <Skeleton w={40} h={40} r={20} />
    <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}><Skeleton w="40%" /><Skeleton /><Skeleton w="75%" /></div>
  </div>
);
