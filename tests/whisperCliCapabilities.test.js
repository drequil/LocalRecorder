const { parseCapabilitiesFromHelp } = require('../src/whisperCliCapabilities');

describe('parseCapabilitiesFromHelp', () => {
  test('detects json, tinydiarize, and stereo diarize flags from typical whisper-cli help', () => {
    const help = `
  -di,       --diarize              [false  ] stereo audio diarization
  -tdrz,     --tinydiarize          [false  ] enable tinydiarize (requires a tdrz model)
  -oj,       --output-json          [false  ] output result in a JSON file
  -ojf,      --output-json-full     [false  ] include more information in the JSON file
`;
    expect(parseCapabilitiesFromHelp(help)).toEqual({
      outputJson: true,
      outputJsonFull: true,
      tinydiarize: true,
      stereoDiarize: true,
    });
  });

  test('returns false flags on empty help', () => {
    expect(parseCapabilitiesFromHelp('')).toEqual({
      outputJson: false,
      outputJsonFull: false,
      tinydiarize: false,
      stereoDiarize: false,
    });
  });
});
