const { resolveIdleChunkKnobs } = require('../src/index');

describe('resolveIdleChunkKnobs', () => {
  test('no flags → silence off, 30s chunks', () => {
    expect(resolveIdleChunkKnobs({ idleSilenceSeconds: null, maxChunkSeconds: null })).toEqual({
      idleSilenceSeconds: 0,
      maxChunkSeconds: 30,
    });
  });

  test('--max-chunk-seconds only → silence 0', () => {
    expect(resolveIdleChunkKnobs({ idleSilenceSeconds: null, maxChunkSeconds: 120 })).toEqual({
      idleSilenceSeconds: 0,
      maxChunkSeconds: 120,
    });
  });

  test('--silence 0 only → 30s timed chunks', () => {
    expect(resolveIdleChunkKnobs({ idleSilenceSeconds: 0, maxChunkSeconds: null })).toEqual({
      idleSilenceSeconds: 0,
      maxChunkSeconds: 30,
    });
  });

  test('--silence >0 only → silence-driven, no max timer', () => {
    expect(resolveIdleChunkKnobs({ idleSilenceSeconds: 2, maxChunkSeconds: null })).toEqual({
      idleSilenceSeconds: 2,
      maxChunkSeconds: 0,
    });
  });

  test('both flags set → unchanged', () => {
    expect(resolveIdleChunkKnobs({ idleSilenceSeconds: 1.5, maxChunkSeconds: 90 })).toEqual({
      idleSilenceSeconds: 1.5,
      maxChunkSeconds: 90,
    });
  });
});
