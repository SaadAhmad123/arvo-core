import { z } from 'zod';
import {
  ArvoContract,
  ArvoSemanticVersion,
  cleanString,
  createArvoContract,
  InferVersionedArvoContract,
  VersionedArvoContract,
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
    },
  };

  describe('createArvoContract', () => {
    it('should create a valid ArvoContract instance', () => {
      const contract = createArvoContract(validContractSpec);
      expect(contract).toBeInstanceOf(ArvoContract);
      expect(contract.uri).toBe(validContractSpec.uri);
      expect(contract.type).toBe(validContractSpec.type);
      expect(contract.accepts('0.0.1').type).toBe(contract.type);
      expect(Object.keys(contract.emits('0.0.1'))[0]).toBe(
        'com.example.output',
      );
      expect(contract.systemError.type).toBe(`sys.${contract.type}.error`);
      expect(contract.latestVersion).toBe('0.0.1');
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
      const invalidSpec = {
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

    describe('validateAccepts', () => {
      it('should validate a correct input for a specific version', () => {
        const result = contract.validateAccepts('0.0.1', 'com.example.input', {
          name: 'John',
        });
        expect(result.success).toBe(true);
      });

      it('should invalidate an incorrect input', () => {
        const result = contract.validateAccepts('0.0.1', 'com.example.input', {
          name: 123,
        });
        expect(result.success).toBe(false);
      });

      it('should throw an error for an invalid version', () => {
        expect(() =>
          contract.validateAccepts('1.0.0', 'com.example.input', {}),
        ).toThrow();
      });

      it('should handle complex input schemas', () => {
        const complexContract = createArvoContract({
          uri: '#/contracts/complexContract',
          type: 'com.example.complex',
          versions: {
            '0.0.1': {
              accepts: z.object({
                id: z.number(),
                data: z.array(z.string()),
                nested: z.object({ flag: z.boolean() }),
              }),
              emits: {},
            },
          },
        });

        const validInput = { id: 1, data: ['a', 'b'], nested: { flag: true } };
        const invalidInput = {
          id: '1',
          data: ['a', 2],
          nested: { flag: 'true' },
        };

        expect(
          complexContract.validateAccepts(
            '0.0.1',
            'com.example.complex',
            validInput,
          ).success,
        ).toBe(true);
        expect(
          complexContract.validateAccepts(
            '0.0.1',
            'com.example.complex',
            invalidInput,
          ).success,
        ).toBe(false);
      });
    });

    describe('validateEmits', () => {
      it('should validate a correct output for a specific version', () => {
        const result = contract.validateEmits('0.0.1', 'com.example.output', {
          result: 42,
        });
        expect(result.success).toBe(true);
      });

      it('should invalidate an incorrect output', () => {
        const result = contract.validateEmits('0.0.1', 'com.example.output', {
          result: 'not a number',
        });
        expect(result.success).toBe(false);
      });

      it('should throw an error for an invalid version', () => {
        expect(() =>
          contract.validateEmits('1.0.0', 'com.example.output', {}),
        ).toThrow();
      });

      it('should validate multiple emit types in a version', () => {
        const multiEmitContract = createArvoContract({
          uri: '#/contracts/multiEmit',
          type: 'com.example.input',
          versions: {
            '0.0.1': {
              accepts: z.object({ name: z.string() }),
              emits: {
                'com.example.output': z.object({ result: z.number() }),
                'com.example.error': z.object({ message: z.string() }),
              },
            },
          },
        });

        const outputResult = multiEmitContract.validateEmits(
          '0.0.1',
          'com.example.output',
          { result: 42 },
        );
        const errorResult = multiEmitContract.validateEmits(
          '0.0.1',
          'com.example.error',
          { message: 'Error occurred' },
        );

        expect(outputResult.success).toBe(true);
        expect(errorResult.success).toBe(true);
      });
    });
  });

  describe('ArvoContract validation', () => {
    let contract: ArvoContract<
      string,
      string,
      Record<ArvoSemanticVersion, any>
    >;

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

    beforeEach(() => {
      contract = createArvoContract(complexContractSpec);
    });

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

        const result = contract.validateAccepts(
          '0.0.1',
          'com.example.complex',
          validInput,
        );
        expect(result.success).toBe(true);
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

        const result = contract.validateAccepts(
          '0.0.1',
          'com.example.complex',
          validInput,
        );
        expect(result.success).toBe(true);
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

        const result = contract.validateAccepts(
          '0.0.1',
          'com.example.complex',
          invalidInput,
        );
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

        const result = contract.validateAccepts(
          '0.0.1',
          'com.example.complex',
          invalidInput,
        );
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

        const resultV1 = contract.validateAccepts(
          '0.0.1',
          'com.example.complex',
          validInputV1,
        );
        expect(resultV1.success).toBe(true);

        const resultV2 = contract.validateAccepts(
          '0.0.2',
          'com.example.complex',
          validInputV2,
        );
        expect(resultV2.success).toBe(true);
      });

      it('should throw error for non-existent version', () => {
        expect(() =>
          contract.validateAccepts('0.0.3', 'com.example.complex', {}),
        ).toThrow();
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

        const result = contract.validateEmits(
          '0.0.1',
          'com.example.success',
          successEmit,
        );
        expect(result.success).toBe(true);
      });

      it('should validate partial emission', () => {
        const partialEmit = {
          status: 'partial',
          processed: 50,
          remaining: 100,
        };

        const result = contract.validateEmits(
          '0.0.1',
          'com.example.partial',
          partialEmit,
        );
        expect(result.success).toBe(true);
      });

      it('should validate validation error emission', () => {
        const validationEmit = {
          status: 'error',
          errors: [
            { field: 'id', message: 'Must be positive' },
            { field: 'metadata.tags', message: 'Required' },
          ],
        };

        const result = contract.validateEmits(
          '0.0.1',
          'com.example.validation',
          validationEmit,
        );
        expect(result.success).toBe(true);
      });

      it('should reject emissions with missing fields', () => {
        const invalidEmit = {
          status: 'success',
          data: {
            // Missing processedId
            results: ['result1'],
          },
        };

        const result = contract.validateEmits(
          '0.0.1',
          'com.example.success',
          invalidEmit,
        );
        expect(result.success).toBe(false);
      });

      it('should reject emissions with invalid field types', () => {
        const invalidEmit = {
          status: 'partial',
          processed: '50', // Should be number
          remaining: 100,
        };

        const result = contract.validateEmits(
          '0.0.1',
          'com.example.partial',
          invalidEmit,
        );
        expect(result.success).toBe(false);
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

        const resultV2 = contract.validateEmits(
          '0.0.2',
          'com.example.success',
          successEmitV2,
        );
        expect(resultV2.success).toBe(true);
      });

      it('should throw error for non-existent emit type', () => {
        expect(() =>
          contract.validateEmits('0.0.1', 'com.example.nonexistent', {}),
        ).toThrow();
      });

      it('should handle version-specific emit types', () => {
        const validationEmit = {
          status: 'error',
          errors: [{ field: 'id', message: 'Invalid' }],
        };

        // This should work in v0.0.1
        const resultV1 = contract.validateEmits(
          '0.0.1',
          'com.example.validation',
          validationEmit,
        );
        expect(resultV1.success).toBe(true);

        // This should throw in v0.0.2 as the validation emit type was removed
        expect(() =>
          contract.validateEmits(
            '0.0.2',
            'com.example.validation',
            validationEmit,
          ),
        ).toThrow();
      });
    });
  });
});
