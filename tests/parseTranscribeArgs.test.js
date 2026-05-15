const { parseTranscribeArgs } = require('../src/index');

function expectShape(overrides = {}) {
  return {
    wav: null,
    model: null,
    language: null,
    multilingual: false,
    transcribeModelPreset: null,
    transcribeThreads: null,
    noSpeechThreshold: null,
    entropyThreshold: null,
    noGpu: false,
    gpuLayers: null,
    json: false,
    ...overrides,
  };
}

describe('parseTranscribeArgs', () => {
  test('parses a bare wav path with no flags', () => {
    expect(parseTranscribeArgs(['hello.wav'])).toEqual(expectShape({ wav: 'hello.wav' }));
  });

  test('parses --model before the wav path', () => {
    expect(parseTranscribeArgs(['--model', 'models/small.en.bin', 'hello.wav'])).toEqual(
      expectShape({ wav: 'hello.wav', model: 'models/small.en.bin' }),
    );
  });

  test('parses --model after the wav path', () => {
    expect(parseTranscribeArgs(['hello.wav', '--model', 'models/small.en.bin'])).toEqual(
      expectShape({ wav: 'hello.wav', model: 'models/small.en.bin' }),
    );
  });

  test('parses --model=value (equals form)', () => {
    expect(parseTranscribeArgs(['hello.wav', '--model=models/medium.en.bin'])).toEqual(
      expectShape({ wav: 'hello.wav', model: 'models/medium.en.bin' }),
    );
  });

  test('parses --json (boolean presence flag)', () => {
    expect(parseTranscribeArgs(['hello.wav', '--json'])).toEqual(
      expectShape({ wav: 'hello.wav', json: true }),
    );
  });

  test('combines --model and --json in either order', () => {
    expect(parseTranscribeArgs(['--json', '--model', 'm.bin', 'hello.wav'])).toEqual(
      expectShape({ wav: 'hello.wav', model: 'm.bin', json: true }),
    );
  });

  test('parses --language', () => {
    expect(parseTranscribeArgs(['hello.wav', '--language', 'hi'])).toEqual(
      expectShape({ wav: 'hello.wav', language: 'hi' }),
    );
    expect(parseTranscribeArgs(['--language', 'auto', 'hello.wav'])).toEqual(
      expectShape({ wav: 'hello.wav', language: 'auto' }),
    );
  });

  test('parses --multilingual', () => {
    expect(parseTranscribeArgs(['hello.wav', '--multilingual'])).toEqual(
      expectShape({ wav: 'hello.wav', multilingual: true }),
    );
  });

  test('parses --threads N', () => {
    expect(parseTranscribeArgs(['hello.wav', '--threads', '8'])).toEqual(
      expectShape({ wav: 'hello.wav', transcribeThreads: 8 }),
    );
  });

  test('rejects invalid --language', () => {
    expect(parseTranscribeArgs(['hello.wav', '--language', '9bad']).error).toMatch(/invalid language/);
  });

  test('rejects --json=value (presence flag does not take a value)', () => {
    expect(parseTranscribeArgs(['hello.wav', '--json=foo'])).toEqual({
      error: expect.stringMatching(/--json does not take a value/),
    });
  });

  test('rejects --model without a following value', () => {
    expect(parseTranscribeArgs(['hello.wav', '--model'])).toEqual({
      error: expect.stringMatching(/--model requires a value/),
    });
  });

  test('rejects when wav positional is missing', () => {
    expect(parseTranscribeArgs([])).toEqual({
      error: expect.stringMatching(/requires a <file\.wav>/),
    });
    expect(parseTranscribeArgs(['--json'])).toEqual({
      error: expect.stringMatching(/requires a <file\.wav>/),
    });
  });

  test('rejects unknown flags', () => {
    expect(parseTranscribeArgs(['hello.wav', '--nope', 'x'])).toEqual({
      error: expect.stringMatching(/unknown flag: --nope/),
    });
  });

  test('rejects extra positional arguments', () => {
    expect(parseTranscribeArgs(['hello.wav', 'extra.wav'])).toEqual({
      error: expect.stringMatching(/unexpected extra argument: extra\.wav/),
    });
  });

  test('parses --medium and -m', () => {
    expect(parseTranscribeArgs(['--medium', 'a.wav'])).toEqual(
      expectShape({ wav: 'a.wav', transcribeModelPreset: 'medium' }),
    );
    expect(parseTranscribeArgs(['-m', 'a.wav'])).toEqual(
      expectShape({ wav: 'a.wav', transcribeModelPreset: 'medium' }),
    );
  });

  test('parses --large and -l', () => {
    expect(parseTranscribeArgs(['a.wav', '--large'])).toEqual(
      expectShape({ wav: 'a.wav', transcribeModelPreset: 'large' }),
    );
    expect(parseTranscribeArgs(['-l', 'a.wav'])).toEqual(
      expectShape({ wav: 'a.wav', transcribeModelPreset: 'large' }),
    );
  });

  test('rejects --medium with --large', () => {
    expect(parseTranscribeArgs(['a.wav', '--medium', '--large']).error).toMatch(/cannot use --medium together/);
  });

  // GPU-2 ------------------------------------------------------------------
  test('parses --no-gpu', () => {
    expect(parseTranscribeArgs(['a.wav', '--no-gpu']))
      .toEqual(expectShape({ wav: 'a.wav', noGpu: true }));
  });

  test('parses --gpu-layers N', () => {
    expect(parseTranscribeArgs(['a.wav', '--gpu-layers', '99']))
      .toEqual(expectShape({ wav: 'a.wav', gpuLayers: 99 }));
  });
});
