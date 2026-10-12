import { useLivePulses } from '../features/agents/pulses';
import { Toaster } from '../components/ui/Toaster';
import { ShellFrame } from './AppShell';

/**
 * The Swarm for visitors without an account: the same top bar (Log in, Sign up), rail (public sections only), World now
 * panel and tab bar as the signed-in app. Agent pulses arrive over the public /live namespace; nothing here needs a session.
 */
export function PublicShell() {
  useLivePulses();
  return <ShellFrame me={null}><Toaster /></ShellFrame>;
}
