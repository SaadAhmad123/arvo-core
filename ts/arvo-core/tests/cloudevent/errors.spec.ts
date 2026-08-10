import { describe, expect, it } from 'vitest';
import { CloudEventTransformationError } from '../../src/cloudevent/errors.js';
import { ErrorIssue } from '../../src/utils/error-issue.js';

describe('CloudEventTransformationError', () => {
  describe('kind: "strict"/"foreign"', () => {
    it('formats a single issue under a singular preamble', () => {
      const error = new CloudEventTransformationError({
        kind: 'strict',
        issues: [new ErrorIssue({ path: 'subject', message: 'is required' })],
      });
      expect(error.message).toBe(
        [
          'CloudEvent is not strictly Arvo-shaped.',
          'The following problem was found:',
          '  - subject: is required',
        ].join('\n'),
      );
    });

    it('formats multiple issues under a counted preamble', () => {
      const error = new CloudEventTransformationError({
        kind: 'strict',
        issues: [
          new ErrorIssue({ path: 'subject', message: 'is required' }),
          new ErrorIssue({ path: 'time', message: 'is required' }),
        ],
      });
      expect(error.message).toBe(
        [
          'CloudEvent is not strictly Arvo-shaped.',
          'The following 2 problems were found:',
          '  - subject: is required',
          '  - time: is required',
        ].join('\n'),
      );
    });

    it('formats zero issues as a bare heading', () => {
      const error = new CloudEventTransformationError({
        kind: 'strict',
        issues: [],
      });
      expect(error.message).toBe('CloudEvent is not strictly Arvo-shaped.');
    });

    it('uses the foreign-specific heading for kind: "foreign"', () => {
      const error = new CloudEventTransformationError({
        kind: 'foreign',
        issues: [
          new ErrorIssue({ path: 'dataschema', message: 'is required' }),
        ],
      });
      expect(error.message).toContain(
        'Foreign CloudEvent could not be adapted into an ArvoEvent.',
      );
    });

    it('renders a received value in the message when present', () => {
      const error = new CloudEventTransformationError({
        kind: 'strict',
        issues: [
          new ErrorIssue({
            path: 'specversion',
            message: 'must be exactly "1.0"',
            received: '0.3',
          }),
        ],
      });
      expect(error.message).toContain('(received "0.3")');
    });

    it('omits the received clause when the issue has none', () => {
      const error = new CloudEventTransformationError({
        kind: 'strict',
        issues: [
          new ErrorIssue({ path: 'arvoexecutionid', message: 'is required' }),
        ],
      });
      expect(error.message).not.toContain('received');
    });

    it('exposes issues via detail after narrowing on kind', () => {
      const error = new CloudEventTransformationError({
        kind: 'strict',
        issues: [new ErrorIssue({ path: 'subject', message: 'is required' })],
      });
      if (error.detail.kind === 'strict') {
        expect(error.detail.issues).toHaveLength(1);
      } else {
        throw new Error('expected kind strict');
      }
    });
  });

  describe('kind: "stage"', () => {
    it('formats a stage failure naming the index and direction', () => {
      const error = new CloudEventTransformationError({
        kind: 'stage',
        direction: 'convert',
        stageIndex: 2,
        cause: new Error('boom'),
      });
      expect(error.message).toContain(
        'CloudEvent transformation stage 2 failed during convert',
      );
    });

    it('describes an Error cause by name and message', () => {
      const error = new CloudEventTransformationError({
        kind: 'stage',
        direction: 'revert',
        stageIndex: 0,
        cause: new TypeError('bad type'),
      });
      expect(error.message).toContain('TypeError: bad type');
    });

    it('describes a non-Error cause via its JSON-ish rendering', () => {
      const error = new CloudEventTransformationError({
        kind: 'stage',
        direction: 'convert',
        stageIndex: 1,
        cause: { reason: 'network down' },
      });
      expect(error.message).toContain('"reason":"network down"');
    });

    it('describes a string cause', () => {
      const error = new CloudEventTransformationError({
        kind: 'stage',
        direction: 'convert',
        stageIndex: 1,
        cause: 'plain string cause',
      });
      expect(error.message).toContain('"plain string cause"');
    });

    it('describes an undefined cause', () => {
      const error = new CloudEventTransformationError({
        kind: 'stage',
        direction: 'convert',
        stageIndex: 1,
        cause: undefined,
      });
      expect(error.message).toContain('undefined');
    });

    it('exposes direction/stageIndex/cause via detail after narrowing on kind', () => {
      const cause = new Error('boom');
      const error = new CloudEventTransformationError({
        kind: 'stage',
        direction: 'revert',
        stageIndex: 3,
        cause,
      });
      if (error.detail.kind === 'stage') {
        expect(error.detail.direction).toBe('revert');
        expect(error.detail.stageIndex).toBe(3);
        expect(error.detail.cause).toBe(cause);
      } else {
        throw new Error('expected kind stage');
      }
    });
  });

  describe('identity and inheritance', () => {
    it('is an instance of Error', () => {
      const error = new CloudEventTransformationError({
        kind: 'strict',
        issues: [],
      });
      expect(error).toBeInstanceOf(Error);
    });

    it('carries a stable discriminant tag', () => {
      const error = new CloudEventTransformationError({
        kind: 'strict',
        issues: [],
      });
      expect(error.name).toBe('CloudEventTransformationError');
    });

    it('preserves an ErrorOptions cause independently of detail.cause', () => {
      const underlying = new Error('root cause');
      const error = new CloudEventTransformationError(
        { kind: 'strict', issues: [] },
        { cause: underlying },
      );
      expect(error.cause).toBe(underlying);
    });
  });
});
