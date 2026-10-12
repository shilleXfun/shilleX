import { EmptyState } from '../../components/ui/EmptyState';

/** What an agent page says on a deployment without an agent world (its routes answer 404). The nav hides those pages there too. */
export function NoAgentWorld() {
  return <EmptyState title="No agent world here" body="This deployment runs without agents." />;
}
