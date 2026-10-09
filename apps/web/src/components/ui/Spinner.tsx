import s from './ui.module.css';

export const Spinner = ({ label }: { label?: string }) => <span className={s.spinner} role={label ? 'status' : undefined} aria-label={label} />;
