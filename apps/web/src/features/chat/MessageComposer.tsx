import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ImagePlus, Reply, SendHorizontal, Timer, X } from 'lucide-react';
import { agentName, LIMITS, abbreviateMintsIn, codePointLength, type MessageView, type ScopeRef, type UploadView } from '@shillex/shared';
import { errorMessage, retryAfterSec, uploadImage } from '../../lib/api';
import { useMediaQuery } from '../../lib/useMediaQuery';
import { useImageDrop } from '../../lib/useImageDrop';
import { useDraft } from '../../lib/drafts';
import { AltTextButton } from '../../components/ui/AltTextButton';
import { useRequiredMe } from '../../lib/useMe';
import { cx } from '../../lib/cx';
import { dur, ease, spring } from '../../lib/motion';
import { IconButton } from '../../components/ui/Button';
import { toast } from '../../components/ui/Toaster';
import { TokenMention } from '../tokens/TokenMention';
import type { SendAttachment } from './useChatScope';
import s from './chat.module.css';

/**
 * Chat input: Enter sends, Shift+Enter breaks a line, Esc cancels a reply. Slow mode starts a visible countdown after
 * each send (moderators are exempt); a server SLOW_MODE/rate-limit answer starts it from Retry-After.
 */
export function MessageComposer({ scope, onSend, disabledReason, slowModeSeconds, isMod, replyTo, onCancelReply, onTyping, placeholder, tokenCard, onClearTokenCard }: {
  scope: ScopeRef; onSend: (body: string, opts: { replyTo?: MessageView | null; attachments?: SendAttachment[] }) => Promise<boolean>;
  disabledReason?: ReactNode; slowModeSeconds: number; isMod: boolean; replyTo: MessageView | null; onCancelReply: () => void; onTyping: () => void; placeholder: string;
  tokenCard?: string | null; onClearTokenCard?: () => void;
}) {
  const me = useRequiredMe();
  // Each conversation or channel keeps its own unsent text, per account.
  const [text, setText] = useDraft(`${me.id}:chat:${scope.type}:${scope.id}`);
  const touch = useMediaQuery('(pointer: coarse)');
  const [uploads, setUploads] = useState<UploadView[]>([]);
  const [alts, setAlts] = useState<Record<string, string>>({});
  // Slow mode counts down to a deadline (not chained one-second timeouts), so it stays right in a throttled tab.
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [cooldownFrom, setCooldownFrom] = useState(0);
  const [cooldown, setCooldown] = useState(0);
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!cooldownUntil) return;
    const tick = () => { const left = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000)); setCooldown(left); if (!left) setCooldownUntil(0); };
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [cooldownUntil]);
  useEffect(() => { if (replyTo) area.current?.focus(); }, [replyTo]);
  useEffect(() => { const el = area.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 160)}px`; }, [text]);
  useEffect(() => { setUploads([]); }, [scope.type, scope.id]);

  const len = codePointLength(text);
  const blocked = cooldown > 0 && !isMod;
  const can = !blocked && len <= LIMITS.messageMax && (text.trim().length > 0 || uploads.length > 0 || !!tokenCard);
  const startCooldown = (sec: number) => { setCooldownFrom(sec); setCooldown(sec); setCooldownUntil(Date.now() + sec * 1000); };

  async function submit() {
    if (!can) return;
    const body = text.trim();
    const attachments: SendAttachment[] = [...uploads.map((u) => ({ type: 'image' as const, uploadId: u.id, alt: alts[u.id] || undefined })), ...(tokenCard ? [{ type: 'token' as const, mint: tokenCard }] : [])];
    setText(''); setUploads([]); setAlts({}); onClearTokenCard?.(); onCancelReply();
    try {
      const ok = await onSend(body, { replyTo, attachments: attachments.length ? attachments : undefined });
      if (ok && slowModeSeconds > 0 && !isMod) startCooldown(slowModeSeconds);
    } catch (e) {
      const ra = retryAfterSec(e);
      if (ra) startCooldown(ra);
    }
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Touch keyboards: Enter is a newline and the send button sends, as in other mobile chat apps.
    if (e.key === 'Enter' && !e.shiftKey && !touch && !e.nativeEvent.isComposing) { e.preventDefault(); void submit(); }
    if (e.key === 'Escape' && replyTo) { e.preventDefault(); onCancelReply(); }
  };
  async function addFiles(files: FileList | File[] | null) {
    for (const f of [...(files ?? [])].slice(0, LIMITS.maxImages - uploads.length)) {
      try { const u = await uploadImage(f); setUploads((x) => [...x, u]); } catch (e) { toast(errorMessage(e), { tone: 'error' }); }
    }
  }

  const drop = useImageDrop((fs) => void addFiles(fs));
  if (disabledReason) return <div className={s.composer}><div className={s.disabled}>{disabledReason}</div></div>;
  const near = len > LIMITS.messageMax - 200;
  return (
    <div className={s.composer} data-drop={drop.over || undefined} {...drop.handlers}>
      <AnimatePresence initial={false}>
        {replyTo && (
          <motion.div key="reply" className={s.replyBar} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: dur.standard, ease: ease.out }}>
            <span className={s.replyBarText}><Reply size={13} aria-hidden="true" />Replying to <strong>{agentName(replyTo.author)}</strong><span className={s.replySnippet}>{abbreviateMintsIn(replyTo.body).slice(0, 80)}</span></span>
            <IconButton label="Cancel reply" onClick={onCancelReply}><X size={14} /></IconButton>
          </motion.div>
        )}
      </AnimatePresence>
      {(tokenCard || uploads.length > 0) && (
        <div className={s.attachRow}>
          {tokenCard && <span className={s.sharing}>Sharing <TokenMention mint={tokenCard} /><IconButton label="Remove token card" onClick={onClearTokenCard}><X size={13} /></IconButton></span>}
          {uploads.map((u) => (
            <motion.span key={u.id} className={s.attachThumb} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.bouncy}>
              <img src={u.url} alt={alts[u.id] ?? ''} width={52} height={52} />
              <AltTextButton src={u.url} value={alts[u.id] ?? ''} onChange={(alt) => setAlts((a) => ({ ...a, [u.id]: alt }))} />
              <IconButton label="Remove image" className={s.attachRemove} onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))}><X size={12} /></IconButton>
            </motion.span>
          ))}
        </div>
      )}
      <div className={cx(s.inputRow, blocked && s.inputBlocked)}>
        <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
        <IconButton label="Attach images" onClick={() => file.current?.click()} disabled={uploads.length >= LIMITS.maxImages}><ImagePlus size={18} /></IconButton>
        <textarea ref={area} className={s.input} rows={1} value={text} aria-label={placeholder} placeholder={placeholder} enterKeyHint={touch ? 'enter' : 'send'}
          onChange={(e) => { setText(e.target.value); onTyping(); }} onKeyDown={onKey} />
        <IconButton label="Send" className={cx(s.send, can && s.sendReady)} disabled={!can} onClick={() => void submit()}><SendHorizontal size={17} /></IconButton>
        {blocked && cooldownFrom > 0 && (
          // Drains over the cooldown; the text countdown below carries the same information.
          <motion.span key={cooldownFrom} className={s.cooldownBar} aria-hidden="true" initial={{ scaleX: 1 }} animate={{ scaleX: 0 }} transition={{ duration: cooldownFrom, ease: 'linear' }} />
        )}
      </div>
      <div className={s.meta}>
        <span className={blocked ? s.slow : undefined} aria-live="polite">
          {blocked ? <><Timer size={12} aria-hidden="true" />Slow mode · {cooldown}s</>
            : slowModeSeconds > 0 ? `Slow mode: one message every ${slowModeSeconds}s${isMod ? ' (mods exempt)' : ''}` : touch ? null : 'Enter to send · Shift+Enter for a new line'}
        </span>
        {near && <span className={cx(s.count, len > LIMITS.messageMax && s.over)}>{LIMITS.messageMax - len}</span>}
      </div>
    </div>
  );
}
