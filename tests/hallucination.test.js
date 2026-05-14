const { isHallucinatedLine, filterHallucinations } = require('../src/hallucination');

describe('isHallucinatedLine', () => {
  const hallucinated = [
    'Thank you.',
    'Thank you',
    'THANK YOU.',
    'Thank you very much.',
    'Thank you so much.',
    'Thank you for watching.',
    'Thank you for listening.',
    'thank you everyone.',
    'Thank you all.',
    'Thanks for watching.',
    'Thanks for listening.',
    'you',
    'You.',
    'YOU.',
    '[Music]',
    '[MUSIC]',
    '[music]',
    '[Applause]',
    '[BLANK_AUDIO]',
    '[Laughter]',
    '[Noise]',
    '[Silence]',
    '[Inaudible]',
    'Bye.',
    'bye-bye',
    'Bye-Bye.',
    'Goodbye.',
    'Subscribe.',
    'Please subscribe.',
    'Like and subscribe.',
    'Subtitles by someone',
  ];

  test.each(hallucinated)('flags "%s" as hallucination', (line) => {
    expect(isHallucinatedLine(line)).toBe(true);
  });

  const legitimate = [
    'Hello, how are you?',
    'Thank you for your time, please continue with the presentation.',
    'The music started playing after the speech.',
    'We subscribe to the principle of least surprise.',
    'Goodbye cruel world is a song.',
    'You are the best candidate for this role.',
    '',
  ];

  test.each(legitimate)('does NOT flag "%s" as hallucination', (line) => {
    expect(isHallucinatedLine(line)).toBe(false);
  });
});

describe('filterHallucinations', () => {
  test('removes all-hallucination transcript and sets allRemoved=true', () => {
    const text = 'Thank you.\nThank you.\nThank you for watching.';
    const result = filterHallucinations(text);
    expect(result.allRemoved).toBe(true);
    expect(result.text).toBe('');
    expect(result.removedCount).toBe(3);
    expect(result.totalLines).toBe(3);
  });

  test('removes hallucination lines while keeping real speech', () => {
    const text = 'The quarterly results exceeded expectations.\nThank you.\nRevenue grew 12% year over year.';
    const result = filterHallucinations(text);
    expect(result.allRemoved).toBe(false);
    expect(result.text).toContain('quarterly results');
    expect(result.text).toContain('Revenue grew');
    expect(result.text).not.toContain('Thank you');
    expect(result.removedCount).toBe(1);
  });

  test('passes through clean transcript unchanged', () => {
    const text = 'Good morning everyone.\nToday we will discuss the roadmap.';
    const result = filterHallucinations(text);
    expect(result.removedCount).toBe(0);
    expect(result.allRemoved).toBe(false);
    expect(result.text).toBe(text);
  });

  test('handles empty and whitespace-only input', () => {
    expect(filterHallucinations('').allRemoved).toBe(false);
    expect(filterHallucinations('   \n  ').allRemoved).toBe(false);
    expect(filterHallucinations(null).text).toBe('');
    expect(filterHallucinations(undefined).text).toBe('');
  });

  test('handles repeated [Music] / [BLANK_AUDIO] tokens', () => {
    const text = '[Music]\n[BLANK_AUDIO]\n[Music]';
    const result = filterHallucinations(text);
    expect(result.allRemoved).toBe(true);
    expect(result.removedCount).toBe(3);
  });
});
