import { describe, test, expect } from './runner.js';
import { validateReview, SEVERITY, CATEGORY, SEVERITY_RANK } from '../src/core/schema.js';

const validIssue = {
  title: 'Possible null deref',
  description: 'foo.bar can be null',
  severity: 'high',
  category: 'bug',
  file: 'src/x.ts',
  line_start: 10,
  line_end: 12,
  confidence: 'high',
  suggested_fix: { explanation: 'guard', replacement_code: 'if (foo) ...' },
};

describe('validateReview', () => {
  test('accepts valid review', () => {
    expect(validateReview({ summary: 'all good', issues: [] })).toBe(null);
    expect(validateReview({ summary: 's', issues: [validIssue] })).toBe(null);
  });

  test('rejects non-object', () => {
    expect(validateReview(null)).toContain('Not an object');
    expect(validateReview('foo')).toContain('Not an object');
  });

  test('rejects missing summary', () => {
    expect(validateReview({ issues: [] })).toContain('summary');
  });

  test('rejects bad severity', () => {
    const bad = { ...validIssue, severity: 'catastrophic' };
    expect(validateReview({ summary: 's', issues: [bad] })).toContain('severity');
  });

  test('rejects bad category', () => {
    const bad = { ...validIssue, category: 'misc' };
    expect(validateReview({ summary: 's', issues: [bad] })).toContain('category');
  });

  test('rejects line_end < line_start', () => {
    const bad = { ...validIssue, line_start: 10, line_end: 5 };
    expect(validateReview({ summary: 's', issues: [bad] })).toContain('line_end');
  });

  test('rejects line_start < 1', () => {
    const bad = { ...validIssue, line_start: 0, line_end: 0 };
    expect(validateReview({ summary: 's', issues: [bad] })).toContain('line_start');
  });
});

describe('SEVERITY_RANK', () => {
  test('orders correctly', () => {
    expect(SEVERITY_RANK.critical).toBeGreaterThan(SEVERITY_RANK.high);
    expect(SEVERITY_RANK.high).toBeGreaterThan(SEVERITY_RANK.medium);
    expect(SEVERITY_RANK.medium).toBeGreaterThan(SEVERITY_RANK.low);
    expect(SEVERITY_RANK.low).toBeGreaterThan(SEVERITY_RANK.info - 1);
  });
});

describe('SEVERITY / CATEGORY enums', () => {
  test('contain expected values', () => {
    expect(Object.values(SEVERITY)).toContain('critical');
    expect(Object.values(SEVERITY)).toContain('info');
    expect(Object.values(CATEGORY)).toContain('bug');
    expect(Object.values(CATEGORY)).toContain('security');
  });
});
