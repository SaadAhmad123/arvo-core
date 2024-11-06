import {
  ArvoOrchestrationSubject,
  ArvoOrchestrationSubjectContent,
} from '../../src';
import * as zlib from 'node:zlib';

describe('ArvoOrchestrationSubject', () => {
  const validContent: ArvoOrchestrationSubjectContent = {
    orchestrator: {
      name: 'com.example.orchestrator',
      version: '1.0.0',
    },
    execution: {
      id: '123e4567-e89b-12d3-a456-426614174000',
      initiator: 'com.example.initiator',
    },
    meta: {}
  };

  describe('new', () => {
    it('should create a valid subject string', () => {
      const subject = ArvoOrchestrationSubject.new({
        orchestator: 'com.example.orchestrator',
        version: '1.0.0',
        initiator: 'com.example.initiator',
        meta: {
          sessionId: 'test-123-456'
        }
      });

      expect(subject).toBeTruthy();
      expect(typeof subject).toBe('string');

      const parsed = ArvoOrchestrationSubject.parse(subject);
      expect(parsed.orchestrator.name).toBe('com.example.orchestrator');
      expect(parsed.orchestrator.version).toBe('1.0.0');
      expect(parsed.execution.initiator).toBe('com.example.initiator');
      expect(parsed.execution.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ); // UUID v4 format
      expect(parsed.meta.sessionId).toBe('test-123-456')
    });

    it('should throw an error for invalid input', () => {
      expect(() => {
        ArvoOrchestrationSubject.new({
          orchestator: 'invalid name',
          version: '1.0.0',
          initiator: 'com.example.initiator',
        });
      }).toThrow();
    });
  });

  describe('create', () => {
    it('should create a valid subject string', () => {
      const subject = ArvoOrchestrationSubject.create(validContent);
      expect(subject).toBeTruthy();
      expect(typeof subject).toBe('string');
    });

    it('should throw an error for invalid content', () => {
      const invalidContent = {
        ...validContent,
        orchestrator: { name: 'invalid name', version: '1.0.0' },
      };
      expect(() => {
        ArvoOrchestrationSubject.create(
          invalidContent as ArvoOrchestrationSubjectContent,
        );
      }).toThrow();
    });
  });

  describe('parse', () => {
    it('should correctly parse a valid subject string', () => {
      const subject = ArvoOrchestrationSubject.create(validContent);
      const parsed = ArvoOrchestrationSubject.parse(subject);
      expect(parsed).toEqual(validContent);
    });

    it('should throw an error for an invalid subject string', () => {
      const invalidSubject = 'invalid_base64_string';
      expect(() => {
        ArvoOrchestrationSubject.parse(invalidSubject);
      }).toThrow();
    });

    it('should throw an error for a valid base64 string with invalid content', () => {
      const invalidContent = JSON.stringify({ invalid: 'content' });
      const compressed = zlib.deflateSync(invalidContent);
      const invalidSubject = compressed.toString('base64');

      expect(() => {
        ArvoOrchestrationSubject.parse(invalidSubject);
      }).toThrow();
    });
  });

  describe('from', () => {
    let parentSubject: string;

    beforeEach(() => {
      // Create a parent subject with metadata for testing
      parentSubject = ArvoOrchestrationSubject.new({
        orchestator: 'com.parent.process',
        version: '1.0.0',
        initiator: 'com.system.init',
        meta: {
          environment: 'test',
          parentKey: 'parentValue'
        }
      });
    });

    it('should create a valid child subject from parent', () => {
      const childSubject = ArvoOrchestrationSubject.from({
        orchestator: 'com.child.process',
        version: '2.0.0',
        subject: parentSubject
      });

      const parsed = ArvoOrchestrationSubject.parse(childSubject);
      expect(parsed.orchestrator.name).toBe('com.child.process');
      expect(parsed.orchestrator.version).toBe('2.0.0');
      expect(parsed.execution.initiator).toBe('com.parent.process');
      expect(parsed.meta.environment).toBe('test');
      expect(parsed.meta.parentKey).toBe('parentValue');
      expect(parsed.execution.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('should merge metadata from parent and child', () => {
      const childSubject = ArvoOrchestrationSubject.from({
        orchestator: 'com.child.process',
        version: '2.0.0',
        subject: parentSubject,
        meta: {
          childKey: 'childValue',
          environment: 'production'  // This should override parent's environment
        }
      });

      const parsed = ArvoOrchestrationSubject.parse(childSubject);
      expect(parsed.meta).toEqual({
        childKey: 'childValue',
        environment: 'production',
        parentKey: 'parentValue'
      });
    });

    it('should use WildCardMachineVersion when version is null', () => {
      const childSubject = ArvoOrchestrationSubject.from({
        orchestator: 'com.child.process',
        version: null,
        subject: parentSubject
      });

      const parsed = ArvoOrchestrationSubject.parse(childSubject);
      expect(parsed.orchestrator.version).toBe(ArvoOrchestrationSubject.WildCardMachineVersion);
    });

    it('should throw error when parent subject is invalid', () => {
      expect(() => {
        ArvoOrchestrationSubject.from({
          orchestator: 'com.child.process',
          version: '2.0.0',
          subject: 'invalid_parent_subject'
        });
      }).toThrow();
    });

    it('should throw error when new orchestrator name is invalid', () => {
      expect(() => {
        ArvoOrchestrationSubject.from({
          orchestator: 'invalid name with spaces',
          version: '2.0.0',
          subject: parentSubject
        });
      }).toThrow();
    });
  });

});
