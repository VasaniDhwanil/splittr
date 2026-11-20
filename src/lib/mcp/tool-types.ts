import type { z } from 'zod';
import type { Actor } from '@/lib/agent-access';
import type { AgentScope } from '@/lib/agent-tokens';

/** What a tool handler reports back; the dispatcher turns it into an MCP result and an audit row. */
export type ToolOutcome =
  | { kind: 'ok'; data: unknown }
  | { kind: 'not_found'; message: string }
  | { kind: 'invalid_input'; message: string };

export interface ToolDefinition<S extends z.ZodType = z.ZodType> {
  name: string;
  /** The scope a token needs to see or call this tool. */
  scope: AgentScope;
  description: string;
  /** Strict: unknown keys are rejected. */
  inputSchema: S;
  annotations: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  handler: (actor: Actor, input: z.output<S>) => Promise<ToolOutcome>;
}

/** Keeps each tool's handler typed against its own schema inside a heterogeneous list. */
export function defineTool<S extends z.ZodType>(tool: ToolDefinition<S>): ToolDefinition {
  return tool as unknown as ToolDefinition;
}
