const { parseTranscribeArgs } = require('../src/index');

describe('parseTranscribeArgs', () => {
  test('parses a bare wav path with no flags', () => {
    expect(parseTranscribeArgs(['hello.wav'])).toEqual({
      wav: 'hello.wav',
      model: null,
      json: false,
    });
  });

  test('parses --model before the wav path', () => {
    expect(parseTranscribeArgs(['--model', 'models/small.en.bin', 'hello.wav'])).toEqual({
      wav: 'hello.wav',
      model: 'models/small.en.bin',
      json: false,
    });
  });

  test('parses --model after the wav path', () => {
    expect(parseTranscribeArgs(['hello.wav', '--model', 'models/small.en.bin'])).toEqual({
      wav: 'hello.wav',
      model: 'models/small.en.bin',
      json: false,
    });
  });

  test('parses --model=value (equals form)', () => {
    expect(parseTranscribeArgs(['hello.wav', '--model=models/medium.en.bin'])).toEqual({
      wav: 'hello.wav',
      model: 'models/medium.en.bin',
      json: false,
    });
  });

  test('parses --json (boolean presence flag)', () => {
    expect(parseTranscribeArgs(['hello.wav', '--json'])).toEqual({
      wav: 'hello.wav',
      model: null,
      json: true,
    });
  });

  test('combines --model and --json in either order', () => {
    expect(parseTranscribeArgs(['--json', '--model', 'm.bin', 'hello.wav'])).toEqual({
      wav: 'hello.wav',
      model: 'm.bin',
      json: true,
    });
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
});
