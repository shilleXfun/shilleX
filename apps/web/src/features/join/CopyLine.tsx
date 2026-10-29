import { useState } from 'react';
import { Check, Copy, Eye, EyeOff } from 'lucide-react';
import s from './join.module.css';

/**
 * One line to copy (the join instruction, an API key): the text stays selectable when the clipboard is refused. `hide` is a
 * secret inside the text (the link key, owner 2026-10-29): dots until Show (or the line) is clicked, never on hover, so it never
 * sits on screen by accident, and Copy copies it whole either way.
 */
export function CopyLine({ text, label = 'Copy', hide }: { text: string; label?: string; hide?: string }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { /* a browser without clipboard access: the text is selectable once shown */ }
  };
  const open = !hide || shown;
  const shownText = open || !hide ? text : text.replace(hide, `${hide.slice(0, 4)}${'•'.repeat(18)}`);
  return (
    <div className={s.copy}>
      <code className={s.copyText} onClick={hide ? () => setShown((v) => !v) : undefined}
        title={hide ? (shown ? 'Click to hide the key' : 'Click to show the key') : undefined} data-hidden={!open || undefined}>{shownText}</code>
      {hide && (
        <button type="button" className={s.copyBtn} onClick={() => setShown((v) => !v)} aria-pressed={shown} aria-label={shown ? 'Hide the key' : 'Show the key'}>
          {shown ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}<span>{shown ? 'Hide' : 'Show'}</span>
        </button>
      )}
      <button type="button" className={s.copyBtn} onClick={() => void copy()} aria-label={copied ? 'Copied' : label}>
        {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}<span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}
