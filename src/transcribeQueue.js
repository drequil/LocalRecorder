// T-3.1: tiny serial queue for transcription jobs.
//
// Why a queue at all: whisper.cpp on CPU is chunky -- one process pegs a core
// for the wall-clock duration of the audio it consumes (~57% of realtime on
// base.en with the Win32 BLAS build per T-2's smoke). If idleListen rotates
// a new chunk every silence period and we spawned a transcription per chunk
// concurrently, two long chunks back-to-back would saturate both cores and
// race for the same model file mapping. Serialising the jobs through a single
// worker keeps the system honest and the failure modes simple.
//
// Contract:
//   - enqueue(job) returns a Promise<{ ok, result?, error? }> that resolves
//     after the job has been processed. It never rejects -- failures are
//     reported via the resolved value and via onFailure.
//   - Jobs run serially: enqueue(B) does not start until enqueue(A) settles,
//     regardless of A's success or failure.
//   - drain() returns a promise that resolves the next time the queue is
//     observed empty (length === 0). If length is already 0 at call time, the
//     returned promise resolves immediately. Calling enqueue() while a drain
//     promise is pending extends the wait through the new job(s).
//   - length is the count of jobs queued but not yet settled.
//   - onSuccess/onFailure are invoked synchronously after each job settles.
//     Throws inside the loggers are caught so a bad logger cannot wedge the
//     queue.
//
// Out of scope for T-3.1 (deferred to T-5):
//   - Max queue length / backpressure warnings
//   - Retry-on-failure
//   - Skip-empty heuristics

function noop() {}

function createTranscribeQueue({ run, onSuccess = noop, onFailure = noop } = {}) {
  if (typeof run !== 'function') {
    throw new TypeError('createTranscribeQueue: `run` must be a function');
  }
  if (typeof onSuccess !== 'function') {
    throw new TypeError('createTranscribeQueue: `onSuccess` must be a function if provided');
  }
  if (typeof onFailure !== 'function') {
    throw new TypeError('createTranscribeQueue: `onFailure` must be a function if provided');
  }

  // `head` is the tail of the current job chain. New jobs `.then` onto it so
  // their work waits for everything previously enqueued. Errors inside each
  // job are caught locally so they do not poison subsequent jobs in the chain.
  let head = Promise.resolve();
  let pending = 0;

  function safe(fn, ...args) {
    try {
      fn(...args);
    } catch (_) {
      // Swallow logger throws -- they must not break serialisation. A real
      // logger that needs visibility into its own failures can wrap itself.
    }
  }

  function enqueue(job) {
    pending += 1;

    const next = head.then(async () => {
      let result;
      try {
        result = await run(job);
      } catch (error) {
        safe(onFailure, job, error);
        pending -= 1;
        return { ok: false, error };
      }
      safe(onSuccess, job, result);
      pending -= 1;
      return { ok: true, result };
    });
    head = next;
    return next;
  }

  // drain() resolves the next time `pending` is observed as zero on a task
  // boundary. Going via setImmediate (rather than microtask polling or a
  // shared resolver fired from inside the job chain) means every microtask
  // queued during the current job's settle -- including .thens the caller
  // attached to the promise returned by enqueue -- gets to run before drain
  // declares the queue empty. Without that, a sequence like
  // `q.enqueue(j).then(observeSuccess); await q.drain()` would see drain
  // resolve before observeSuccess.
  function drain() {
    if (pending === 0) return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (pending === 0) {
          resolve();
        } else {
          setImmediate(check);
        }
      };
      setImmediate(check);
    });
  }

  return {
    enqueue,
    drain,
    get length() {
      return pending;
    },
  };
}

module.exports = {
  createTranscribeQueue,
};
