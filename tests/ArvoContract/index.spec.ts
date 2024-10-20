import { z } from 'zod';
import {
  ArvoContract,
  cleanString,
  createArvoContract,
  InferArvoContract,
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
    uri: '#/contracts/myContract',
    accepts: {
      type: 'com.example.input',
      schema: z.object({ name: z.string() }),
    },
    emits: {
      'com.example.output': z.object({ result: z.number() }),
    },
  };

  describe('createArvoContract', () => {
    it('should create a valid ArvoContract instance', () => {
      const contract = createArvoContract({
        uri: '#/contracts/myContract',
        accepts: {
          type: 'com.example.input',
          schema: z.object({ name: z.string() }),
        },
        emits: {
          'com.example.output': z.object({ result: z.number() }),
        },
      });
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
        emits: {
          ...validContractSpec.emits,
          'invalid-type': z.object({}),
        },
      };
      expect(() => createArvoContract(invalidSpec)).toThrow();
    });

    it('should throw an error for invalid emit type using orchestrator pattern', () => {
      const invalidSpec = {
        ...validContractSpec,
        emits: {
          ...validContractSpec.emits,
          'arvo.orc.test': z.object({}),
        },
      };
      expect(() => createArvoContract(invalidSpec)).toThrow(
        cleanString(`
        In contract (uri=#/contracts/myContract), the 'emits' event (type=arvo.orc.test) must not start
        with 'arvo.orc' becuase this a reserved pattern
        for Arvo orchestrators.  
      `),
      );
    });

    it('should throw an error for invalid accept type using orchestrator pattern', () => {
      const invalidSpec = {
        ...validContractSpec,
        accepts: {
          type: 'arvo.orc.test',
          schema: z.object({ name: z.string() }),
        },
      };
      expect(() => createArvoContract(invalidSpec)).toThrow(
        cleanString(`
        In contract (uri=#/contracts/myContract), the 'accepts' event (type=arvo.orc.test) must not start
        with 'arvo.orc' becuase this a reserved pattern
        for Arvo orchestrators.  
      `),
      );
    });

    it('should create a contract with multiple emits', () => {
      const contract = createArvoContract({
        ...validContractSpec,
        emits: {
          ...validContractSpec.emits,
          'com.example.error': z.object({
            message: z.string(),
          }),
        },
      });
      expect(Object.keys(contract.emits)).toHaveLength(2);
      expect(contract.emits['com.example.output']).toBeTruthy();
      expect(contract.emits['com.example.error']).toBeTruthy();
      // @ts-ignore
      expect(contract.emits['com.example.error.saad']).toBeFalsy();
    });

    it('should throw an error for empty emits array', () => {
      const invalidSpec = { ...validContractSpec, emits: {} };
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

    describe('validateAccepts', () => {
      it('should validate a correct input', () => {
        const result = contract.validateAccepts('com.example.input', {
          name: 'John',
        });
        expect(result.success).toBe(true);
      });

      it('should invalidate an incorrect input', () => {
        const result = contract.validateAccepts('com.example.input', {
          name: 123,
        });
        expect(result.success).toBe(false);
      });

      it('should throw an error for an invalid input type', () => {
        expect(() => contract.validateAccepts('invalid-type', {})).toThrow();
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
          complexContract.validateAccepts('com.example.complex', validInput)
            .success,
        ).toBe(true);
        expect(
          complexContract.validateAccepts('com.example.complex', invalidInput)
            .success,
        ).toBe(false);
      });
    });

    describe('validateEmits', () => {
      it('should validate a correct output', () => {
        const result = contract.validateEmits('com.example.output', {
          result: 42,
        });
        expect(result.success).toBe(true);
      });

      it('should invalidate an incorrect output', () => {
        const result = contract.validateEmits('com.example.output', {
          result: 'not a number',
        });
        expect(result.success).toBe(false);
      });

      it('should throw an error for an invalid output type', () => {
        expect(() =>
          contract.validateEmits('invalid-type' as any, {}),
        ).toThrow();
      });

      it('should validate multiple emit types', () => {
        const contract = createArvoContract({
          ...validContractSpec,
          emits: {
            ...validContractSpec.emits,
            'com.example.error': z.object({ message: z.string() }),
          },
        });
        const outputResult = contract.validateEmits('com.example.output', {
          result: 42,
        });
        const errorResult = contract.validateEmits('com.example.error', {
          message: 'Error occurred',
        });

        expect(outputResult.success).toBe(true);
        expect(errorResult.success).toBe(true);
      });

      it('should handle complex output schemas', () => {
        const complexContract = createArvoContract({
          ...validContractSpec,
          emits: {
            'com.example.complex': z.object({
              id: z.number(),
              data: z.array(z.string()),
              nested: z.object({ flag: z.boolean() }),
            }),
          },
        });

        const validOutput = { id: 1, data: ['a', 'b'], nested: { flag: true } };
        const invalidOutput = {
          id: '1',
          data: ['a', 2],
          nested: { flag: 'true' },
        };

        expect(
          complexContract.validateEmits('com.example.complex', validOutput)
            .success,
        ).toBe(true);
        expect(
          complexContract.validateEmits('com.example.complex', invalidOutput)
            .success,
        ).toBe(false);
      });
    });
  });
});
