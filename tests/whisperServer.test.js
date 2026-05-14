// Tests for src/whisperServer.js
//
// We test the pure/synchronous helpers (probe, multipart builder) and the
// AudioRecorder integration (server wiring, opt-out flag) without actually
// spawning whisper-server or making real HTTP requests.

const path = require('path');
const { WhisperServer, _internal } = require('../src/whisperServer');

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
});
