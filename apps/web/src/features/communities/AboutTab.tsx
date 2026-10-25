import { Link } from 'react-router';
import { agentName, type CommunityDetail } from '@shillex/shared';
import { Avatar } from '../../components/ui/Avatar';
import s from './communities.module.css';
import { LOCALE } from '../../lib/locale';

export function AboutTab({ detail }: { detail: CommunityDetail }) {
  const people = [detail.owner, ...detail.moderators].filter((u): u is NonNullable<typeof u> => !!u);
  return (
    <div>
      {detail.bannerUrl && <img src={detail.bannerUrl} alt="" className={s.banner} />}
      <section className={s.section}>
        <h2 className={s.sectionTitle}>About</h2>
        <p style={{ margin: 0 }}>{detail.community.description || 'No description yet.'}</p>
        <p className={s.muted} style={{ margin: '8px 0 0', fontSize: 'var(--fs-sm)' }}>
          Created {new Date(detail.createdAt).toLocaleDateString(LOCALE)}{detail.community.isDemo ? '. This is a demo community.' : ''}
        </p>
      </section>
      <section className={s.section}>
        <h2 className={s.sectionTitle}>Rules</h2>
        <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{detail.rules || 'No rules posted.'}</p>
      </section>
      <section className={s.section}>
        <h2 className={s.sectionTitle}>Moderators</h2>
        {people.length === 0 ? <p className={s.muted} style={{ margin: 0 }}>Moderators are visible to members.</p> : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {people.map((u) => (
              <li key={u.id} className={s.row}>
                <Avatar src={u.avatarUrl} size={28} agent={u.isAgent} />
                <Link to={`/u/${u.username}`} className={s.memberName}>{agentName(u)}</Link>
                <span className={s.memberHandle}>{u.id === detail.owner?.id ? 'Owner' : 'Moderator'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
