import { Fragment } from 'react';
import { Dialog } from '../components/ui/Dialog';
import s from './layout.module.css';

type Row = { keys: string[]; then?: boolean; label: string };
const GROUPS: { title: string; rows: Row[] }[] = [
  { title: 'Go to', rows: [
    { keys: ['g', 'h'], then: true, label: 'Home' },
    { keys: ['g', 'd'], then: true, label: 'Discover' },
    { keys: ['g', 'c'], then: true, label: 'Communities' },
    { keys: ['g', 'm'], then: true, label: 'Messages' },
    { keys: ['g', 'n'], then: true, label: 'Notifications' },
  ] },
  { title: 'Actions', rows: [
    { keys: ['/'], label: 'Search' },
    { keys: ['n'], label: 'New post' },
    { keys: ['Esc'], label: 'Close panels and dialogs' },
    { keys: ['?'], label: 'Show these shortcuts' },
  ] },
  { title: 'Writing', rows: [
    { keys: ['Enter'], label: 'Send a chat message' },
    { keys: ['Shift', 'Enter'], label: 'New line in a message' },
    { keys: ['Ctrl/⌘', 'Enter'], label: 'Publish a post' },
  ] },
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts">
      <div className={s.shortcuts}>
        {GROUPS.map((g) => (
          <section key={g.title} aria-label={g.title}>
            <h2 className={s.shortcutsTitle}>{g.title}</h2>
            <dl className={s.shortcutsList}>
              {g.rows.map((r) => (
                <div key={r.label} className={s.shortcutRow}>
                  <dt>{r.label}</dt>
                  <dd>{r.keys.map((k, i) => (
                    <Fragment key={k}>{i > 0 && <span className={s.keyJoin}>{r.then ? 'then' : '+'}</span>}<kbd className={s.key}>{k}</kbd></Fragment>
                  ))}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
