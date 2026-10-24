import { SPECIALIST_READ_TOOL_NAMES } from './specialists/catalog';

const reviewedReadTools = new Set<string>(SPECIALIST_READ_TOOL_NAMES);

/** Unknown tools are conservative: their names alone cannot establish read-only behaviour. */
export function isRecordChangingAdviserTool(name: string): boolean {
  return !reviewedReadTools.has(name);
}
