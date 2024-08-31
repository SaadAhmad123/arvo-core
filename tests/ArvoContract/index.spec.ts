import { z } from 'zod';
import { ArvoContract, createArvoContract, ArvoContractLibrary, ResolveArvoContractRecord } from '../../src';
import { telemetrySdkStart, telemetrySdkStop } from '../utils';

describe('ArvoContract', () => {
  beforeAll(() => {
    telemetrySdkStart();
  });

  afterAll(() => {
    telemetrySdkStop();
  });

  const validContractSpec = {
    uri: '#/contracts/myContract',
    accepts: {
      type: 'com.example.input',
      schema: z.object({ name: z.string() }),
    },
    emits: [
      {
        type: 'com.example.output',
        schema: z.object({ result: z.number() }),
      },
    ],
  };
  
  describe('createArvoContract', () => {
    it('should create a valid ArvoContract instance', () => {
      const contract = createArvoContract(validContractSpec);
      expect(contract).toBeInstanceOf(ArvoContract);
      expect(contract.uri).toBe(validContractSpec.uri);
    });

    it('should throw an error for invalid URI', () => {
      const invalidSpec = {
        ...validContractSpec,
        uri: 'invalid uri with space',
      };
      expect(() => createArvoContract(invalidSpec)).toThrow();
    });

    it('should throw an error for invalid accept type', () => {
      const invalidSpec = {
        ...validContractSpec,
        accepts: { ...validContractSpec.accepts, type: 'invalid-type' },
      };
      expect(() => createArvoContract(invalidSpec)).toThrow();
    });

    it('should throw an error for invalid emit type', () => {
      const invalidSpec = {
        ...validContractSpec,
        emits: [{ ...validContractSpec.emits[0], type: 'invalid-type' }],
      };
      expect(() => createArvoContract(invalidSpec)).toThrow();
    });

    it('should create a contract with multiple emits', () => {
      const contract = createArvoContract({
        ...validContractSpec,
        emits: [
          ...validContractSpec.emits,
          {
            type: 'com.example.error',
            schema: z.object({
              message: z.string(),
            }),
          },
        ],
      });
      expect(Object.keys(contract.emits)).toHaveLength(2);
      expect(contract.emits['com.example.output']).toBeTruthy();
      expect(contract.emits['com.example.error']).toBeTruthy();
      expect(contract.emits['com.example.error.saad']).toBeFalsy();
    });

    it('should throw an error for empty emits array', () => {
      const invalidSpec = { ...validContractSpec, emits: [] };
      expect(() => createArvoContract(invalidSpec)).not.toThrow();
    });
  });

  describe('ArvoContract instance', () => {
    let contract = createArvoContract(validContractSpec);

    beforeEach(() => {
      contract = createArvoContract(validContractSpec);
    });

    it('should have a readonly uri property', () => {
      expect(contract.uri).toBe(validContractSpec.uri);
      expect(() => {
        (contract as any).uri = 'new-uri';
      }).toThrow();
    });

    it('should have a readonly accepts property', () => {
      expect(contract.accepts).toEqual(validContractSpec.accepts);
      expect(() => {
        (contract as any).accepts = {};
      }).toThrow();
    });

    it('should have a readonly emits property', () => {
      expect(contract.getEmit('com.example.output')).toBeTruthy();
      expect(() => {
        (contract as any).emits = {};
      }).toThrow();
    });

    describe('emits property', () => {
      it('should return a frozen object', () => {
        expect(Object.isFrozen(contract.emits)).toBe(true);
      });

      it('should not allow modification of emits', () => {
        expect(() => {
          (contract.emits as any)['com.example.new'] = {
            type: 'com.example.new',
            schema: z.any(),
          };
        }).toThrow();
      });
    });

    describe('getEmit', () => {
      it('should return the correct emit schema for a valid type', () => {
        const emit = contract.getEmit('com.example.output');
        expect(emit).toEqual(validContractSpec.emits[0]);
      });

      it('should throw an error for an invalid emit type', () => {
        expect(() => contract.getEmit('invalid-type')).toThrow();
      });
    });

    describe('validateInput', () => {
      it('should validate a correct input', () => {
        const result = contract.validateInput('com.example.input', {
          name: 'John',
        });
        expect(result.success).toBe(true);
      });

      it('should invalidate an incorrect input', () => {
        const result = contract.validateInput('com.example.input', {
          name: 123,
        });
        expect(result.success).toBe(false);
      });

      it('should throw an error for an invalid input type', () => {
        expect(() => contract.validateInput('invalid-type', {})).toThrow();
      });

      it('should handle complex input schemas', () => {
        const complexContract = createArvoContract({
          ...validContractSpec,
          accepts: {
            type: 'com.example.complex',
            schema: z.object({
              id: z.number(),
              data: z.array(z.string()),
              nested: z.object({ flag: z.boolean() }),
            }),
          },
        });

        const validInput = { id: 1, data: ['a', 'b'], nested: { flag: true } };
        const invalidInput = {
          id: '1',
          data: ['a', 2],
          nested: { flag: 'true' },
        };

        expect(
          complexContract.validateInput('com.example.complex', validInput)
            .success,
        ).toBe(true);
        expect(
          complexContract.validateInput('com.example.complex', invalidInput)
            .success,
        ).toBe(false);
      });
    });

    describe('validateOutput', () => {
      it('should validate a correct output', () => {
        const result = contract.validateOutput('com.example.output', {
          result: 42,
        });
        expect(result.success).toBe(true);
      });

      it('should invalidate an incorrect output', () => {
        const result = contract.validateOutput('com.example.output', {
          result: 'not a number',
        });
        expect(result.success).toBe(false);
      });

      it('should throw an error for an invalid output type', () => {
        expect(() => contract.validateOutput('invalid-type', {})).toThrow();
      });

      it('should validate multiple emit types', () => {
        const contract = createArvoContract({
          ...validContractSpec,
          emits: [
            ...validContractSpec.emits,
            {
              type: 'com.example.error',
              schema: z.object({ message: z.string() }),
            },
          ],
        });
        const outputResult = contract.validateOutput('com.example.output', {
          result: 42,
        });
        const errorResult = contract.validateOutput('com.example.error', {
          message: 'Error occurred',
        });

        expect(outputResult.success).toBe(true);
        expect(errorResult.success).toBe(true);
      });

      it('should handle complex output schemas', () => {
        const complexContract = createArvoContract({
          ...validContractSpec,
          emits: [
            {
              type: 'com.example.complex',
              schema: z.object({
                id: z.number(),
                data: z.array(z.string()),
                nested: z.object({ flag: z.boolean() }),
              }),
            },
          ],
        });

        const validOutput = { id: 1, data: ['a', 'b'], nested: { flag: true } };
        const invalidOutput = {
          id: '1',
          data: ['a', 2],
          nested: { flag: 'true' },
        };

        expect(
          complexContract.validateOutput('com.example.complex', validOutput)
            .success,
        ).toBe(true);
        expect(
          complexContract.validateOutput('com.example.complex', invalidOutput)
            .success,
        ).toBe(false);
      });
    });
  });

  describe('Type inference', () => {
    it('should correctly infer types from the contract specification', () => {
      const contract = createArvoContract(validContractSpec);

      // These type assertions should compile without errors
      const _uri: string = contract.uri;
      const _accepts: { type: string; schema: z.ZodSchema } = contract.accepts;
      const _emits: Record<string, { type: string; schema: z.ZodSchema }> =
        contract.emits;

      // @ts-expect-error
      const _invalidUri: number = contract.uri;
      // @ts-expect-error
      const _invalidAccepts: string = contract.accepts;
      // @ts-expect-error
      const _invalidEmits: string[] = contract.emits;
    });
  });


});
