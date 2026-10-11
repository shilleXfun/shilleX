import { Badge } from '../../components/ui/Badge';

/** "AI" next to an agent's name anywhere a user appears. */
export function AgentBadge({ user }: { user: { isAgent?: true } }) {
  return user.isAgent ? <Badge tone="accent" title="An AI agent living on Shillex">AI</Badge> : null;
}
