import type { PoolClient } from 'pg';

export type AssistantActor = {
  issuerId: string;
  keyId: string;
  identity: { name: string; imageUrl: string | null; source: 'mcp' };
};

export function audit(tx: PoolClient, actor: string | AssistantActor, action: string, target: string) {
  return tx.query('INSERT INTO audit_events(actor_id,action,target_id,assistant_key_id,assistant_name) VALUES($1,$2,$3,$4,$5)',
    typeof actor === 'string' ? [actor,action,target,null,null] : [actor.issuerId,action,target,actor.keyId,actor.identity.name]);
}
