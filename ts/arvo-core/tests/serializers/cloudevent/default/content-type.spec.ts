import { describe, expect, it } from 'vitest';
import { parseDataContentType } from '../../../../src/serializers/cloudevent/default/content-type.js';

describe('parseDataContentType', () => {
  it('parses a bare media type with no parameters', () => {
    expect(parseDataContentType('application/json')).toEqual({
      mediaType: 'application/json',
      params: {},
    });
  });

  it('parses a media type with one parameter', () => {
    expect(
      parseDataContentType('application/vnd.arvo.event+json;version=1'),
    ).toEqual({
      mediaType: 'application/vnd.arvo.event+json',
      params: { version: '1' },
    });
  });

  it('parses multiple parameters', () => {
    expect(
      parseDataContentType('text/plain;charset=utf-8;boundary=xyz'),
    ).toEqual({
      mediaType: 'text/plain',
      params: { charset: 'utf-8', boundary: 'xyz' },
    });
  });

  it('lower-cases the media type', () => {
    expect(parseDataContentType('Application/JSON')?.mediaType).toBe(
      'application/json',
    );
  });

  it('lower-cases parameter names but not parameter values', () => {
    const parsed = parseDataContentType('application/x;VERSION=UPPER');
    expect(parsed?.params.version).toBe('UPPER');
  });

  it('trims whitespace around the media type and parameters', () => {
    expect(parseDataContentType('application/json ; version = 1 ')).toEqual({
      mediaType: 'application/json',
      params: { version: '1' },
    });
  });

  it('ignores a parameter segment with no "="', () => {
    expect(
      parseDataContentType('application/json;malformed;version=1'),
    ).toEqual({
      mediaType: 'application/json',
      params: { version: '1' },
    });
  });

  it('handles a value containing "=" by splitting on the first one only', () => {
    expect(
      parseDataContentType('application/json;filter=a=b')?.params.filter,
    ).toBe('a=b');
  });

  it('returns null for an empty string', () => {
    expect(parseDataContentType('')).toBeNull();
  });

  it('returns null when the media type segment is empty (e.g. a leading ";")', () => {
    expect(parseDataContentType(';version=1')).toBeNull();
  });

  it('returns null for a non-string value', () => {
    expect(parseDataContentType(undefined)).toBeNull();
    expect(parseDataContentType(null)).toBeNull();
    expect(parseDataContentType(42)).toBeNull();
    expect(parseDataContentType({})).toBeNull();
  });

  it('returns an empty params object when only a trailing ";" is present', () => {
    expect(parseDataContentType('application/json;')).toEqual({
      mediaType: 'application/json',
      params: {},
    });
  });
});
