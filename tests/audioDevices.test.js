const { EventEmitter } = require('events');
const { parseEnumeration, enumerateDevices } = require('../src/audioDevices');

describe('parseEnumeration', () => {
  test('extracts index, name, and isDefault from sox -V6 stderr', () => {
    const sample = [
      'sox.exe DBUG waveaudio: Enumerating input device -1: "Microsoft Sound Mapper"',
      'sox.exe DBUG waveaudio: Enumerating input device  0: "Microphone (HD Webcam C525)"',
      'sox.exe DBUG waveaudio: Enumerating input device  1: "Headset Mic (Plantronics)"',
      "sox.exe FAIL formats: can't open input  `bogus': The requested WaveAudio device was not found.",
    ].join('\n');

    expect(parseEnumeration(sample)).toEqual([
      { index: -1, name: 'Microsoft Sound Mapper', isDefault: true },
      { index: 0,  name: 'Microphone (HD Webcam C525)', isDefault: false },
      { index: 1,  name: 'Headset Mic (Plantronics)',  isDefault: false },
    ]);
  });

  test('returns empty array when no enumeration lines are present', () => {
    expect(parseEnumeration('')).toEqual([]);
    expect(parseEnumeration(null)).toEqual([]);
    expect(parseEnumeration('unrelated output\nstill nothing')).toEqual([]);
  });

  test('tolerates CRLF line endings and surrounding whitespace', () => {
    const sample = 'preamble\r\nsox DBUG waveaudio: Enumerating input device  0: "Mic"\r\ntail\r\n';
    expect(parseEnumeration(sample)).toEqual([
      { index: 0, name: 'Mic', isDefault: false },
    ]);
  });
});

function makeMockSpawn({ stderrChunks = [], exitCode = 1, error = null } = {}) {
  return jest.fn(() => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    setImmediate(() => {
      if (error) {
        child.emit('error', error);
        return;
      }
      for (const chunk of stderrChunks) {
        child.stderr.emit('data', Buffer.from(chunk));
      }
      child.emit('close', exitCode);
    });
    return child;
  });
}

describe('enumerateDevices', () => {
  test('returns parsed devices from a mocked sox invocation', async () => {
    const spawnFn = makeMockSpawn({
      stderrChunks: [
        'sox DBUG waveaudio: Enumerating input device -1: "Default"\n',
        'sox DBUG waveaudio: Enumerating input device  0: "Real Mic"\n',
      ],
    });
    const result = await enumerateDevices({ spawnFn });
    expect(result.devices).toEqual([
      { index: -1, name: 'Default', isDefault: true },
      { index: 0,  name: 'Real Mic', isDefault: false },
    ]);
    expect(spawnFn).toHaveBeenCalledWith(
      'sox',
      expect.arrayContaining(['-V6', '-t', 'waveaudio']),
      expect.objectContaining({ windowsHide: true }),
    );
  });

  test('throws a friendly error when sox is missing (ENOENT)', async () => {
    const enoent = Object.assign(new Error('not found'), { code: 'ENOENT' });
    const spawnFn = makeMockSpawn({ error: enoent });
    await expect(enumerateDevices({ spawnFn })).rejects.toThrow(/sox not found/);
  });

  test('returns an empty device list when sox produced no enumeration lines', async () => {
    const spawnFn = makeMockSpawn({ stderrChunks: ['sox: nothing to see here\n'] });
    const result = await enumerateDevices({ spawnFn });
    expect(result.devices).toEqual([]);
  });
});
