// Tests for src/whisperServer.js
//
// We test the pure/synchronous helpers (probe, multipart builder) and the
// AudioRecorder integration (server wiring, opt-out flag) without actually
// spawning whisper-server or making real HTTP requests.

const path = require('path');
const { WhisperServer, buildServerArgs, _internal } = require('../src/whisperServer');

const { probeServerBinary, buildMultipart } = _internal;

// ---------------------------------------------------------------------------
// WhisperServer.probe()
// ---------------------------------------------------------------------------

describe('WhisperServer.probe', () => {
  test('returns null when no candidate binary is found', () => {
    // Pass a nonsense binary name that will never be on PATH.
    expect(WhisperServer.probe(['__nonexistent_whisper_server_9999__'])).toBeNull();
  });

  test('static method is callable with default candidates without throwing', () => {
    // May return a string or null depending on the environment; just ensure no throw.
    const result = WhisperServer.probe();
    expect(result === null || typeof result === 'string').toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildMultipart (internal helper)
// ---------------------------------------------------------------------------

describe('buildMultipart', () => {
  const tmpWav = path.join(__dirname, '__tmp_multipart_test.wav');

  beforeAll(() => {
    // Minimal 44-byte fake WAV content (header only).
    const buf = Buffer.alloc(44, 0);
    buf.write('RIFF', 0, 'ascii');
    buf.write('WAVE', 8, 'ascii');
    require('fs').writeFileSync(tmpWav, buf);
  });

  afterAll(() => {
    try { require('fs').unlinkSync(tmpWav); } catch (_) { /* ignore */ }
  });

  test('produces a Buffer containing the boundary and file content', () => {
    const { boundary, body } = buildMultipart(tmpWav, { response_format: 'json' });
    expect(typeof boundary).toBe('string');
    expect(boundary.length).toBeGreaterThan(0);
    expect(Buffer.isBuffer(body)).toBe(true);
    const bodyStr = body.toString('binary');
    expect(bodyStr).toContain(`--${boundary}`);
    expect(bodyStr).toContain('Content-Disposition: form-data; name="file"');
    expect(bodyStr).toContain('Content-Type: audio/wav');
    expect(bodyStr).toContain('response_format');
    expect(bodyStr).toContain('json');
    // Terminating boundary
    expect(bodyStr).toContain(`--${boundary}--`);
  });

  test('includes no_speech_thold and entropy_thold when provided', () => {
    const { body } = buildMultipart(tmpWav, {
      no_speech_thold: '0.8',
      entropy_thold: '2.8',
    });
    const bodyStr = body.toString('binary');
    expect(bodyStr).toContain('no_speech_thold');
    expect(bodyStr).toContain('0.8');
    expect(bodyStr).toContain('entropy_thold');
    expect(bodyStr).toContain('2.8');
  });

  test('omits null fields', () => {
    const { body } = buildMultipart(tmpWav, { language: null, no_speech_thold: null });
    const bodyStr = body.toString('binary');
    expect(bodyStr).not.toContain('name="language"');
    expect(bodyStr).not.toContain('name="no_speech_thold"');
  });
});

// ---------------------------------------------------------------------------
// WhisperServer instance lifecycle (mocked)
// ---------------------------------------------------------------------------

describe('WhisperServer instance', () => {
  test('transcribe() throws when not started', async () => {
    const ws = new WhisperServer();
    await expect(ws.transcribe('/tmp/foo.wav')).rejects.toThrow('not started');
  });

  test('stop() is safe to call when proc is null', () => {
    const ws = new WhisperServer();
    expect(() => ws.stop()).not.toThrow();
  });

  test('ready is false before start()', () => {
    const ws = new WhisperServer();
    expect(ws.ready).toBe(false);
  });

  // GPU-2: argv shape is the public contract for what we ask whisper-server
  // to do. The pure helper `buildServerArgs` is the single source of truth;
  // the `start()` test below uses an injectable spawnFn / waitForPortFn so we
  // never actually spawn a server.
  describe('buildServerArgs (GPU-2)', () => {
    test('omits --no-gpu and -ngl when gpu is unset (whisper.cpp build default)', () => {
      expect(buildServerArgs({ model: 'm.bin', threads: 4, port: 1234 }))
        .toEqual(['-m', 'm.bin', '-t', '4', '--port', '1234', '--host', '127.0.0.1']);
    });

    test('pushes --no-gpu when gpu === false', () => {
      expect(buildServerArgs({ model: 'm.bin', threads: 4, port: 1234, gpu: false }))
        .toEqual(['-m', 'm.bin', '-t', '4', '--no-gpu', '--port', '1234', '--host', '127.0.0.1']);
    });

    test('pushes -ngl N when gpu === true with positive gpuLayers', () => {
      expect(buildServerArgs({ model: 'm.bin', threads: 4, port: 1234, gpu: true, gpuLayers: 32 }))
        .toEqual(['-m', 'm.bin', '-t', '4', '-ngl', '32', '--port', '1234', '--host', '127.0.0.1']);
    });

    test('omits -ngl when gpu === true but gpuLayers is null', () => {
      expect(buildServerArgs({ model: 'm.bin', threads: 4, port: 1234, gpu: true }))
        .toEqual(['-m', 'm.bin', '-t', '4', '--port', '1234', '--host', '127.0.0.1']);
    });

    test('rejects non-positive gpuLayers (0, negative, non-integer) by omitting -ngl', () => {
      const base = ['-m', 'm.bin', '-t', '4', '--port', '1234', '--host', '127.0.0.1'];
      expect(buildServerArgs({ model: 'm.bin', threads: 4, port: 1234, gpu: true, gpuLayers: 0 })).toEqual(base);
      expect(buildServerArgs({ model: 'm.bin', threads: 4, port: 1234, gpu: true, gpuLayers: -1 })).toEqual(base);
      expect(buildServerArgs({ model: 'm.bin', threads: 4, port: 1234, gpu: true, gpuLayers: 12.5 })).toEqual(base);
    });
  });

  // End-to-end argv smoke through start() using injected spawn/waitForPort fakes.
  // This pins the GPU intent stored on the instance and the argv that would be
  // handed to a real whisper-server, without running one.
  describe('start() spawn-argv smoke (GPU-2)', () => {
    function makeFakes() {
      const { EventEmitter } = require('events');
      const spawnFn = jest.fn(() => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = jest.fn(() => { child.killed = true; });
        child.killed = false;
        return child;
      });
      const waitForPortFn = jest.fn().mockResolvedValue(true);
      return { spawnFn, waitForPortFn };
    }

    test('captures gpu/gpuLayers on the instance and threads them into argv', async () => {
      const { spawnFn, waitForPortFn } = makeFakes();
      const ws = new WhisperServer();
      await ws.start({ binary: 'whisper-server', model: 'm.bin', threads: 4, gpu: true, gpuLayers: 99, spawnFn, waitForPortFn });
      expect(ws.gpu).toBe(true);
      expect(ws.gpuLayers).toBe(99);
      expect(ws.ready).toBe(true);
      const [binary, args] = spawnFn.mock.calls[0];
      expect(binary).toBe('whisper-server');
      expect(args).toContain('-ngl');
      expect(args[args.indexOf('-ngl') + 1]).toBe('99');
      ws.stop();
    });

    test('--no-gpu wins on the instance + argv', async () => {
      const { spawnFn, waitForPortFn } = makeFakes();
      const ws = new WhisperServer();
      await ws.start({ binary: 'whisper-server', model: 'm.bin', threads: 4, gpu: false, spawnFn, waitForPortFn });
      expect(ws.gpu).toBe(false);
      expect(ws.gpuLayers).toBeNull();
      const [, args] = spawnFn.mock.calls[0];
      expect(args).toContain('--no-gpu');
      ws.stop();
    });
  });
});

// ---------------------------------------------------------------------------
// AudioRecorder integration
// ---------------------------------------------------------------------------

describe('AudioRecorder whisper-server integration', () => {
  const AudioRecorder = require('../src/audioRecorder');

  test('_whisperServerPromise is null when transcribe=false', () => {
    const r = new AudioRecorder({ transcribe: false });
    expect(r._whisperServerPromise).toBeNull();
  });

  test('_whisperServerPromise is null when transcribeFn is injected (test path)', () => {
    const r = new AudioRecorder({
      transcribe: true,
      transcribeFn: jest.fn().mockResolvedValue({ text: 'hi', txtPath: '/x.txt' }),
    });
    expect(r._whisperServerPromise).toBeNull();
  });

  test('_whisperServerPromise is null when useWhisperServer=false', () => {
    const r = new AudioRecorder({
      transcribe: true,
      useWhisperServer: false,
      transcribeFn: undefined,
    });
    // No injected fn but server disabled → promise should be null.
    // (The promise would normally be set, but useWhisperServer: false skips it.)
    expect(r._whisperServerPromise).toBeNull();
  });

  test('_whisperServerPromise is set (a Promise) when transcribe=true and no custom fn', async () => {
    const r = new AudioRecorder({ transcribe: true });
    // It may resolve to null (no binary found) but must be a Promise.
    expect(r._whisperServerPromise).toBeInstanceOf(Promise);
    // Await and clean up: if a real whisper-server started, stop it so the
    // test process can exit cleanly (avoids jest "force exit" warning).
    const server = await r._whisperServerPromise.catch(() => null);
    if (server) server.stop();
  });

  test('_serverAwareTranscribe uses ready server over CLI', async () => {
    // Build a recorder with no whisper-server wired up yet.
    const r = new AudioRecorder({ transcribe: true, useWhisperServer: false });

    // Inject a fake server whose transcribeToFile resolves successfully.
    const fakeServer = {
      ready: true,
      transcribeToFile: jest.fn().mockResolvedValue({ text: 'from-server', txtPath: '/s.txt' }),
    };
    r._whisperServerPromise = Promise.resolve(fakeServer);

    const result = await r._serverAwareTranscribe({
      wav: '/any.wav',
      model: '/any.bin',
      language: null,
      threads: 4,
      noSpeechThreshold: 0.8,
      entropyThreshold: 2.8,
    });

    expect(fakeServer.transcribeToFile).toHaveBeenCalledWith('/any.wav', {
      language: null,
      noSpeechThreshold: 0.8,
      entropyThreshold: 2.8,
    });
    expect(result.text).toBe('from-server');
  });

  // GPU-2: AudioRecorder is the entry point the CLI calls; verify it
  // normalises and stores the gpu tri-state correctly.
  describe('GPU-2 option normalisation', () => {
    test('defaults gpu/gpuLayers to null when nothing is set', () => {
      const r = new AudioRecorder({ transcribe: true, useWhisperServer: false });
      expect(r.gpu).toBeNull();
      expect(r.gpuLayers).toBeNull();
    });

    test('honours gpu: false (forced CPU)', () => {
      const r = new AudioRecorder({ transcribe: true, useWhisperServer: false, gpu: false });
      expect(r.gpu).toBe(false);
      expect(r.gpuLayers).toBeNull();
    });

    test('honours gpu: true with gpuLayers (e.g. -ngl 32)', () => {
      const r = new AudioRecorder({ transcribe: true, useWhisperServer: false, gpu: true, gpuLayers: 32 });
      expect(r.gpu).toBe(true);
      expect(r.gpuLayers).toBe(32);
    });

    test('drops invalid gpuLayers (negative, non-integer) when gpu: true', () => {
      expect(new AudioRecorder({ transcribe: true, useWhisperServer: false, gpu: true, gpuLayers: -1 }).gpuLayers).toBeNull();
      expect(new AudioRecorder({ transcribe: true, useWhisperServer: false, gpu: true, gpuLayers: 12.5 }).gpuLayers).toBeNull();
      expect(new AudioRecorder({ transcribe: true, useWhisperServer: false, gpu: true, gpuLayers: 0 }).gpuLayers).toBeNull();
    });

    test('ignores gpuLayers entirely when gpu is null or false', () => {
      expect(new AudioRecorder({ transcribe: true, useWhisperServer: false, gpu: null, gpuLayers: 32 }).gpuLayers).toBeNull();
      expect(new AudioRecorder({ transcribe: true, useWhisperServer: false, gpu: false, gpuLayers: 32 }).gpuLayers).toBeNull();
    });

    test('threads gpu/gpuLayers into _startWhisperServerSilently()', async () => {
      // Stub WhisperServer.probe + the start() method so we never spawn.
      // We capture the start({gpu, gpuLayers}) call to confirm wiring.
      const fakeStart = jest.fn().mockResolvedValue(undefined);
      const wsMod = require('../src/whisperServer');
      const origProbe = wsMod.WhisperServer.probe;
      wsMod.WhisperServer.probe = jest.fn(() => 'whisper-server');
      // Stash a sentinel so we don't actually create a real server: we
      // override the prototype's start to the fake for this test only.
      const origStart = wsMod.WhisperServer.prototype.start;
      wsMod.WhisperServer.prototype.start = fakeStart;
      try {
        const r = new AudioRecorder({
          transcribe: true,
          useWhisperServer: true,
          gpu: true,
          gpuLayers: 32,
        });
        await r._whisperServerPromise;
        expect(fakeStart).toHaveBeenCalledTimes(1);
        const opts = fakeStart.mock.calls[0][0];
        expect(opts.gpu).toBe(true);
        expect(opts.gpuLayers).toBe(32);
        expect(opts.model).toBeDefined();
      } finally {
        wsMod.WhisperServer.probe = origProbe;
        wsMod.WhisperServer.prototype.start = origStart;
      }
    });
  });
});
