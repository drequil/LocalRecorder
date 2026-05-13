const fs = require('fs');
const path = require('path');
const os = require('os');
const { applyRecordAutoTranscribe, parseRecordArgs } = require('../src/index');
const { DEFAULT_MODEL_PATH } = require('../src/transcribe');

describe('applyRecordAutoTranscribe', () => {
  let tmp;
  let cwdSpy;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-auto-tr-'));
  });
  afterEach(() => {
    if (cwdSpy) cwdSpy.mockRestore();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('--no-transcribe forces transcribe off even if model exists', () => {
    const modelPath = path.join(tmp, 'm.bin');
    fs.writeFileSync(modelPath, 'x');
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmp);
    const parsed = parseRecordArgs(['--no-transcribe', '--model', 'm.bin']);
    const out = applyRecordAutoTranscribe(parsed);
    expect(out.transcribe).toBe(false);
    expect(out.recordImplicitTranscribe).toBe(false);
  });

  test('implicit on when model file exists and no flags', () => {
    const modelPath = path.join(tmp, DEFAULT_MODEL_PATH);
    fs.mkdirSync(path.dirname(modelPath), { recursive: true });
    fs.writeFileSync(modelPath, 'x');
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmp);
    const parsed = parseRecordArgs([]);
    const out = applyRecordAutoTranscribe(parsed);
    expect(out.transcribe).toBe(true);
    expect(out.recordImplicitTranscribe).toBe(true);
  });

  test('implicit off when model missing', () => {
    cwdSpy = jest.spyOn(process, 'cwd').mockReturnValue(tmp);
    const parsed = parseRecordArgs([]);
    const out = applyRecordAutoTranscribe(parsed);
    expect(out.transcribe).toBe(false);
    expect(out.recordImplicitTranscribe).toBe(false);
  });

  test('explicit --transcribe sets implicit flag false', () => {
    const parsed = parseRecordArgs(['--transcribe']);
    const out = applyRecordAutoTranscribe(parsed);
    expect(out.transcribe).toBe(true);
    expect(out.recordImplicitTranscribe).toBe(false);
  });
});
