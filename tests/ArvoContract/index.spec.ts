import { z } from 'zod';
import {
  ArvoContract,
  ArvoSemanticVersion,
  cleanString,
  createArvoContract,
  createSimpleArvoContract,
  InferVersionedArvoContract,
} from '../../src';
import { telemetrySdkStart, telemetrySdkStop } from '../utils';

describe('ArvoContract', () => {
  beforeAll(() => {
    telemetrySdkStart();
  });

  afterAll(() => {
    telemetrySdkStop();
  });

  const validContractSpec = {
    uri: '#/contracts/myContract' as const,
    type: 'com.example.input' as const,
    versions: {
      '0.0.1': {
        accepts: z.object({ name: z.string() }),
        emits: {
          'com.example.output': z.object({ result: z.number() }),
        },
      },
      '1.0.0': {
        accepts: z.object({ name: z.string() }),
        emits: {},
      },
    },
  };

  describe('createArvoContract', () => {
    it('should create a valid simple contract, using createSimpleArvoContract', () => {
      const contract = createSimpleArvoContract({
        uri: `#/simple/test`,
        type: 'simple.test',
        description: 'A simple contract',
        metadata: {
          access: 'private',
        },
        versions: {
          '0.0.1': {
            accepts: z.object({ a: z.number() }),
            emits: z.object({ b: z.string() }),
          },
          '1.0.1': {
            accepts: z.object({ a: z.number() }),
            emits: z.object({ b: z.string() }),
          },
        },
      });

      const V = contract.version('0.0.1');

      expect(contract).toBeInstanceOf(ArvoContract);
      expect(contract.uri).toBe(`#/simple/test`);
      expect(contract.type).toBe('com.simple.test');
      expect(contract.version('0.0.1').accepts.type).toBe('com.simple.test');
      expect(contract.version('0.0.1').emitList[0].type).toBe(
        'evt.simple.test.success',
      );
      expect(contract.systemError.type).toBe(`sys.com.simple.test.error`);
      expect(contract.version('latest').version).toBe('1.0.1');
      expect(contract.metadata.access).toBe('private');
      expect(contract.metadata.contractType).toBe('SimpleArvoContract');
      expect(contract.metadata.rootType).toBe('simple.test');

      expect(contract.version('0.0.1').metadata.access).toBe('private');
      expect(contract.version('0.0.1').metadata.contractType).toBe(
        'SimpleArvoContract',
      );
      expect(contract.version('0.0.1').metadata.rootType).toBe('simple.test');
    });

    it('should create a valid ArvoContract instance', () => {
      const contract = createArvoContract(validContractSpec);
      expect(contract).toBeInstanceOf(ArvoContract);
      expect(contract.uri).toBe(validContractSpec.uri);
      expect(contract.type).toBe(validContractSpec.type);
      expect(contract.version('0.0.1').accepts.type).toBe(contract.type);
      expect(contract.version('0.0.1').emitList[0].type).toBe(
        'com.example.output',
      );
      expect(contract.systemError.type).toBe(`sys.${contract.type}.error`);
      expect(contract.version('latest').version).toBe('1.0.0');
    });

    it('should throw an error for invalid URI', () => {
      const invalidSpec = {
        ...validContractSpec,
        uri: 'invalid uri with space',
      };
      expect(() => createArvoContract(invalidSpec)).toThrow();
    });

    it('should throw an error for invalid version format', () => {
      const invalidSpec = {
        ...validContractSpec,
        versions: {
          'invalid.version': {
            accepts: z.object({ name: z.string() }),
            emits: {
              'com.example.output': z.object({ result: z.number() }),
            },
          },
        },
      };
      expect(() => createArvoContract(invalidSpec)).toThrow();
    });

    it('should throw an error for event type using orchestrator pattern', () => {
      let invalidSpec = {
        ...validContractSpec,
        versions: {
          '0.0.1': {
            accepts: z.object({ name: z.string() }),
            emits: {
              'arvo.orc.test': z.object({}),
            },
          },
        },
      };
      expect(() => createArvoContract(invalidSpec)).toThrow(
        cleanString(`
        In contract (uri=#/contracts/myContract, version=0.0.1), the 'emits' event (type=arvo.orc.test) must not start
        with 'arvo.orc' because this is a reserved pattern
        for Arvo orchestrators.
      `),
      );

      invalidSpec = {
        ...(validContractSpec as any),
        type: 'arvo.orc.test',
      };
      expect(() => createArvoContract(invalidSpec)).toThrow(
        cleanString(`
        In contract (uri=#/contracts/myContract), the 'accepts' event (type=arvo.orc.test) must not start
        with 'arvo.orc' because this is a reserved pattern
        for Arvo orchestrators.
      `),
      );
    });

    it('should create a contract with multiple emits', () => {
      const contractSpec = {
        ...validContractSpec,
        versions: {
          '0.0.1': {
            accepts: z.object({ name: z.string() }),
            emits: {
              'com.example.output': z.object({ result: z.number() }),
              'com.example.error': z.object({ message: z.string() }),
            },
          },
        },
      };
      const contract = createArvoContract(contractSpec);
      expect(Object.keys(contract.versions['0.0.1'].emits)).toHaveLength(2);
      expect(
        contract.versions['0.0.1'].emits['com.example.output'],
      ).toBeTruthy();
      expect(
        contract.versions['0.0.1'].emits['com.example.error'],
      ).toBeTruthy();
    });

    it('should allow empty emits object for a version', () => {
      const contractSpec = {
        ...validContractSpec,
        versions: {
          '0.0.1': {
            accepts: z.object({ name: z.string() }),
            emits: {},
          },
        },
      };
      expect(() => createArvoContract(contractSpec)).not.toThrow();
    });
  });

  describe('ArvoContract instance', () => {
    let contract: ArvoContract<
      string,
      string,
      Record<ArvoSemanticVersion, any>
    >;

    beforeEach(() => {
      contract = createArvoContract(validContractSpec);
    });

    it('should have readonly properties', () => {
      expect(contract.uri).toBe(validContractSpec.uri);
      expect(contract.type).toBe(validContractSpec.type);
      expect(() => {
        (contract as any).uri = 'new-uri';
      }).toThrow();
      expect(() => {
        (contract as any).type = 'new-type';
      }).toThrow();
    });
  });

  describe('ArvoContract validation', () => {
    const complexContractSpec = {
      uri: '#/contracts/complexContract',
      type: 'com.example.complex',
      versions: {
        '0.0.1': {
          accepts: z.object({
            id: z.number().positive(),
            metadata: z.object({
              tags: z.array(z.string()),
              priority: z.enum(['low', 'medium', 'high']),
              optional: z.string().optional(),
            }),
            timestamp: z.date(),
          }),
          emits: {
            'com.example.success': z.object({
              status: z.literal('success'),
              data: z.object({
                processedId: z.number(),
                results: z.array(z.string()),
              }),
            }),
            'com.example.partial': z.object({
              status: z.literal('partial'),
              processed: z.number(),
              remaining: z.number(),
            }),
            'com.example.validation': z.object({
              status: z.literal('error'),
              errors: z.array(
                z.object({
                  field: z.string(),
                  message: z.string(),
                }),
              ),
            }),
          },
        },
        '0.0.2': {
          accepts: z.object({
            id: z.number().positive(),
            metadata: z.object({
              tags: z.array(z.string()),
              priority: z.enum(['low', 'medium', 'high', 'critical']), // Added critical
              optional: z.string().optional(),
              addedField: z.boolean(), // New field
            }),
            timestamp: z.date(),
          }),
          emits: {
            'com.example.success': z.object({
              status: z.literal('success'),
              data: z.object({
                processedId: z.number(),
                results: z.array(z.string()),
                processingTime: z.number(), // New field
              }),
            }),
            'com.example.partial': z.object({
              status: z.literal('partial'),
              processed: z.number(),
              remaining: z.number(),
              estimatedCompletion: z.date(), // New field
            }),
          },
        },
      },
    };

    const contract = createArvoContract(complexContractSpec);

    describe('validateAccepts', () => {
      it('should validate input with all required fields', () => {
        const validInput = {
          id: 123,
          metadata: {
            tags: ['test', 'valid'],
            priority: 'high',
            optional: 'some value',
          },
          timestamp: new Date(),
        };

        const contractVersion = contract.version('0.0.1');
        expect(contractVersion.accepts.type).toBe('com.example.complex');
        expect(
          contractVersion.accepts.schema.safeParse(validInput).success,
        ).toBe(true);
      });

      it('should validate input without optional fields', () => {
        const validInput = {
          id: 123,
          metadata: {
            tags: ['test'],
            priority: 'low',
          },
          timestamp: new Date(),
        };

        const contractVersion = contract.version('0.0.1');
        expect(contractVersion.accepts.type).toBe('com.example.complex');
        expect(
          contractVersion.accepts.schema.safeParse(validInput).success,
        ).toBe(true);
      });

      it('should reject input with invalid field types', () => {
        const invalidInput = {
          id: '123', // Should be number
          metadata: {
            tags: ['test'],
            priority: 'invalid-priority', // Invalid enum value
          },
          timestamp: new Date(),
        };

        const contractVersion = contract.version('0.0.1');
        expect(contractVersion.accepts.type).toBe('com.example.complex');
        const result = contractVersion.accepts.schema.safeParse(invalidInput);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues.length).toBeGreaterThan(0);
        }
      });

      it('should reject input with missing required fields', () => {
        const invalidInput = {
          id: 123,
          // Missing metadata object
          timestamp: new Date(),
        };

        const contractVersion = contract.version('0.0.1');
        expect(contractVersion.accepts.type).toBe('com.example.complex');
        const result = contractVersion.accepts.schema.safeParse(invalidInput);
        expect(result.success).toBe(false);
      });

      it('should validate input against correct version schema', () => {
        const validInputV1 = {
          id: 123,
          metadata: {
            tags: ['test'],
            priority: 'high',
          },
          timestamp: new Date(),
        };

        const validInputV2 = {
          id: 123,
          metadata: {
            tags: ['test'],
            priority: 'critical', // New enum value in v0.0.2
            addedField: true, // New field in v0.0.2
          },
          timestamp: new Date(),
        };

        expect(contract.version('0.0.1').accepts.type).toBe(
          'com.example.complex',
        );
        const resultV1 = contract
          .version('0.0.1')
          .accepts.schema.safeParse(validInputV1);
        expect(resultV1.success).toBe(true);

        expect(contract.version('0.0.2').accepts.type).toBe(
          'com.example.complex',
        );
        const resultV2 = contract
          .version('0.0.2')
          .accepts.schema.safeParse(validInputV2);
        expect(resultV2.success).toBe(true);
      });

      it('should throw error for non-existent version', () => {
        expect(() => contract.version('0.0.3' as any)).toThrow();
      });
    });

    describe('validateEmits', () => {
      it('should validate success emission with all fields', () => {
        const successEmit = {
          status: 'success',
          data: {
            processedId: 123,
            results: ['result1', 'result2'],
          },
        };

        expect(
          contract
            .version('0.0.1')
            .emits['com.example.success'].safeParse(successEmit).success,
        ).toBe(true);
      });

      it('should validate partial emission', () => {
        const partialEmit = {
          status: 'partial',
          processed: 50,
          remaining: 100,
        };

        expect(
          contract
            .version('0.0.1')
            .emits['com.example.partial'].safeParse(partialEmit).success,
        ).toBe(true);
      });

      it('should validate validation error emission', () => {
        const validationEmit = {
          status: 'error',
          errors: [
            { field: 'id', message: 'Must be positive' },
            { field: 'metadata.tags', message: 'Required' },
          ],
        };

        expect(
          contract
            .version('0.0.1')
            .emits['com.example.validation'].safeParse(validationEmit).success,
        ).toBe(true);
      });

      it('should reject emissions with missing fields', () => {
        const invalidEmit = {
          status: 'success',
          data: {
            // Missing processedId
            results: ['result1'],
          },
        };

        expect(
          contract
            .version('0.0.1')
            .emits['com.example.success'].safeParse(invalidEmit).success,
        ).toBe(false);
      });

      it('should reject emissions with invalid field types', () => {
        const invalidEmit = {
          status: 'partial',
          processed: '50', // Should be number
          remaining: 100,
        };

        expect(
          contract
            .version('0.0.1')
            .emits['com.example.partial'].safeParse(invalidEmit).success,
        ).toBe(false);
      });

      it('should validate against correct version schema', () => {
        const successEmitV2 = {
          status: 'success',
          data: {
            processedId: 123,
            results: ['result1'],
            processingTime: 1500, // New field in v0.0.2
          },
        };

        expect(
          contract
            .version('0.0.2')
            .emits['com.example.success'].safeParse(successEmitV2).success,
        ).toBe(true);
      });

      it('should handle version-specific emit types', () => {
        const validationEmit = {
          status: 'error',
          errors: [{ field: 'id', message: 'Invalid' }],
        };

        expect(
          contract
            .version('0.0.1')
            .emits['com.example.validation'].safeParse(validationEmit).success,
        ).toBe(true);
      });
    });
  });
});
