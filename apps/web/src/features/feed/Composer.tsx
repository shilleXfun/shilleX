import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ImagePlus, X } from 'lucide-react';
import { LIMITS, codePointLength, uniqueMints, type PostView, type ThreadView, type TokenView, type UploadView } from '@shillex/shared';
import { ApiError, errorMessage, post as apiPost, uploadImage } from '../../lib/api';
import { useImageDrop } from '../../lib/useImageDrop';
import { useDraft } from '../../lib/drafts';
import { AltTextButton } from '../../components/ui/AltTextButton';
import { patchPost, prependToFeed } from '../../lib/cache';
import { useRequiredMe } from '../../lib/useMe';
import { cx } from '../../lib/cx';
import { dur, ease, spring } from '../../lib/motion';
import { Avatar } from '../../components/ui/Avatar';
import { Button, IconButton } from '../../components/ui/Button';
import { useInDialog } from '../../components/ui/Dialog';
import { toast } from '../../components/ui/Toaster';
import { primeTokens } from '../tokens/tokenCache';
import { TokenMention } from '../tokens/TokenMention';
import { QuoteEmbed } from './QuoteEmbed';
import s from './Composer.module.css';

export interface ComposerProps {
  mode: 'post' | 'reply' | 'quote';
  parent?: PostView; quote?: PostView; communityId?: string; communitySlug?: string;
  autoFocus?: boolean; placeholder?: string; onPosted?: (p: PostView) => void;
}

export function Composer({ mode, parent, quote, communityId, communitySlug, autoFocus, placeholder, onPosted }: ComposerProps) {
  const me = useRequiredMe();
  const inDialog = useInDialog();
  const qc = useQueryClient();
  // The main post box and each reply box keep unsent text; quotes (in a dialog) don't.
  const draftKey = mode === 'post' && !inDialog ? `${me.id}:post:${communityId ?? 'home'}` : mode === 'reply' && parent ? `${me.id}:reply:${parent.id}` : null;
  const [text, setText] = useDraft(draftKey);
  const [uploads, setUploads] = useState<UploadView[]>([]);
  const [alts, setAlts] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [done, setDone] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const len = codePointLength(text);
  const remaining = LIMITS.postMax - len;
  const mints = uniqueMints(text);
  const canSubmit = !busy && uploading === 0 && remaining >= 0 && (text.trim().length > 0 || (mode !== 'quote' && uploads.length > 0));

  useEffect(() => { if (autoFocus) area.current?.focus(); }, [autoFocus]);
  useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(false), 1200); return () => clearTimeout(t); }, [done]);
  useEffect(() => { const el = area.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }, [text]);

  async function addFiles(files: FileList | File[] | null) {
    if (!files) return;
    const room = LIMITS.maxImages - uploads.length - uploading;
    if (files.length > room) toast(`Up to ${LIMITS.maxImages} images per post`, { tone: 'error' });
    for (const f of [...files].slice(0, Math.max(0, room))) {
      setUploading((n) => n + 1);
      try { const u = await uploadImage(f); setUploads((x) => [...x, u]); }
      catch (e) { toast(errorMessage(e), { tone: 'error' }); }
      finally { setUploading((n) => n - 1); }
    }
  }

  // Quotes carry no images, so pasting or dropping one there does nothing.
  const drop = useImageDrop((fs) => void addFiles(fs), mode !== 'quote');

  async function submit() {
    if (!canSubmit) return;
    setBusy(true); setError(null);
    try {
      const r = await apiPost<{ post: PostView; tokens: Record<string, TokenView> }>('/posts', {
        body: text, uploadIds: uploads.map((u) => u.id), alts: uploads.map((u) => alts[u.id] ?? ''), parentId: parent?.id, quoteOfId: quote?.id, communityId,
      });
      primeTokens(qc, r.tokens);
      if (mode === 'reply' && parent) {
        qc.setQueriesData<ThreadView>({ queryKey: ['thread'] }, (t) => t && (t.post.id === parent.id ? { ...t, replies: [...t.replies, r.post] } : t));
        patchPost(qc, parent.id, (p) => ({ ...p, counts: { ...p.counts, replies: p.counts.replies + 1 } }));
      } else if (communitySlug) {
        prependToFeed(qc, ['communityThreads', communitySlug], r.post);
      } else {
        prependToFeed(qc, ['feed', 'following'], r.post);
        if (quote) patchPost(qc, quote.id, (p) => ({ ...p, counts: { ...p.counts, quotes: p.counts.quotes + 1 } }));
      }
      void qc.invalidateQueries({ queryKey: ['userPosts', me.username] });
      setText(''); setUploads([]); setAlts({}); setDone(true);
      onPosted?.(r.post);
      if (mode !== 'post') toast(mode === 'reply' ? 'Reply posted' : 'Quote posted', { tone: 'success' });
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'RATE_LIMITED' ? 'You’re posting a lot — wait a moment and try again.' : errorMessage(e));
    } finally { setBusy(false); }
  }

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); } };
  const expanded = focused || text.length > 0 || uploads.length > 0 || uploading > 0;
  const label = mode === 'reply' ? 'Write your reply' : mode === 'quote' ? 'Add your take' : 'What’s happening in the trenches? Post';

  return (
    <div className={cx(s.composer, inDialog && s.inDialog, expanded && s.active)} data-drop={drop.over || undefined} {...drop.handlers}>
      <Avatar src={me.avatarUrl} size={inDialog ? 36 : 42} me />
      <div className={s.main}>
        {/* Grows on focus (min-height springs open); the auto-size effect handles longer text. */}
        <motion.textarea ref={area} className={s.textarea} value={text} onChange={(e) => { setText(e.target.value); setError(null); }} onKeyDown={onKey}
          onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} initial={false} animate={{ minHeight: expanded ? 96 : 48 }} transition={spring.soft}
          data-shortcut={mode === 'post' && !inDialog ? 'compose' : undefined} aria-label={label} placeholder={placeholder ?? (mode === 'reply' ? 'Post your reply' : mode === 'quote' ? 'Add your take…' : 'What’s happening in the trenches? Paste a CA to tag a token.')} rows={2} />
        <AnimatePresence initial={false}>
          {mints.length > 0 && (
            <motion.div className={s.chips} aria-live="polite" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} transition={{ duration: dur.standard, ease: ease.out }}>
              <span className={s.chipsLabel}>Tagged tokens</span>{mints.map((m) => <TokenMention key={m} mint={m} />)}
            </motion.div>
          )}
        </AnimatePresence>
        {quote && <QuoteEmbed post={quote} />}
        {(uploads.length > 0 || uploading > 0) && (
          <div className={s.uploads}>
            {uploads.map((u) => (
              <motion.div key={u.id} className={s.thumb} initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={spring.bouncy}><img src={u.url} alt={alts[u.id] ?? ''} />
                <AltTextButton src={u.url} value={alts[u.id] ?? ''} onChange={(alt) => setAlts((a) => ({ ...a, [u.id]: alt }))} />
                <IconButton label="Remove image" className={s.thumbRemove} onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))}><X size={14} /></IconButton></motion.div>
            ))}
            {uploading > 0 && <div className={cx(s.thumb, s.uploading)} role="status" aria-label="Uploading image" />}
          </div>
        )}
        {error && <div className={s.error} role="alert">{error}</div>}
        <div className={s.bar}>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
          <IconButton label="Add images" disabled={uploads.length + uploading >= LIMITS.maxImages || mode === 'quote'} onClick={() => file.current?.click()}><ImagePlus size={18} /></IconButton>
          <span className={s.count}><CharRing used={len} />
            <span className={cx(s.countText, remaining <= 20 && s.over)} aria-live="polite">{remaining <= 100 ? remaining : ''}</span>
          </span>
          <Button variant="primary" size="sm" className={s.submit} disabled={!canSubmit} loading={busy} done={done} onClick={submit}>{mode === 'reply' ? 'Reply' : 'Post'}</Button>
        </div>
      </div>
    </div>
  );
}

/** Circular progress toward the post limit: violet, then --warn in the last 100, --down in the last 20 and over. */
function CharRing({ used }: { used: number }) {
  const r = 9, c = 2 * Math.PI * r;
  const left = LIMITS.postMax - used;
  const tone = left <= 20 ? 'var(--down)' : left <= 100 ? 'var(--warn)' : 'var(--accent)';
  if (!used) return null;
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" className={s.ring}>
      <circle cx="12" cy="12" r={r} fill="none" stroke="var(--line-strong)" strokeWidth="2.5" />
      <motion.circle cx="12" cy="12" r={r} fill="none" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={c}
        initial={false} animate={{ strokeDashoffset: c * (1 - Math.min(1, used / LIMITS.postMax)), stroke: tone, scale: left <= 20 ? 1.15 : 1 }}
        transition={spring.snappy} style={{ rotate: -90, originX: '50%', originY: '50%' }} />
    </svg>
  );
}
