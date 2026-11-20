import type { AgentScope } from '@/lib/agent-tokens';
import { readTools } from './read-tools';
import type { ToolDefinition } from './tool-types';
import { writeTools } from './write-tools';

/** Every tool the endpoint knows. A write tool is added here with its own scope. */
export const ALL_TOOLS: ToolDefinition[] = [...readTools, ...writeTools];

/** What a token with these scopes may see and call. */
export function toolsForScopes(scopes: AgentScope[]): ToolDefinition[] {
  return ALL_TOOLS.filter((tool) => scopes.includes(tool.scope));
}
