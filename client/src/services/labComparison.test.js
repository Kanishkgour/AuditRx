import assert from 'node:assert/strict';
import test from 'node:test';
import { compareLabResult } from './labComparison.js';

const result = (value, referenceRange) => compareLabResult({
  result: { originalValue: value },
  referenceRange: { originalValue: referenceRange },
  unit: { originalValue: '' }
});

test('compares extracted lab values against inclusive numeric intervals', async (t) => {
  const cases = [
    ['9.7', '1.0–10.0', 'within'],
    ['5.1', '0.0–6.0', 'within'],
    ['0.88', '0.10–0.80', 'above'],
    ['0.46', '0.00–0.30', 'above'],
    ['2.07', '3.40–5.70', 'below'],
    ['28', '10–50', 'within']
  ];

  for (const [value, range, expected] of cases) {
    await t.test(`${value} against ${range}`, () => {
      assert.equal(result(value, range), expected);
    });
  }
});

test('does not compare missing, ambiguous, qualitative, or unverified fields', () => {
  assert.equal(result('28', ''), 'unavailable');
  assert.equal(result('positive', '10–50'), 'unavailable');
  assert.equal(result('1,000', '0–2,000'), 'unavailable');
  assert.equal(compareLabResult({
    result: { originalValue: '28', needsVerification: true },
    referenceRange: { originalValue: '10–50' }
  }), 'unavailable');
});

test('accepts unambiguous decimal commas', () => {
  assert.equal(result('9,7', '1,0–10,0'), 'within');
});