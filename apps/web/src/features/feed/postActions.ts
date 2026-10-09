import { useQueryClient } from '@tanstack/react-query';
import type { PostView, ReactionEmoji, UserSummary } from '@shillex/shared';
import { del, errorMessage, post as apiPost, put } from '../../lib/api';
import { patchPost, removePost } from '../../lib/cache';
import { toast } from '../../components/ui/Toaster';

/** Post interactions with optimistic cache updates that roll back (and toast) on failure. Reposts act on the original. */
export function usePostActions(p: PostView) {
  const qc = useQueryClient();
  const target = p.kind === 'repost' && p.reposted ? p.reposted : p;
  const optimistic = async (apply: (x: PostView) => PostView, revert: (x: PostView) => PostView, call: () => Promise<unknown>) => {
    patchPost(qc, target.id, apply);
    try { await call(); } catch (e) { patchPost(qc, target.id, revert); toast(errorMessage(e), { tone: 'error' }); }
  };
  return {
    target,
    react: (emoji: ReactionEmoji) => {
      const had = target.reactions.find((r) => r.emoji === emoji)?.mine ?? false;
      const toggle = (on: boolean) => (x: PostView): PostView => {
        const list = [...x.reactions];
        const i = list.findIndex((r) => r.emoji === emoji);
        if (i === -1 && on) list.push({ emoji, count: 1, mine: true });
        else if (i !== -1) { const r = list[i]!; const count = r.count + (on ? 1 : -1); if (count <= 0) list.splice(i, 1); else list[i] = { ...r, count, mine: on }; }
        return { ...x, reactions: list };
      };
      const path = `/posts/${target.id}/reactions/${encodeURIComponent(emoji)}`;
      return optimistic(toggle(!had), toggle(had), () => (had ? del(path) : put(path)));
    },
    toggleBookmark: () => {
      const on = !target.viewer.bookmarked;
      const set = (v: boolean) => (x: PostView) => ({ ...x, viewer: { ...x.viewer, bookmarked: v } });
      return optimistic(set(on), set(!on), async () => {
        await (on ? put(`/posts/${target.id}/bookmark`) : del(`/posts/${target.id}/bookmark`));
        toast(on ? 'Saved to bookmarks' : 'Removed from bookmarks');
        void qc.invalidateQueries({ queryKey: ['bookmarks'] });
      });
    },
    toggleRepost: () => {
      const on = !target.viewer.reposted;
      const set = (v: boolean) => (x: PostView) => ({ ...x, viewer: { ...x.viewer, reposted: v }, counts: { ...x.counts, reposts: x.counts.reposts + (v ? 1 : -1) } });
      return optimistic(set(on), set(!on), async () => {
        await (on ? apiPost(`/posts/${target.id}/repost`) : del(`/posts/${target.id}/repost`));
        void qc.invalidateQueries({ queryKey: ['feed', 'following'] });
      });
    },
    toggleSubscribe: () => {
      const on = !target.viewer.subscribed;
      const set = (v: boolean) => (x: PostView) => ({ ...x, viewer: { ...x.viewer, subscribed: v } });
      return optimistic(set(on), set(!on), async () => {
        await (on ? put(`/posts/${target.id}/subscription`) : del(`/posts/${target.id}/subscription`));
        toast(on ? 'You’ll be notified about replies and call updates' : 'Unsubscribed');
      });
    },
    remove: async () => {
      try { await del(`/posts/${target.id}`); removePost(qc, target.id); toast('Post deleted'); }
      catch (e) { toast(errorMessage(e), { tone: 'error' }); }
    },
    copyLink: async () => {
      try { await navigator.clipboard.writeText(`${location.origin}/p/${target.id}`); toast('Link copied', { tone: 'success' }); }
      catch { toast('Couldn’t copy link', { tone: 'error' }); }
    },
  };
}

export function useUserActions(u: UserSummary) {
  const qc = useQueryClient();
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      void qc.invalidateQueries({ queryKey: ['profile', u.username] });
      void qc.invalidateQueries({ queryKey: ['feed'] });
      void qc.invalidateQueries({ queryKey: ['sidebar'] });
    } catch (e) { toast(errorMessage(e), { tone: 'error' }); }
  };
  return {
    follow: (on: boolean) => run(() => (on ? put(`/users/${u.username}/follow`) : del(`/users/${u.username}/follow`)), on ? `Following @${u.username}` : `Unfollowed @${u.username}`),
    mute: (on: boolean) => run(() => (on ? put(`/users/${u.username}/mute`) : del(`/users/${u.username}/mute`)), on ? `Muted @${u.username}` : `Unmuted @${u.username}`),
    block: (on: boolean) => run(() => (on ? put(`/users/${u.username}/block`) : del(`/users/${u.username}/block`)), on ? `Blocked @${u.username}` : `Unblocked @${u.username}`),
  };
}
