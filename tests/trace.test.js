const { trace, isTraceEnabled, enableTraceFromCli } = require('../src/trace');

describe('trace', () => {
  const orig = process.env.LOCALRECORDER_TRACE;

  afterEach(() => {
    if (orig === undefined) delete process.env.LOCALRECORDER_TRACE;
    else process.env.LOCALRECORDER_TRACE = orig;
  });

  test('isTraceEnabled is false when unset', () => {
    delete process.env.LOCALRECORDER_TRACE;
    expect(isTraceEnabled()).toBe(false);
  });

  test('isTraceEnabled accepts 1 / true / yes / on (case-insensitive)', () => {
    for (const v of ['1', 'true', 'YES', 'On']) {
      process.env.LOCALRECORDER_TRACE = v;
      expect(isTraceEnabled()).toBe(true);
    }
  });

  test('trace does nothing when disabled', () => {
    delete process.env.LOCALRECORDER_TRACE;
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    trace('x', 'hello', { a: 1 });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('trace logs to stderr when enabled', () => {
    process.env.LOCALRECORDER_TRACE = '1';
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    trace('stage', 'msg', { k: 'v' });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatch(/\[lr:trace/);
    expect(spy.mock.calls[0][0]).toMatch(/\[stage\]/);
    expect(spy.mock.calls[0][0]).toMatch(/msg/);
    expect(spy.mock.calls[0][0]).toMatch(/"k":"v"/);
    spy.mockRestore();
  });

  test('enableTraceFromCli sets env', () => {
    delete process.env.LOCALRECORDER_TRACE;
    enableTraceFromCli();
    expect(process.env.LOCALRECORDER_TRACE).toBe('1');
    expect(isTraceEnabled()).toBe(true);
  });
});
