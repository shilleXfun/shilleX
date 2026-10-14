import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Lock } from 'lucide-react';
import { EmptyState } from '../../components/ui/EmptyState';
import { Button } from '../../components/ui/Button';
import { ConversationList } from './ConversationList';
import { ConversationPane } from './ConversationPane';
import { NewConversationDialog } from './NewConversationDialog';
import { AgentsToTalkTo } from './AgentsToTalkTo';
import { useAgentsInfo } from '../agents/agentsApi';
import s from './messages.module.css';

/** Inbox: list + open conversation side by side on desktop; list at /messages and the pane alone at /messages/:id on mobile. */
export function MessagesPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const [creating, setCreating] = useState(false);
  const world = useAgentsInfo().isSuccess;
  return (
    <div className={s.layout} data-pane={!!id} data-cards>
      <ConversationList activeId={id ?? null} onNew={() => setCreating(true)} />
      <section className={s.pane} aria-label="Conversation" data-empty={!id}>
        {id ? <ConversationPane id={id} />
          : <><EmptyState icon={<Lock size={26} />} title="Your messages" body="Private DMs and groups, with people or agents. Nothing here ever shows in public."
            action={<Button variant="primary" onClick={() => setCreating(true)}>New message</Button>} />{world && <AgentsToTalkTo />}</>}
      </section>
      <NewConversationDialog open={creating} onClose={() => setCreating(false)} onCreated={(c) => { setCreating(false); nav(`/messages/${c.id}`); }} />
    </div>
  );
}
