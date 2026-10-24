export class ModelEvaluationTimeout extends Error {
  constructor() { super('The model comparison reached its execution budget.'); this.name = 'ModelEvaluationTimeout'; }
}

/** Also bounds adapters that ignore AbortSignal. No raw provider error is exposed. */
export async function withModelDeadline<T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number, parent?: AbortSignal): Promise<T> {
  if (parent?.aborted || timeoutMs <= 0) throw new ModelEvaluationTimeout();
  const controller = new AbortController();
  const signal = parent ? AbortSignal.any([parent, controller.signal]) : controller.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      operation(signal),
      new Promise<never>((_, reject) => {
        onAbort = () => reject(new ModelEvaluationTimeout());
        signal.addEventListener('abort', onAbort, { once: true });
        timer = setTimeout(() => controller.abort(), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
    controller.abort();
  }
}
