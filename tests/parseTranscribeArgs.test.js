const { parseTranscribeArgs } = require('../src/index');

describe('parseTranscribeArgs', () => {
  test('parses a bare wav path with no flags', () => {
    expect(parseTranscribeArgs(['hello.wav'])).toEqual({
      wav: 'hello.wav',
      model: null,
      language: null,
      multilingual: false,
      transcribeModelPreset: null,
      json: false,
    });
  });

  test('parses --model before the wav path', () => {
    expect(parseTranscribeArgs(['--model', 'models/small.en.bin', 'hello.wav'])).toEqual({
      wav: 'hello.wav',
      model: 'models/small.en.bin',
      language: null,
      multilingual: false,
      transcribeModelPreset: null,
      json: false,
    });
  });

  test('parses --model after the wav path', () => {
    expect(parseTranscribeArgs(['hello.wav', '--model', 'models/small.en.bin'])).toEqual({
      wav: 'hello.wav',
      model: 'models/small.en.bin',
      language: null,
      multilingual: false,
      transcribeModelPreset: null,
      json: false,
    });
  });

  test('parses --model=value (equals form)', () => {
    expect(parseTranscribeArgs(['hello.wav', '--model=models/medium.en.bin'])).toEqual({
      wav: 'hello.wav',
      model: 'models/medium.en.bin',
      language: null,
      multilingual: false,
      transcribeModelPreset: null,
      json: false,
    });
  });

  test('parses --json (boolean presence flag)', () => {
    expect(parseTranscribeArgs(['hello.wav', '--json'])).toEqual({
      wav: 'hello.wav',
      model: null,
      language: null,
      multilingual: false,
      transcribeModelPreset: null,
      json: true,
    });
  });

  test('combines --model and --json in either order', () => {
    expect(parseTranscribeArgs(['--json', '--model', 'm.bin', 'hello.wav'])).toEqual({
      wav: 'hello.wav',
      model: 'm.bin',
      language: null,
      multilingual: false,
      transcribeModelPreset: null,
      json: true,
    });
  });

  test('parses --language', () => {
    expect(parseTranscribeArgs(['hello.wav', '--language', 'hi'])).toEqual({
      wav: 'hello.wav',
      model: null,
      language: 'hi',
      multilingual: false,
      transcribeModelPreset: null,
      json: false,
    });
    expect(parseTranscribeArgs(['--language', 'auto', 'hello.wav'])).toEqual({
      wav: 'hello.wav',
      model: null,
      language: 'auto',
      multilingual: false,
      transcribeModelPreset: null,
      json: false,
    });
  });

  test('parses --multilingual', () => {
    expect(parseTranscribeArgs(['hello.wav', '--multilingual'])).toEqual({
      wav: 'hello.wav',
      model: null,
      language: null,
      multilingual: true,
      transcribeModelPreset: null,
      json: false,
    });
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
    expect(parseTranscribeArgs(['--medium', 'a.wav'])).toEqual({
      wav: 'a.wav',
      model: null,
      language: null,
      multilingual: false,
      transcribeModelPreset: 'medium',
      json: false,
    });
    expect(parseTranscribeArgs(['-m', 'a.wav'])).toEqual({
      wav: 'a.wav',
      model: null,
      language: null,
      multilingual: false,
      transcribeModelPreset: 'medium',
      json: false,
    });
  });

  test('parses --large and -l', () => {
    expect(parseTranscribeArgs(['a.wav', '--large'])).toEqual({
      wav: 'a.wav',
      model: null,
      language: null,
      multilingual: false,
      transcribeModelPreset: 'large',
      json: false,
    });
    expect(parseTranscribeArgs(['-l', 'a.wav'])).toEqual({
      wav: 'a.wav',
      model: null,
      language: null,
      multilingual: false,
      transcribeModelPreset: 'large',
      json: false,
    });
  });

  test('rejects --medium with --large', () => {
    expect(parseTranscribeArgs(['a.wav', '--medium', '--large']).error).toMatch(/cannot use --medium together/);
  });
});
