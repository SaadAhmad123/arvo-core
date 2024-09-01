import { z } from 'zod'
import { createArvoContract, ArvoContractLibrary } from "../../src";
import { telemetrySdkStart, telemetrySdkStop } from '../utils';

describe('ArvoContractLibrary', () => {

  beforeAll(() => {
    telemetrySdkStart();
  });

  afterAll(() => {
    telemetrySdkStop();
  });

  const contract1 = createArvoContract({
    uri: '#/contracts/contract1',
    accepts: {
      type: 'com.example.input1',
      schema: z.object({ name: z.string() }),
    },
    emits: 
      {
        'com.example.output1' : z.object({ result: z.number() }),
      },
    
  });

  const contract2 = createArvoContract({
    uri: '#/contracts/contract2',
    accepts: {
      type: 'com.example.input2',
      schema: z.object({ age: z.number() }),
    },
    emits: 
      {
        'com.example.output2': z.object({ success: z.boolean() }),
      },
    
  });

  describe('constructor', () => {
    it('should create a valid ArvoContractLibrary instance', () => {
      const library = new ArvoContractLibrary([contract1, contract2]);
      expect(library).toBeInstanceOf(ArvoContractLibrary);
    });

    it('should throw an error for duplicate URIs', () => {
      expect(() => new ArvoContractLibrary([contract1, contract1])).toThrow();
    });
  });

  describe('list', () => {
    it('should return a readonly array of all contracts', () => {
      const library = new ArvoContractLibrary([contract1, contract2]);
      const list = library.list();
      expect(list).toHaveLength(2);
      expect(list).toContain(contract1);
      expect(list).toContain(contract2);
      expect(Object.isFrozen(list)).toBe(true);
    });
  });

  describe('get', () => {
    const library = new ArvoContractLibrary([contract1, contract2]);

    it('should retrieve a contract by its URI', () => {
      const retrieved = library.get('#/contracts/contract1');
      expect(retrieved).toBe(contract1);
    });

    it('should throw an error for non-existent URI', () => {
      expect(() => library.get('#/contracts/nonexistent' as any)).toThrow();
    });

    it('should return a readonly contract', () => {
      const retrieved = library.get('#/contracts/contract1');
      expect(Object.isFrozen(retrieved)).toBe(true);
    });
  });

  describe('has', () => {
    const library = new ArvoContractLibrary([contract1, contract2]);

    it('should return true for existing URIs', () => {
      expect(library.has('#/contracts/contract1')).toBe(true);
      expect(library.has('#/contracts/contract2')).toBe(true);
    });

    it('should return false for non-existent URIs', () => {
      expect(library.has('#/contracts/nonexistent')).toBe(false);
    });
  });

  describe('size', () => {
    it('should return the correct number of contracts', () => {
      const library1 = new ArvoContractLibrary([contract1, contract2]);
      expect(library1.size).toBe(2);

      const library2 = new ArvoContractLibrary([contract1]);
      expect(library2.size).toBe(1);

      const library3 = new ArvoContractLibrary([]);
      expect(library3.size).toBe(0);
    });
  });
});