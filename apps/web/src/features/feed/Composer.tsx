import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ImagePlus, X } from 'lucide-react';
import { LIMITS, codePointLength, uniqueMints, type PostView, type ThreadView, type TokenView, type UploadView } from '@shillex/shared';
import { ApiError, errorMessage, post as apiPost, uploadImage } from '../../lib/api';
import { patchPost, prependToFeed } from '../../lib/cache';
import { useRequiredMe } from '../../lib/useMe';
import { cx } from '../../lib/cx';
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
  const [text, setText] = useState('');
  const [uploads, setUploads] = useState<UploadView[]>([]);
  const [uploading, setUploading] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const len = codePointLength(text);
  const remaining = LIMITS.postMax - len;
  const mints = uniqueMints(text);
  const canSubmit = !busy && uploading === 0 && remaining >= 0 && (text.trim().length > 0 || (mode !== 'quote' && uploads.length > 0));

  useEffect(() => { if (autoFocus) area.current?.focus(); }, [autoFocus]);
  useEffect(() => { const el = area.current; if (!el) return; el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }, [text]);

  async function addFiles(files: FileList | null) {
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

  async function submit() {
    if (!canSubmit) return;
    setBusy(true); setError(null);
    try {
      const r = await apiPost<{ post: PostView; tokens: Record<string, TokenView> }>('/posts', {
        body: text, uploadIds: uploads.map((u) => u.id), parentId: parent?.id, quoteOfId: quote?.id, communityId,
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
      setText(''); setUploads([]);
      onPosted?.(r.post);
      if (mode !== 'post') toast(mode === 'reply' ? 'Reply posted' : 'Quote posted', { tone: 'success' });
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'RATE_LIMITED' ? 'You’re posting a lot — wait a moment and try again.' : errorMessage(e));
    } finally { setBusy(false); }
  }

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void submit(); } };
  const label = mode === 'reply' ? 'Write your reply' : mode === 'quote' ? 'Add your take' : 'What’s happening in the trenches? Post';

  return (
    <div className={cx(s.composer, inDialog && s.inDialog)}>
      <Avatar src={me.avatarUrl} size={36} />
      <div className={s.main}>
        <textarea ref={area} className={s.textarea} value={text} onChange={(e) => { setText(e.target.value); setError(null); }} onKeyDown={onKey}
          aria-label={label} placeholder={placeholder ?? (mode === 'reply' ? 'Post your reply' : mode === 'quote' ? 'Add your take…' : 'What’s happening in the trenches? Paste a CA to tag a token.')} rows={2} />
        {mints.length > 0 && (
          <div className={s.chips} aria-live="polite"><span className={s.chipsLabel}>Tokens:</span>{mints.map((m) => <TokenMention key={m} mint={m} />)}</div>
        )}
        {quote && <QuoteEmbed post={quote} />}
        {(uploads.length > 0 || uploading > 0) && (
          <div className={s.uploads}>
            {uploads.map((u) => (
              <div key={u.id} className={s.thumb}><img src={u.url} alt="" />
                <IconButton label="Remove image" onClick={() => setUploads((x) => x.filter((y) => y.id !== u.id))}><X size={14} /></IconButton></div>
            ))}
            {uploading > 0 && <div className={cx(s.thumb, s.uploading)} role="status" aria-label="Uploading image" />}
          </div>
        )}
        {error && <div className={s.error} role="alert">{error}</div>}
        <div className={s.bar}>
          <input ref={file} type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={(e) => { void addFiles(e.target.files); e.target.value = ''; }} />
          <IconButton label="Add images" disabled={uploads.length + uploading >= LIMITS.maxImages || mode === 'quote'} onClick={() => file.current?.click()}><ImagePlus size={18} /></IconButton>
          <span className={cx(s.count, remaining < 0 && s.over)} aria-live="polite">{remaining <= 100 ? remaining : ''}</span>
          <Button variant="primary" size="sm" disabled={!canSubmit} loading={busy} onClick={submit}>{mode === 'reply' ? 'Reply' : 'Post'}</Button>
        </div>
      </div>
    </div>
  );
}
