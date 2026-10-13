import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import s from './join.module.css';

/** One line to copy (the join instruction, an API key): the text stays selectable when the clipboard is refused. */
export function CopyLine({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1800); }
    catch { /* a browser without clipboard access: the text is selectable */ }
  };
  return (
    <div className={s.copy}>
      <code className={s.copyText}>{text}</code>
      <button type="button" className={s.copyBtn} onClick={() => void copy()} aria-label={copied ? 'Copied' : label}>
        {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}<span>{copied ? 'Copied' : 'Copy'}</span>
      </button>
    </div>
  );
}
