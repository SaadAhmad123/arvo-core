import { describe, expect, it } from 'vitest';
import { isUriReference } from '../../src/utils/uri.js';

describe('isUriReference', () => {
  describe('accepts values already in canonical form', () => {
    it('accepts the fragment-relative form Arvo derives contract URIs as', () => {
      expect(isUriReference('#/com/payment/process')).toBe(true);
      expect(isUriReference('#/payment')).toBe(true);
    });

    it('accepts a contract dataschema, which appends a version', () => {
      expect(isUriReference('#/com/order/create/1.0.0')).toBe(true);
    });

    it('accepts an absolute URI with a path', () => {
      expect(isUriReference('https://example.com/path')).toBe(true);
      expect(isUriReference('https://schemas.example.com/order/v1')).toBe(true);
    });

    it('accepts relative references', () => {
      expect(isUriReference('foo/bar')).toBe(true);
      expect(isUriReference('/absolute/path')).toBe(true);
    });

    it('accepts non-http schemes', () => {
      expect(isUriReference('mailto:a@b.com')).toBe(true);
      expect(isUriReference('urn:isbn:0451450523')).toBe(true);
      expect(
        isUriReference('urn:uuid:6f8c1e2a-1b3d-4c5e-8f90-1a2b3c4d5e6f'),
      ).toBe(true);
    });

    it('accepts the empty string, which is a valid URI-reference', () => {
      // Non-emptiness is a separate rule each caller applies itself.
      expect(isUriReference('')).toBe(true);
    });
  });

  describe('rejects values that are not already canonical', () => {
    it('rejects an uppercase scheme', () => {
      expect(isUriReference('HTTPS://example.com/path')).toBe(false);
      expect(isUriReference('HTTP://EXAMPLE.COM/path')).toBe(false);
    });

    it('rejects lowercase percent-encoding', () => {
      expect(isUriReference('%2ffoo')).toBe(false);
      expect(isUriReference('%2Ffoo')).toBe(true);
    });

    it('rejects unresolved dot-segments', () => {
      expect(isUriReference('./relative')).toBe(false);
      expect(isUriReference('../up')).toBe(false);
      expect(isUriReference('a/./b')).toBe(false);
      expect(isUriReference('a/../b')).toBe(false);
    });

    it('rejects an authority with no path, which canonicalizes to a slash', () => {
      // `https://example.com` serializes as `https://example.com/`, so it is
      // not already canonical. Worth pinning: it is the shape most likely to
      // surprise someone writing a contract uri by hand.
      expect(isUriReference('https://example.com')).toBe(false);
      expect(isUriReference('https://example.com/')).toBe(true);
    });
  });

  describe('rejects values that are not URI-references at all', () => {
    it('rejects an unencoded space', () => {
      expect(isUriReference('foo bar')).toBe(false);
    });

    it('rejects malformed percent-encoding', () => {
      expect(isUriReference('foo%zz')).toBe(false);
    });

    it('rejects a scheme-specific value the parser reports as invalid', () => {
      // fast-uri validates URN sub-schemes, so a malformed UUID is rejected
      // even though the surrounding syntax is well formed.
      expect(isUriReference('urn:uuid:6f8c')).toBe(false);
    });
  });

  it('is a pure predicate, stable across repeated calls', () => {
    for (let i = 0; i < 3; i++) {
      expect(isUriReference('#/com/payment/process')).toBe(true);
      expect(isUriReference('./relative')).toBe(false);
    }
  });
});
