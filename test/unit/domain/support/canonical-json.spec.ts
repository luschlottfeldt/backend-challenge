import { describe, expect, it } from 'bun:test';
import { canonicalJsonStringify } from '../../../../src/domain/support/canonical-json.js';

describe('canonicalJsonStringify', () => {
  it('sorts object keys recursively', () => {
    expect(canonicalJsonStringify({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('is insensitive to input key order', () => {
    expect(canonicalJsonStringify({ a: 1, b: 2 })).toBe(canonicalJsonStringify({ b: 2, a: 1 }));
  });

  it('drops undefined but keeps null and preserves array order', () => {
    expect(canonicalJsonStringify({ a: undefined, b: null, c: [3, 1, 2] })).toBe('{"b":null,"c":[3,1,2]}');
  });
});
