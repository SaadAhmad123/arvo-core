import { ViolationError, isViolationError } from '../src';

describe('ViolationError', () => {
  it('should create a violation error', () => {
    const error = new ViolationError({
      type: 'precondition',
      message: 'test error',
    });

    expect(error.name).toBe('ViolationError<precondition>');
    expect(error.message).toBe('ViolationError<precondition> test error');
  });

  it('should create a violation error with metadata', () => {
    const error = new ViolationError({
      type: 'precondition',
      message: 'test error',
      metadata: { key: 'value', count: 42 },
    });

    expect(error.name).toBe('ViolationError<precondition>');
    expect(error.message).toBe('ViolationError<precondition> test error');
    expect(error.metadata).toEqual({ key: 'value', count: 42 });
  });

  it('should set metadata to null when not provided', () => {
    const error = new ViolationError({
      type: 'precondition',
      message: 'test error',
    });

    expect(error.metadata).toBeNull();
  });

  it('should have isArvoViolationError flag set to true', () => {
    const error = new ViolationError({
      type: 'precondition',
      message: 'test error',
    });

    expect(error.isArvoViolationError).toBe(true);
  });

  describe('isViolationError', () => {
    it('should return true for a ViolationError instance', () => {
      const error = new ViolationError({
        type: 'precondition',
        message: 'test error',
      });

      expect(isViolationError(error)).toBe(true);
    });

    it('should return false for null and undefined', () => {
      expect(isViolationError(null)).toBe(false);
      expect(isViolationError(undefined)).toBe(false);
    });

    it('should return false for regular Error', () => {
      expect(isViolationError(new Error('Something went wrong'))).toBe(false);
    });

    it('should return true for a class that inherits from ViolationError', () => {
      class CustomViolationError extends ViolationError {
        constructor(message: string) {
          super({ type: 'custom', message });
        }
      }

      const error = new CustomViolationError('custom error');
      expect(isViolationError(error)).toBe(true);
    });

    it('should return false for primitive values', () => {
      expect(isViolationError('string')).toBe(false);
      expect(isViolationError(123)).toBe(false);
      expect(isViolationError(true)).toBe(false);
      expect(isViolationError(Symbol('test'))).toBe(false);
    });

    it('should return false for plain objects', () => {
      const obj = {
        type: 'test',
        message: 'test message',
        name: 'TestError',
      };

      expect(isViolationError(obj)).toBe(false);
    });

    it('should return false for objects with isArvoViolationError but missing other properties', () => {
      const incomplete1 = {
        isArvoViolationError: true,
        type: 'test',
        name: 'ViolationError<test>',
      };

      const incomplete2 = {
        isArvoViolationError: true,
        message: 'test message',
      };

      expect(isViolationError(incomplete1)).toBe(false);
      expect(isViolationError(incomplete2)).toBe(false);
    });

    it('should return false for objects with empty string properties', () => {
      const emptyStrings = {
        isArvoViolationError: true,
        type: '',
        name: 'ViolationError<test>',
        message: 'test message',
      };

      expect(isViolationError(emptyStrings)).toBe(false);
    });

    it('should return false for arrays', () => {
      expect(isViolationError([])).toBe(false);
      expect(isViolationError([1, 2, 3])).toBe(false);
    });

    it('should return false for objects with wrong property types', () => {
      const wrongTypes = {
        isArvoViolationError: true,
        type: 123,
        name: 'ViolationError<test>',
        message: 'test message',
      };

      expect(isViolationError(wrongTypes)).toBe(false);
    });

    it('should return false when isArvoViolationError is false', () => {
      const notViolation = {
        isArvoViolationError: false,
        type: 'test',
        name: 'ViolationError<test>',
        message: 'test message',
      };

      expect(isViolationError(notViolation)).toBe(false);
    });
  });
});
