import { isValidReasoning, reasoningRejectionReason } from './reasoning.util';

describe('isValidReasoning', () => {
  it('rejects empty / null / whitespace', () => {
    expect(isValidReasoning(null)).toBe(false);
    expect(isValidReasoning(undefined)).toBe(false);
    expect(isValidReasoning('')).toBe(false);
    expect(isValidReasoning('    ')).toBe(false);
  });

  it('rejects too-short reasons', () => {
    expect(isValidReasoning('short')).toBe(false);
    expect(isValidReasoning('9 chars!!')).toBe(false);
  });

  it('rejects boilerplate placeholders even if long enough', () => {
    expect(isValidReasoning('   testing   ')).toBe(false);
    expect(isValidReasoning('placeholder')).toBe(false);
    expect(isValidReasoning('debugging')).toBe(false);
  });

  it('accepts a real reason', () => {
    expect(isValidReasoning('Customer #1234 requested a refund per case CS-987')).toBe(true);
    expect(isValidReasoning('Investigating elevated 5xx in checkout')).toBe(true);
  });
});

describe('reasoningRejectionReason', () => {
  it('explains why rejected', () => {
    expect(reasoningRejectionReason('')).toMatch(/empty/);
    expect(reasoningRejectionReason('short')).toMatch(/at least/);
    expect(reasoningRejectionReason('placeholder')).toMatch(/placeholder/);
  });
});
