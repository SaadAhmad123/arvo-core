import { ViolationError } from '../src';

describe('ViolationError', () => {
  it('should create a violation error', () => {
    const error = new ViolationError({
      type: 'precondition',
      message: 'test error',
    });

    expect(error.name).toBe('ViolationError<precondition>');
    expect(error.message).toBe('ViolationError<precondition> test error');
  });
});
