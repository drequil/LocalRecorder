// GPU-4: unit tests for the installer's pure helpers (asset pickers,
// version compare, sha256 file parser, humanBytes). The HTTP / extraction
// paths are integration-only and exercised by `npm run gpu:install` on a
// real workstation.

const {
  pickCublasAsset,
  pickShaAsset,
  cmpVersion,
  parseShaFile,
  humanBytes,
} = require('../tools/install-whisper-cuda');

function asset(name, overrides = {}) {
  return {
    name,
    size: 100,
    browser_download_url: `https://example.com/${name}`,
    ...overrides,
  };
}

describe('pickCublasAsset', () => {
  test('picks the cublas+x64 ZIP from a mixed asset list', () => {
    const release = { assets: [
      asset('whisper-bin-x64.zip'),
      asset('whisper-cublas-12.4.0-bin-x64.zip'),
      asset('whisper-bin-arm64.zip'),
    ] };
    const out = pickCublasAsset(release, { platform: 'win32', arch: 'x64' });
    expect(out.asset.name).toBe('whisper-cublas-12.4.0-bin-x64.zip');
    expect(out.reason).toBeNull();
  });

  test('prefers the highest CUDA version when multiple cublas builds are present', () => {
    const release = { assets: [
      asset('whisper-cublas-11.8.0-bin-x64.zip'),
      asset('whisper-cublas-12.4.0-bin-x64.zip'),
      asset('whisper-cublas-12.2.0-bin-x64.zip'),
    ] };
    const out = pickCublasAsset(release, { platform: 'win32', arch: 'x64' });
    expect(out.asset.name).toBe('whisper-cublas-12.4.0-bin-x64.zip');
  });

  test('falls back to lexicographic order when no version is embedded', () => {
    const release = { assets: [
      asset('whisper-blas-cublas-bin-x64.zip'),
      asset('whisper-cublas-bin-x64.zip'),
    ] };
    const out = pickCublasAsset(release, { platform: 'win32', arch: 'x64' });
    expect(['whisper-blas-cublas-bin-x64.zip', 'whisper-cublas-bin-x64.zip'])
      .toContain(out.asset.name);
  });

  test('returns null with a reason when no cublas ZIP is present', () => {
    const release = { assets: [asset('whisper-bin-x64.zip')] };
    const out = pickCublasAsset(release, { platform: 'win32', arch: 'x64' });
    expect(out.asset).toBeNull();
    expect(out.reason).toMatch(/no cublas/i);
  });

  test('refuses to pick anything on non-Windows hosts', () => {
    const release = { assets: [asset('whisper-cublas-12.4.0-bin-x64.zip')] };
    const out = pickCublasAsset(release, { platform: 'linux', arch: 'x64' });
    expect(out.asset).toBeNull();
    expect(out.reason).toMatch(/unsupported platform/);
  });

  test('refuses to pick anything on non-x64 arch', () => {
    const release = { assets: [asset('whisper-cublas-12.4.0-bin-x64.zip')] };
    const out = pickCublasAsset(release, { platform: 'win32', arch: 'arm64' });
    expect(out.asset).toBeNull();
    expect(out.reason).toMatch(/unsupported arch/);
  });

  test('returns null when assets array is missing', () => {
    expect(pickCublasAsset({}, { platform: 'win32', arch: 'x64' }).asset).toBeNull();
    expect(pickCublasAsset(null, { platform: 'win32', arch: 'x64' }).asset).toBeNull();
  });
});

describe('pickShaAsset', () => {
  test('matches the .sha256 file whose name starts with the ZIP name', () => {
    const release = { assets: [
      asset('whisper-cublas-12.4.0-bin-x64.zip'),
      asset('whisper-cublas-12.4.0-bin-x64.zip.sha256'),
      asset('whisper-bin-x64.zip.sha256'),
    ] };
    const out = pickShaAsset(release, { name: 'whisper-cublas-12.4.0-bin-x64.zip' });
    expect(out.name).toBe('whisper-cublas-12.4.0-bin-x64.zip.sha256');
  });

  test('falls back to a release-wide SHA256SUMS when no per-asset digest exists', () => {
    const release = { assets: [
      asset('whisper-cublas-12.4.0-bin-x64.zip'),
      asset('SHA256SUMS'),
    ] };
    const out = pickShaAsset(release, { name: 'whisper-cublas-12.4.0-bin-x64.zip' });
    expect(out.name).toBe('SHA256SUMS');
  });

  test('returns null when no digest asset is present', () => {
    const release = { assets: [asset('whisper-cublas-12.4.0-bin-x64.zip')] };
    expect(pickShaAsset(release, { name: 'whisper-cublas-12.4.0-bin-x64.zip' })).toBeNull();
  });
});

describe('cmpVersion', () => {
  test('compares major / minor / patch left-to-right', () => {
    expect(cmpVersion('12.4.0', '11.8.0')).toBe(1);
    expect(cmpVersion('11.8.0', '12.4.0')).toBe(-1);
    expect(cmpVersion('12.4.0', '12.4.0')).toBe(0);
    expect(cmpVersion('12.4', '12.4.0')).toBe(0);
    expect(cmpVersion('12.4.1', '12.4.0')).toBe(1);
  });

  test('treats missing parts as 0', () => {
    expect(cmpVersion('12', '12.0.0')).toBe(0);
    expect(cmpVersion('0', '12.4')).toBe(-1);
  });
});

describe('parseShaFile', () => {
  test('parses the standard "hex  filename" line', () => {
    const text = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef  whisper.zip\n';
    expect(parseShaFile(text, 'whisper.zip'))
      .toBe('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
  });

  test('parses the "hex *filename" sha256sum -b form', () => {
    const text = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa *whisper.zip\n';
    expect(parseShaFile(text, 'whisper.zip'))
      .toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  });

  test('parses a bare single-line digest file', () => {
    const text = 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB\n';
    expect(parseShaFile(text)).toBe('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
  });

  test('returns the right digest when the file lists multiple files', () => {
    const text = [
      '1111111111111111111111111111111111111111111111111111111111111111  whisper.zip',
      '2222222222222222222222222222222222222222222222222222222222222222  whisper-cublas.zip',
      '',
    ].join('\n');
    expect(parseShaFile(text, 'whisper-cublas.zip'))
      .toBe('2222222222222222222222222222222222222222222222222222222222222222');
  });

  test('returns null for unparseable input', () => {
    expect(parseShaFile('')).toBeNull();
    expect(parseShaFile(null)).toBeNull();
    expect(parseShaFile('not a digest')).toBeNull();
    expect(parseShaFile('abc  file.zip')).toBeNull(); // short hex
  });
});

describe('humanBytes', () => {
  test('renders KiB / MiB / GiB with 1 decimal', () => {
    expect(humanBytes(512)).toBe('512 B');
    expect(humanBytes(2048)).toBe('2.0 KiB');
    expect(humanBytes(1024 * 1024 * 50)).toBe('50.0 MiB');
    expect(humanBytes(1024 * 1024 * 1024 * 1.5)).toBe('1.5 GiB');
  });

  test('returns "?" for invalid input', () => {
    expect(humanBytes(0)).toBe('?');
    expect(humanBytes(-5)).toBe('?');
    expect(humanBytes(NaN)).toBe('?');
    expect(humanBytes(undefined)).toBe('?');
  });
});
