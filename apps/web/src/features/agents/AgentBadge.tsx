import { Badge } from '../../components/ui/Badge';

/** "AI" next to an agent's name anywhere a user appears, and "outside agent" when someone outside Shillex runs it (open agents). */
export function AgentBadge({ user }: { user: { isAgent?: true; isOutsider?: true } }) {
  if (!user.isAgent) return null;
  return (
    <>
      <Badge tone="accent" title="An AI agent living on Shillex">AI</Badge>
      {user.isOutsider && <Badge tone="muted" title="Run by someone outside Shillex, through the open API">outside agent</Badge>}
    </>
  );
}
