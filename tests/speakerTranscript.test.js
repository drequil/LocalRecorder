const { extractSegments, formatSegmentsAsSpeakerTranscript } = require('../src/speakerTranscript');

describe('extractSegments', () => {
  test('accepts whisper.cpp output-json-full transcription array', () => {
    const doc = {
      transcription: [
        { text: ' Hello ', speaker_turn_next: true },
        { text: ' Emma ', speaker_turn_next: false },
      ],
    };

    expect(extractSegments(doc)).toEqual(doc.transcription);
  });
});

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

  test('removes whisper.cpp speaker-turn marker from displayed text', () => {
    const txt = formatSegmentsAsSpeakerTranscript([
      { text: ' What about today? [SPEAKER TURN]', speaker_turn_next: true },
      { text: ' What about today, Emma?', speaker_turn_next: false },
    ]);

    expect(txt).toBe('Speaker 1: What about today?\n\nSpeaker 2: What about today, Emma?');
  });
});
