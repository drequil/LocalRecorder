const path = require('path');
const {
  DEFAULT_ROOT,
  sanitizeName,
  isoSortableTimestamp,
  isoDate,
  resolveRecordPath,
  resolveIdleDirectory,
} = require('../src/recordingPaths');

describe('sanitizeName', () => {
  test('passes through filesystem-safe characters', () => {
    expect(sanitizeName('meeting')).toBe('meeting');
    expect(sanitizeName('team-meeting')).toBe('team-meeting');
    expect(sanitizeName('notes.draft')).toBe('notes.draft');
    expect(sanitizeName('chapter_01')).toBe('chapter_01');
  });

  test('slugifies whitespace and punctuation into single dashes', () => {
    expect(sanitizeName('Team Meeting!')).toBe('Team-Meeting');
    expect(sanitizeName('weekly @ 9am')).toBe('weekly-9am');
    expect(sanitizeName('a / b / c')).toBe('a-b-c');
  });

  test('neutralises path traversal attempts', () => {
    expect(sanitizeName('../../etc/passwd')).toBe('etc-passwd');
    expect(sanitizeName('\\..\\evil')).toBe('evil');
    expect(sanitizeName('..')).toBe(null);
    expect(sanitizeName('.')).toBe(null);
  });

  test('rejects empty / whitespace-only / non-string inputs', () => {
    expect(sanitizeName('')).toBe(null);
    expect(sanitizeName('   ')).toBe(null);
    expect(sanitizeName('!!!')).toBe(null);
    expect(sanitizeName(null)).toBe(null);
    expect(sanitizeName(undefined)).toBe(null);
    expect(sanitizeName(42)).toBe(null);
  });

  test('strips leading and trailing dashes', () => {
    expect(sanitizeName('-meeting-')).toBe('meeting');
    expect(sanitizeName('!!!notes!!!')).toBe('notes');
  });
});

describe('isoSortableTimestamp', () => {
  test('produces YYYYMMDD-HHMMSS in local time', () => {
    const fixed = new Date(2026, 4, 12, 9, 5, 7); // month is 0-based
    expect(isoSortableTimestamp(fixed)).toBe('20260512-090507');
  });
});

describe('isoDate', () => {
  test('produces YYYY-MM-DD in local time', () => {
    const fixed = new Date(2026, 4, 12, 9, 5, 7);
    expect(isoDate(fixed)).toBe('2026-05-12');
  });
});

describe('resolveRecordPath', () => {
  const now = new Date(2026, 4, 12, 9, 5, 7);

  test('uses an explicit path verbatim (legacy compat)', () => {
    const r = resolveRecordPath({ explicitPath: 'foo/bar.wav', now });
    expect(r.filePath).toBe(path.resolve('foo/bar.wav'));
    expect(r.sessionDir).toBe(path.dirname(path.resolve('foo/bar.wav')));
    expect(r.explicit).toBe(true);
  });

  test('with name: <root>/<name>/<name>-<ts>.wav', () => {
    const r = resolveRecordPath({ root: '/tmp/rec', name: 'meeting', now });
    expect(r.sessionDir).toBe(path.resolve('/tmp/rec/meeting'));
    expect(r.filePath).toBe(path.resolve('/tmp/rec/meeting/meeting-20260512-090507.wav'));
    expect(r.label).toBe('meeting');
    expect(r.explicit).toBe(false);
  });

  test('without name: <root>/<date>/recording-<ts>.wav', () => {
    const r = resolveRecordPath({ root: '/tmp/rec', now });
    expect(r.sessionDir).toBe(path.resolve('/tmp/rec/2026-05-12'));
    expect(r.filePath).toBe(path.resolve('/tmp/rec/2026-05-12/recording-20260512-090507.wav'));
  });

  test('falls back to DEFAULT_ROOT when no root is provided', () => {
    const r = resolveRecordPath({ name: 'meeting', now });
    expect(r.sessionDir).toBe(path.resolve(DEFAULT_ROOT, 'meeting'));
  });

  test('sanitizes the name before using it', () => {
    const r = resolveRecordPath({ root: '/tmp/rec', name: 'Team Meeting!', now });
    expect(r.label).toBe('Team-Meeting');
    expect(r.filePath).toContain('Team-Meeting-20260512-090507.wav');
  });

  test('falls back to date layout if the name slugifies to nothing', () => {
    const r = resolveRecordPath({ root: '/tmp/rec', name: '!!!', now });
    expect(r.sessionDir).toBe(path.resolve('/tmp/rec/2026-05-12'));
    expect(r.label).toBeUndefined();
  });
});

describe('resolveIdleDirectory', () => {
  const now = new Date(2026, 4, 12, 9, 5, 7);

  test('uses an explicit directory verbatim (legacy compat)', () => {
    const r = resolveIdleDirectory({ explicitDir: 'foo/bar', now });
    expect(r.sessionDir).toBe(path.resolve('foo/bar'));
    expect(r.explicit).toBe(true);
  });

  test('with name: <root>/<name>', () => {
    const r = resolveIdleDirectory({ root: '/tmp/rec', name: 'standup', now });
    expect(r.sessionDir).toBe(path.resolve('/tmp/rec/standup'));
    expect(r.label).toBe('standup');
  });

  test('without name: <root>/<date>', () => {
    const r = resolveIdleDirectory({ root: '/tmp/rec', now });
    expect(r.sessionDir).toBe(path.resolve('/tmp/rec/2026-05-12'));
  });

  test('falls back to DEFAULT_ROOT when no root is provided', () => {
    const r = resolveIdleDirectory({ name: 'standup', now });
    expect(r.sessionDir).toBe(path.resolve(DEFAULT_ROOT, 'standup'));
  });
});
