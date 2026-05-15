const { formatSegmentsAsSpeakerTranscript } = require('../src/speakerTranscript');

describe('formatSegmentsAsSpeakerTranscript', () => {
  test('tinydiarize: advances Speaker index after speaker_turn_next on prior segment', () => {
    const txt = formatSegmentsAsSpeakerTranscript([
      { text: ' Hello ', speaker_turn_next: false },
      { text: ' World ', speaker_turn_next: true },
      { text: ' Again ', speaker_turn_next: false },
    ]);
    expect(txt).toBe('Speaker 1: Hello World\n\nSpeaker 2: Again');
  });

  test('explicit numeric speaker wins over tinydiarize heuristic', () => {
    const txt = formatSegmentsAsSpeakerTranscript([
      { text: ' A ', speaker: 0 },
      { text: ' B ', speaker: 0 },
      { text: ' C ', speaker: 1 },
    ]);
    expect(txt).toBe('Speaker 1: A B\n\nSpeaker 2: C');
  });
});
