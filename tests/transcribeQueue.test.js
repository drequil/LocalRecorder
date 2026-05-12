const { createTranscribeQueue } = require('../src/transcribeQueue');

// Helper: a deferred ({ promise, resolve, reject }) so tests can control when
// a job settles and assert on intermediate queue state.
function defer() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Helper: yield to the microtask queue so .then callbacks attached just before
// us get a chance to run. setImmediate is heavier-handed but reliably crosses
// the microtask boundary even after multiple chained .thens.
function flushMicrotasks() {
  return new Promise((r) => setImmediate(r));
}

describe('createTranscribeQueue argument validation', () => {
  test('throws when `run` is missing', () => {
    expect(() => createTranscribeQueue({})).toThrow(/`run` must be a function/);
  });

  test('throws when `run` is not a function', () => {
    expect(() => createTranscribeQueue({ run: 'nope' })).toThrow(/`run` must be a function/);
  });

  test('throws when onSuccess is not a function', () => {
    expect(() => createTranscribeQueue({ run: () => {}, onSuccess: 42 }))
      .toThrow(/onSuccess` must be a function/);
  });

  test('throws when onFailure is not a function', () => {
    expect(() => createTranscribeQueue({ run: () => {}, onFailure: 'bad' }))
      .toThrow(/onFailure` must be a function/);
  });

  test('accepts a minimal { run } config', () => {
    expect(() => createTranscribeQueue({ run: () => {} })).not.toThrow();
  });
});

describe('idle queue behaviour', () => {
  test('length is 0 on a fresh queue', () => {
    const q = createTranscribeQueue({ run: () => {} });
    expect(q.length).toBe(0);
  });

  test('drain() resolves immediately on an empty queue', async () => {
    const q = createTranscribeQueue({ run: () => {} });
    const order = [];
    q.drain().then(() => order.push('drained'));
    order.push('after-drain-call');
    await flushMicrotasks();
    expect(order).toEqual(['after-drain-call', 'drained']);
  });
});

describe('happy path', () => {
  test('enqueue resolves with { ok: true, result } when run() returns a value', async () => {
    const q = createTranscribeQueue({ run: async (j) => `result:${j.id}` });
    const out = await q.enqueue({ id: 'A' });
    expect(out).toEqual({ ok: true, result: 'result:A' });
    expect(q.length).toBe(0);
  });

  test('onSuccess fires with (job, result) after each job', async () => {
    const onSuccess = jest.fn();
    const q = createTranscribeQueue({
      run: async (j) => `r:${j.id}`,
      onSuccess,
    });
    await q.enqueue({ id: 'A' });
    await q.enqueue({ id: 'B' });
    expect(onSuccess).toHaveBeenCalledTimes(2);
    expect(onSuccess).toHaveBeenNthCalledWith(1, { id: 'A' }, 'r:A');
    expect(onSuccess).toHaveBeenNthCalledWith(2, { id: 'B' }, 'r:B');
  });

  test('drain() waits for all enqueued jobs', async () => {
    const order = [];
    const q = createTranscribeQueue({
      run: async (j) => {
        await new Promise((r) => setTimeout(r, 5));
        order.push(`done:${j.id}`);
        return j.id;
      },
    });
    q.enqueue({ id: 'A' });
    q.enqueue({ id: 'B' });
    q.enqueue({ id: 'C' });
    await q.drain();
    expect(order).toEqual(['done:A', 'done:B', 'done:C']);
    expect(q.length).toBe(0);
  });
});

describe('serial execution', () => {
  test('B does not start until A settles', async () => {
    const aGate = defer();
    const run = jest.fn()
      .mockImplementationOnce(() => aGate.promise)
      .mockImplementationOnce(async (j) => `r:${j.id}`);

    const q = createTranscribeQueue({ run });
    const aPromise = q.enqueue({ id: 'A' });
    const bPromise = q.enqueue({ id: 'B' });

    // After microtasks flush, only A should be running. B is queued.
    await flushMicrotasks();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenNthCalledWith(1, { id: 'A' });
    expect(q.length).toBe(2);

    aGate.resolve('A-done');
    await aPromise;
    // Once A settles, B's turn arrives on the next microtask boundary.
    await flushMicrotasks();
    expect(run).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenNthCalledWith(2, { id: 'B' });

    await bPromise;
    expect(q.length).toBe(0);
  });

  test('three jobs interleaving completion order matches enqueue order', async () => {
    const observed = [];
    const q = createTranscribeQueue({
      run: async (j) => {
        observed.push(`start:${j.id}`);
        // Intentionally vary delay so that with parallel execution they'd
        // finish out of order; serial execution must still produce A then B
        // then C.
        await new Promise((r) => setTimeout(r, j.delay));
        observed.push(`end:${j.id}`);
        return j.id;
      },
    });

    q.enqueue({ id: 'A', delay: 15 });
    q.enqueue({ id: 'B', delay: 1 });
    q.enqueue({ id: 'C', delay: 8 });

    await q.drain();
    expect(observed).toEqual([
      'start:A', 'end:A',
      'start:B', 'end:B',
      'start:C', 'end:C',
    ]);
  });
});

describe('failure handling', () => {
  test('an error in one job does not block subsequent jobs', async () => {
    const order = [];
    const q = createTranscribeQueue({
      run: async (j) => {
        order.push(`ran:${j.id}`);
        if (j.id === 'A') throw new Error('boom');
        return `r:${j.id}`;
      },
    });
    const a = await q.enqueue({ id: 'A' });
    const b = await q.enqueue({ id: 'B' });
    expect(a).toEqual({ ok: false, error: expect.any(Error) });
    expect(a.error.message).toBe('boom');
    expect(b).toEqual({ ok: true, result: 'r:B' });
    expect(order).toEqual(['ran:A', 'ran:B']);
  });

  test('onFailure fires with (job, error) on failure; onSuccess does not', async () => {
    const onSuccess = jest.fn();
    const onFailure = jest.fn();
    const q = createTranscribeQueue({
      run: async () => { throw new Error('nope'); },
      onSuccess,
      onFailure,
    });
    await q.enqueue({ id: 'X' });
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledTimes(1);
    const [job, err] = onFailure.mock.calls[0];
    expect(job).toEqual({ id: 'X' });
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('nope');
  });

  test('synchronously-thrown errors inside run() are caught the same way', async () => {
    const q = createTranscribeQueue({
      run: () => { throw new Error('sync-fail'); },
    });
    const out = await q.enqueue({ id: 'sync' });
    expect(out.ok).toBe(false);
    expect(out.error.message).toBe('sync-fail');
    expect(q.length).toBe(0);
  });

  test('a throwing onSuccess does not poison the queue', async () => {
    const observed = [];
    const q = createTranscribeQueue({
      run: async (j) => j.id,
      onSuccess: () => { throw new Error('logger boom'); },
    });
    const a = await q.enqueue({ id: 'A' });
    const b = await q.enqueue({ id: 'B' });
    observed.push(a, b);
    expect(observed).toEqual([
      { ok: true, result: 'A' },
      { ok: true, result: 'B' },
    ]);
    expect(q.length).toBe(0);
  });

  test('a throwing onFailure does not poison the queue', async () => {
    const q = createTranscribeQueue({
      run: async () => { throw new Error('inner'); },
      onFailure: () => { throw new Error('outer'); },
    });
    const a = await q.enqueue({ id: 'A' });
    const b = await q.enqueue({ id: 'B' });
    expect(a.ok).toBe(false);
    expect(a.error.message).toBe('inner');
    expect(b.ok).toBe(false);
    expect(q.length).toBe(0);
  });
});

describe('overflow warning (T-5 backpressure)', () => {
  test('does not fire when warnAt is 0 (disabled)', async () => {
    const onOverflow = jest.fn();
    const q = createTranscribeQueue({
      run: async (j) => j.id,
      onOverflow,
      warnAt: 0,
    });
    for (let i = 0; i < 20; i++) q.enqueue({ id: i });
    await q.drain();
    expect(onOverflow).not.toHaveBeenCalled();
  });

  test('fires when pending crosses warnAt from below', async () => {
    const onOverflow = jest.fn();
    const slow = defer();
    const q = createTranscribeQueue({
      run: jest.fn()
        .mockImplementationOnce(() => slow.promise) // hold the first job
        .mockImplementation(async (j) => j.id),
      onOverflow,
      warnAt: 3,
    });
    // Pending values: 1, 2, 3, 4 -> overflow on the 4th enqueue.
    q.enqueue({ id: 'a' });
    q.enqueue({ id: 'b' });
    q.enqueue({ id: 'c' });
    expect(onOverflow).not.toHaveBeenCalled(); // pending=3 is the boundary, not above
    q.enqueue({ id: 'd' });
    expect(onOverflow).toHaveBeenCalledTimes(1);
    expect(onOverflow).toHaveBeenCalledWith(4);
    // Further enqueues while still above warnAt do NOT re-fire (debounced).
    q.enqueue({ id: 'e' });
    q.enqueue({ id: 'f' });
    expect(onOverflow).toHaveBeenCalledTimes(1);

    slow.resolve('a-done');
    await q.drain();
  });

  test('re-arms after pending drains below warnAt and crosses again', async () => {
    const onOverflow = jest.fn();
    const q = createTranscribeQueue({
      run: async (j) => j.id,
      onOverflow,
      warnAt: 2,
    });
    // First overflow burst.
    q.enqueue({ id: 1 });
    q.enqueue({ id: 2 });
    q.enqueue({ id: 3 }); // pending=3 > 2 -> fire
    expect(onOverflow).toHaveBeenCalledTimes(1);
    await q.drain();
    // Second burst -- must fire again because we crossed back below.
    q.enqueue({ id: 4 });
    q.enqueue({ id: 5 });
    q.enqueue({ id: 6 }); // crosses again
    expect(onOverflow).toHaveBeenCalledTimes(2);
    await q.drain();
  });

  test('throwing onOverflow does not poison the queue', async () => {
    const q = createTranscribeQueue({
      run: async (j) => j.id,
      onOverflow: () => { throw new Error('logger boom'); },
      warnAt: 1,
    });
    q.enqueue({ id: 'a' });
    q.enqueue({ id: 'b' }); // triggers overflow
    const r = await q.enqueue({ id: 'c' });
    expect(r).toEqual({ ok: true, result: 'c' });
    await q.drain();
  });

  test('validates warnAt and onOverflow at construction time', () => {
    expect(() => createTranscribeQueue({ run: () => {}, warnAt: -1 }))
      .toThrow(/warnAt.*non-negative/);
    expect(() => createTranscribeQueue({ run: () => {}, warnAt: 'nope' }))
      .toThrow(/warnAt.*non-negative/);
    expect(() => createTranscribeQueue({ run: () => {}, onOverflow: 'bad' }))
      .toThrow(/onOverflow.*function/);
  });
});

describe('length tracking and drain re-arming', () => {
  test('length reflects queued + running jobs', async () => {
    const aGate = defer();
    const bGate = defer();
    const q = createTranscribeQueue({
      run: jest.fn()
        .mockImplementationOnce(() => aGate.promise)
        .mockImplementationOnce(() => bGate.promise),
    });

    expect(q.length).toBe(0);
    q.enqueue({ id: 'A' });
    expect(q.length).toBe(1);
    q.enqueue({ id: 'B' });
    expect(q.length).toBe(2);

    aGate.resolve('A');
    await flushMicrotasks();
    expect(q.length).toBe(1);

    bGate.resolve('B');
    await flushMicrotasks();
    expect(q.length).toBe(0);
  });

  test('drain() captures jobs enqueued after a previous drain settled', async () => {
    const q = createTranscribeQueue({ run: async (j) => j.id });

    await q.enqueue({ id: 'A' });
    await q.drain();
    expect(q.length).toBe(0);

    // Re-arm: enqueue more, drain must wait for them too.
    const ran = [];
    q.enqueue({ id: 'B' }).then(() => ran.push('B'));
    q.enqueue({ id: 'C' }).then(() => ran.push('C'));
    expect(q.length).toBe(2);
    await q.drain();
    expect(ran).toEqual(['B', 'C']);
    expect(q.length).toBe(0);
  });

  test('drain() called between enqueues waits for the jobs added before AND after the drain call', async () => {
    const q = createTranscribeQueue({ run: async (j) => j.id });
    q.enqueue({ id: 'A' });
    const drainPromise = q.drain();
    q.enqueue({ id: 'B' });
    await drainPromise;
    expect(q.length).toBe(0);
  });
});
