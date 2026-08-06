import {describe, expect, it, vi} from 'vitest';

import {PlantUmlError} from '../../src/runtime/errors.js';
import {enqueueRender, isRenderActive, pendingRenderCount} from '../../src/runtime/queue.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('serialized render queue', () => {
  it('runs tasks strictly one at a time', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const task = async () => {
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 5));
      concurrent -= 1;
      return 'ok';
    };

    await Promise.all(Array.from({length: 5}, () => enqueueRender(task, {timeoutMs: 1_000})));

    expect(maxConcurrent).toBe(1);
  });

  it('completes tasks in FIFO order regardless of how long each takes', async () => {
    const order: number[] = [];
    const durations = [30, 1, 20, 1];

    const results = await Promise.all(
      durations.map((duration, index) =>
        enqueueRender(
          async () => {
            await new Promise((resolve) => setTimeout(resolve, duration));
            order.push(index);
            return index;
          },
          {timeoutMs: 1_000},
        ),
      ),
    );

    expect(order).toEqual([0, 1, 2, 3]);
    expect(results).toEqual([0, 1, 2, 3]);
  });

  it('keeps processing after a task rejects', async () => {
    const outcomes: string[] = [];

    const failing = enqueueRender(() => Promise.reject(new Error('boom')), {timeoutMs: 1_000});
    const following = enqueueRender(() => Promise.resolve('second'), {timeoutMs: 1_000});

    await expect(failing).rejects.toThrow('boom');
    outcomes.push('rejected');
    expect(await following).toBe('second');
    outcomes.push('resolved');

    expect(outcomes).toEqual(['rejected', 'resolved']);
    expect(isRenderActive()).toBe(false);
    expect(pendingRenderCount()).toBe(0);
  });

  it('keeps processing when a task throws synchronously', async () => {
    const throwing = enqueueRender(
      () => {
        throw new Error('sync boom');
      },
      {timeoutMs: 1_000},
    );
    await expect(throwing).rejects.toThrow('sync boom');
    expect(await enqueueRender(() => Promise.resolve('after'), {timeoutMs: 1_000})).toBe('after');
  });

  it('supports many diagrams queued at once', async () => {
    const results = await Promise.all(
      Array.from({length: 25}, (_unused, index) =>
        enqueueRender(() => Promise.resolve(index), {timeoutMs: 1_000}),
      ),
    );
    expect(results).toEqual(Array.from({length: 25}, (_unused, index) => index));
    expect(pendingRenderCount()).toBe(0);
  });
});

describe('queue timeouts', () => {
  it('rejects a task that never settles and reports the limit', async () => {
    vi.useFakeTimers();
    try {
      const hanging = enqueueRender(() => new Promise<string>(() => {}), {timeoutMs: 50});
      const assertion = expect(hanging).rejects.toThrow(/timed out after 50 ms/);
      await vi.advanceTimersByTimeAsync(60);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('releases the queue after a timeout so later diagrams still render', async () => {
    const hanging = enqueueRender(() => new Promise<string>(() => {}), {timeoutMs: 20});
    const following = enqueueRender(() => Promise.resolve('later'), {timeoutMs: 1_000});

    await expect(hanging).rejects.toBeInstanceOf(PlantUmlError);
    expect(await following).toBe('later');
  });

  it('aborts the signal handed to a timed-out task', async () => {
    let observed: AbortSignal | undefined;
    const hanging = enqueueRender(
      (signal) => {
        observed = signal;
        return new Promise<string>(() => {});
      },
      {timeoutMs: 20},
    );

    await expect(hanging).rejects.toThrow(/timed out/);
    expect(observed?.aborted).toBe(true);
  });

  it('does not reject a task that settles before its timeout', async () => {
    const result = await enqueueRender(() => Promise.resolve('fast'), {timeoutMs: 5_000});
    expect(result).toBe('fast');
    await flush();
    expect(isRenderActive()).toBe(false);
  });
});

describe('aborting queued work', () => {
  it('never starts a task whose signal is already aborted', async () => {
    const task = vi.fn(() => Promise.resolve('unused'));
    const controller = new AbortController();
    controller.abort();

    await expect(
      enqueueRender(task, {timeoutMs: 1_000, signal: controller.signal}),
    ).rejects.toThrow(/aborted before it started/);
    expect(task).not.toHaveBeenCalled();
    expect(pendingRenderCount()).toBe(0);
  });

  it('rejects a queued task that is aborted before it runs, without occupying the queue', async () => {
    const blocker = deferred<string>();
    const first = enqueueRender(() => blocker.promise, {timeoutMs: 5_000});

    const controller = new AbortController();
    const secondTask = vi.fn(() => Promise.resolve('second'));
    const second = enqueueRender(secondTask, {timeoutMs: 5_000, signal: controller.signal});
    const third = enqueueRender(() => Promise.resolve('third'), {timeoutMs: 5_000});

    controller.abort();
    await expect(second).rejects.toThrow(/Render aborted/);

    blocker.resolve('first');
    expect(await first).toBe('first');
    expect(await third).toBe('third');
    expect(secondTask).not.toHaveBeenCalled();
  });

  it('lets a component ignore a result after unmounting mid-render', async () => {
    const controller = new AbortController();
    const inFlight = deferred<string>();

    const promise = enqueueRender(() => inFlight.promise, {
      timeoutMs: 5_000,
      signal: controller.signal,
    });

    // The component unmounts while the engine is still working.
    controller.abort();
    await expect(promise).rejects.toMatchObject({kind: 'aborted'});

    // The engine eventually finishes; nothing observes it, and the queue recovers.
    inFlight.resolve('late result');
    await flush();
    expect(await enqueueRender(() => Promise.resolve('next'), {timeoutMs: 1_000})).toBe('next');
  });
});
