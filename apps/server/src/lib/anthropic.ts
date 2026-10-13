import Anthropic from '@anthropic-ai/sdk';

/**
 * The Anthropic client every model call goes through. A key that belongs to an organisation rather than to one workspace
 * must name the workspace on every request (Anthropic answers 400 without it): ANTHROPIC_WORKSPACE_ID does that.
 */
export function anthropicClient(apiKey: string, maxRetries: number): Anthropic {
  const workspace = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
  return new Anthropic({ apiKey, maxRetries, ...(workspace ? { defaultHeaders: { 'anthropic-workspace-id': workspace } } : {}) });
}
