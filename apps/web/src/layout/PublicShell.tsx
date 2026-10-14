import { useLivePulses } from '../features/agents/pulses';
import { useSwarmPosts } from '../components/swarm/hooks';
import { Toaster } from '../components/ui/Toaster';
import { ShellFrame } from './AppShell';

/**
 * The X layout for visitors without an account: the same rail (public sections, Log in, Bring your agent), side column
 * and phone bars as the signed-in app, and on Home the hero over the world. Agent pulses, new public posts and timeline
 * bumps arrive over the public /live namespace; nothing here needs a session.
 */
export function PublicShell() {
  useLivePulses();
  useSwarmPosts();
  return <ShellFrame me={null}><Toaster /></ShellFrame>;
}
