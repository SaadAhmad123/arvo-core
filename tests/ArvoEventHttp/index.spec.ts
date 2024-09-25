import { ArvoDataContentType, ArvoEvent, ArvoEventHttp } from '../../src';
import { v4 as uuid4 } from 'uuid';

jest.mock('uuid');

describe('ArvoEventHttp', () => {
  const mockUuid = '12345678-1234-1234-1234-123456789012';
  (uuid4 as jest.Mock).mockReturnValue(mockUuid);

  const mockArvoEvent = new ArvoEvent(
    {
      id: 'test-id',
      type: 'com.example.test',
      source: 'https://example.com/source',
      subject: 'https://example.com/subject',
      time: '2023-05-20T12:00:00Z',
      datacontenttype: ArvoDataContentType,
      specversion: '1.0',
      to: 'https://example.com/to',
      accesscontrol: 'role:admin',
      redirectto: 'https://example.com/redirect',
      executionunits: 100,
      traceparent: 'traceparent-value',
      tracestate: 'tracestate-value',
      dataschema: 'test',
    },
    { key: 'value' },
  );

  describe('exportToBinary', () => {
    it('should export ArvoEvent to binary-mode HTTP configuration', () => {
      const result = ArvoEventHttp.exportToBinary(mockArvoEvent);

      expect(result).toEqual({
        headers: {
          'ce-id': 'test-id',
          'ce-type': 'com.example.test',
          'ce-source': 'https://example.com/source',
          'ce-subject': 'https://example.com/subject',
          'ce-time': '2023-05-20T12:00:00Z',
          'ce-datacontenttype': ArvoDataContentType,
          'ce-specversion': '1.0',
          'ce-to': 'https://example.com/to',
          'ce-accesscontrol': 'role:admin',
          'ce-redirectto': 'https://example.com/redirect',
          'ce-executionunits': 100,
          'ce-traceparent': 'traceparent-value',
          'ce-tracestate': 'tracestate-value',
          'ce-dataschema': 'test',
          'content-type': 'application/json',
        },
        data: { key: 'value' },
      });
    });
  });

  describe('exportToStructured', () => {
    it('should export ArvoEvent to structured-mode HTTP configuration', () => {
      const result = ArvoEventHttp.exportToStructured(mockArvoEvent);

      expect(result).toEqual({
        headers: {
          'content-type': ArvoDataContentType,
        },
        data: mockArvoEvent.toJSON(),
      });
    });
  });

  describe('importFromBinary', () => {
    it('should import ArvoEvent from binary-mode HTTP configuration', () => {
      const binaryConfig = {
        headers: {
          'ce-id': 'test-id',
          'ce-type': 'com.example.test',
          'ce-source': 'https://example.com/source',
          'ce-subject': 'https://example.com/subject',
          'ce-time': '2023-05-20T12:00:00Z',
          'ce-datacontenttype': ArvoDataContentType,
          'ce-specversion': '1.0',
          'ce-to': 'https://example.com/to',
          'ce-accesscontrol': 'role:admin',
          'ce-redirectto': 'https://example.com/redirect',
          'ce-executionunits': '100',
          'ce-traceparent': 'traceparent-value',
          'ce-tracestate': 'tracestate-value',
          'ce-dataschema': 'test',
          'content-type': 'application/json',
        },
        data: { key: 'value' },
      };

      const result = ArvoEventHttp.importFromBinary(binaryConfig);

      expect(result).toBeInstanceOf(ArvoEvent);
      expect(result.toJSON()).toEqual(mockArvoEvent.toJSON());
    });

    it('should throw an error if invalid content type', () => {
      const invalidConfig = {
        headers: {
          'ce-id': 'test-id',
          'ce-source': 'https://example.com/source',
          'ce-subject': 'https://example.com/subject',
          'content-type': 'application/json+1',
        },
        data: {},
      };

      expect(() => ArvoEventHttp.importFromBinary(invalidConfig)).toThrow(
        'Invalid content-type: application/json+1. Expected: application/json',
      );
    });

    it('should throw an error if required fields are missing', () => {
      const invalidConfig = {
        headers: {
          'ce-id': 'test-id',
          'ce-source': 'https://example.com/source',
          'ce-subject': 'https://example.com/subject',
          'content-type': 'application/json',
        },
        data: {},
      };

      expect(() => ArvoEventHttp.importFromBinary(invalidConfig)).toThrow(
        'Missing required header field(s): ce-type',
      );
    });
  });

  describe('importFromStructured', () => {
    it('should import ArvoEvent from structured-mode HTTP configuration', () => {
      const structuredConfig = {
        headers: {
          'content-type': ArvoDataContentType,
        },
        data: mockArvoEvent.toJSON(),
      };

      const result = ArvoEventHttp.importFromStructured(structuredConfig);

      expect(result).toBeInstanceOf(ArvoEvent);
      expect(result.toJSON()).toEqual(mockArvoEvent.toJSON());
    });

    it('should throw an error if content-type is invalid', () => {
      const invalidConfig = {
        headers: {
          'content-type': 'application/json',
        },
        data: mockArvoEvent.toJSON(),
      };

      expect(() => ArvoEventHttp.importFromStructured(invalidConfig)).toThrow(
        `Invalid content-type: application/json. Expected: ${ArvoDataContentType}`,
      );
    });

    it('should throw an error if required fields are missing', () => {
      const invalidConfig = {
        headers: {
          'content-type': ArvoDataContentType,
        },
        data: {
          id: 'test-id',
          source: 'https://example.com/source',
        },
      };

      expect(() => ArvoEventHttp.importFromStructured(invalidConfig)).toThrow(
        'Missing required field(s): type',
      );
    });
  });
});
