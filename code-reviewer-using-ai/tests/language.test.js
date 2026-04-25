import { describe, test, expect } from './runner.js';
import { detectLanguage, isReviewable, languageGuidance } from '../src/core/language.js';

describe('detectLanguage', () => {
  test('common extensions return lowercase identifiers', () => {
    expect(detectLanguage('src/foo.ts')).toBe('typescript');
    expect(detectLanguage('src/foo.tsx')).toBe('typescript');
    expect(detectLanguage('foo.py')).toBe('python');
    expect(detectLanguage('foo.go')).toBe('go');
    expect(detectLanguage('foo.rs')).toBe('rust');
    expect(detectLanguage('foo.cs')).toBe('csharp');
  });

  test('special filenames', () => {
    expect(detectLanguage('Dockerfile')).toBe('dockerfile');
    expect(detectLanguage('path/to/Dockerfile')).toBe('dockerfile');
    expect(detectLanguage('Makefile')).toBe('makefile');
  });

  test('unknown returns null', () => {
    expect(detectLanguage('foo.xyz')).toBe(null);
    expect(detectLanguage('')).toBe(null);
    expect(detectLanguage(null)).toBe(null);
  });
});

describe('isReviewable', () => {
  test('source files are reviewable', () => {
    expect(isReviewable('src/foo.ts')).toBeTruthy();
    expect(isReviewable('app/bar.py')).toBeTruthy();
    expect(isReviewable('cmd/main.go')).toBeTruthy();
  });

  test('lock files are skipped', () => {
    expect(isReviewable('package-lock.json')).toBeFalsy();
    expect(isReviewable('yarn.lock')).toBeFalsy();
    expect(isReviewable('poetry.lock')).toBeFalsy();
    expect(isReviewable('apps/web/package-lock.json')).toBeFalsy();
  });

  test('binaries and assets are skipped', () => {
    expect(isReviewable('foo.png')).toBeFalsy();
    expect(isReviewable('foo.zip')).toBeFalsy();
    expect(isReviewable('foo.pdf')).toBeFalsy();
    expect(isReviewable('docs/banner.jpg')).toBeFalsy();
  });

  test('build output is skipped (relative + nested)', () => {
    expect(isReviewable('dist/bundle.js')).toBeFalsy();
    expect(isReviewable('apps/web/dist/bundle.js')).toBeFalsy();
    expect(isReviewable('node_modules/foo/index.js')).toBeFalsy();
    expect(isReviewable('build/main.js')).toBeFalsy();
    expect(isReviewable('foo.min.js')).toBeFalsy();
  });

  test('windows-style paths are normalized', () => {
    expect(isReviewable('apps\\web\\dist\\bundle.js')).toBeFalsy();
  });
});

describe('languageGuidance', () => {
  test('returns hints for known langs', () => {
    expect(languageGuidance('typescript')).toContain('any');
    expect(languageGuidance('python')).toContain('mutable default');
  });
  test('returns empty string for unknown', () => {
    expect(languageGuidance('brainfuck')).toBe('');
    expect(languageGuidance(null)).toBe('');
  });
});
