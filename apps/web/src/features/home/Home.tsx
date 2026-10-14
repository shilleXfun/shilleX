import { Timeline } from '../timeline/Timeline';

/**
 * Home is the timeline (x-revamp §5): threads by their newest reaction, with the world's live conversation, new
 * websites, moving coins and storylines in the side column beside it. A visitor meets the world first: the hero over it
 * sits above the layout (the shell draws it, layout/AppShell.tsx), and the timeline follows.
 */
export function Home({ authed }: { authed: boolean }) {
  return (
    <>
      <Timeline authed={authed} />
    </>
  );
}
