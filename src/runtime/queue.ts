import {PlantUmlError, toError} from './errors.js';

/**
 * The PlantUML engine keeps its in-flight render state in module-level globals, so two
 * overlapping calls corrupt each other: in a browser spike, three concurrent
 * `renderToString` calls produced exactly one callback and two permanent hangs.
 *
 * Every render therefore goes through this module-level FIFO queue, which runs one task at
 * a time and always advances — a rejected, timed-out or aborted task can never wedge it.
 */

export interface EnqueueOptions {
  /** Reject the task if it has not settled this many milliseconds after it started. */
  timeoutMs: number;
  /** Drop the task before it starts, and stop waiting for it once it has. */
  signal?: AbortSignal;
}

interface QueueEntry {
  start: () => void;
}

const pending: QueueEntry[] = [];
let active = false;

function pump(): void {
  if (active) return;
  const next = pending.shift();
  if (!next) return;
  active = true;
  next.start();
}

/**
 * Queues `task` behind every previously queued task.
 *
 * `task` receives a signal that is aborted on timeout or caller abort, so long-running
 * work can bail out instead of writing into a discarded render.
 */
export function enqueueRender<T>(
  task: (signal: AbortSignal) => Promise<T>,
  options: EnqueueOptions,
): Promise<T> {
  const {timeoutMs, signal} = options;

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    let advanced = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    const onExternalAbort = () => {
      controller.abort();
      // Deliberately does not advance the queue: the engine may still be mid-render, and
      // starting the next diagram now would reintroduce the concurrency corruption.
      settleWith(() => reject(new PlantUmlError('aborted', 'Render aborted.')));
    };

    function settleWith(fn: () => void): void {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onExternalAbort);
      fn();
    }

    /** Releases the single execution slot. Idempotent, so timeout + late settle is safe. */
    function advance(): void {
      if (advanced) return;
      advanced = true;
      active = false;
      // Yield so a synchronously-resolving task cannot grow the stack without bound.
      queueMicrotask(pump);
    }

    if (signal?.aborted) {
      // Never occupy a queue slot for work whose result is already unwanted.
      reject(new PlantUmlError('aborted', 'Render aborted before it started.'));
      return;
    }
    signal?.addEventListener('abort', onExternalAbort, {once: true});

    pending.push({
      start: () => {
        if (settled) {
          advance();
          return;
        }

        timer = setTimeout(() => {
          controller.abort();
          settleWith(() =>
            reject(
              new PlantUmlError('timeout', `PlantUML rendering timed out after ${timeoutMs} ms.`),
            ),
          );
          // A hung engine call must not block every later diagram on the page.
          advance();
        }, timeoutMs);

        let taskPromise: Promise<T>;
        try {
          taskPromise = task(controller.signal);
        } catch (error) {
          settleWith(() => reject(toError(error)));
          advance();
          return;
        }

        void taskPromise.then(
          (value) => {
            settleWith(() => resolve(value));
            advance();
          },
          (error: unknown) => {
            settleWith(() => reject(toError(error)));
            advance();
          },
        );
      },
    });

    pump();
  });
}

/** Number of tasks waiting to start. Exposed for tests and diagnostics. */
export function pendingRenderCount(): number {
  return pending.length;
}

/** Whether a task is currently running. Exposed for tests and diagnostics. */
export function isRenderActive(): boolean {
  return active;
}

/** Test-only: drops queued work and clears the active flag. */
export function resetRenderQueue(): void {
  pending.length = 0;
  active = false;
}
