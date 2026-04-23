import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { type InputSchema, resolveInput } from '../json-options';

const SCHEMA: InputSchema = {
  amount: {
    schema: z.number(),
    flag: '--amount <value>',
    description: 'Amount',
  },
  merchant_name: {
    schema: z.string().min(1),
    flag: '--merchant-name <name>',
    description: 'Merchant name',
  },
};

describe('resolveInput', () => {
  describe('flags path (no --json)', () => {
    it('returns snake_case keys from flag values', () => {
      const result = resolveInput(
        { amount: 49.99, merchantName: 'Adidas' },
        SCHEMA,
      );
      expect(result).toEqual({ amount: 49.99, merchant_name: 'Adidas' });
    });

    it('omits missing flags from the result', () => {
      const result = resolveInput({ amount: 10 }, SCHEMA);
      expect(result).toEqual({ amount: 10 });
    });
  });

  describe('JSON path (--json)', () => {
    it('returns snake_case keys from JSON input', () => {
      const result = resolveInput(
        { json: '{"amount": 49.99, "merchant_name": "Adidas"}' },
        SCHEMA,
      );
      expect(result).toEqual({ amount: 49.99, merchant_name: 'Adidas' });
    });

    it('handles partial JSON (subset of fields)', () => {
      const result = resolveInput({ json: '{"amount": 25}' }, SCHEMA);
      expect(result).toEqual({ amount: 25 });
    });
  });

  describe('conflict detection', () => {
    it('throws when --json is combined with individual flags', () => {
      expect(() =>
        resolveInput({ json: '{"amount": 10}', amount: 10 }, SCHEMA),
      ).toThrow('Cannot combine --json');
    });
  });

  describe('JSON parse errors', () => {
    it('throws on invalid JSON syntax', () => {
      expect(() => resolveInput({ json: '{bad' }, SCHEMA)).toThrow(
        'Invalid JSON',
      );
    });

    it('throws when JSON is an array', () => {
      expect(() => resolveInput({ json: '[1, 2]' }, SCHEMA)).toThrow(
        'expected object',
      );
    });

    it('throws on unrecognized keys', () => {
      expect(() => resolveInput({ json: '{"foo": 1}' }, SCHEMA)).toThrow(
        'Unrecognized key',
      );
    });
  });

  describe('type validation', () => {
    it('throws when a number field receives a string', () => {
      expect(() =>
        resolveInput({ outputJson: true, json: '{"amount": "fifty"}' }, SCHEMA),
      ).toThrow('amount');
    });

    it('throws when a string field receives a number', () => {
      expect(() =>
        resolveInput(
          { outputJson: true, json: '{"merchant_name": 123}' },
          SCHEMA,
        ),
      ).toThrow('merchant_name');
    });

    it('throws when a string field receives an empty string', () => {
      expect(() =>
        resolveInput(
          { outputJson: true, json: '{"merchant_name": ""}' },
          SCHEMA,
        ),
      ).toThrow('merchant_name');
    });
  });

  describe('error label format', () => {
    it('uses flag names when --output-json is not set', () => {
      expect(() => resolveInput({ amount: 'fifty' }, SCHEMA)).toThrow(
        '--amount',
      );
    });

    it('uses flag names for multi-word flags when --output-json is not set', () => {
      expect(() => resolveInput({ merchantName: '' }, SCHEMA)).toThrow(
        '--merchant-name',
      );
    });

    it('uses field names when --output-json is set', () => {
      expect(() =>
        resolveInput({ outputJson: true, amount: 'fifty' }, SCHEMA),
      ).toThrow('amount:');
    });

    it('does not use snake_case field names in interactive mode', () => {
      const fn = () => resolveInput({ amount: 'fifty' }, SCHEMA);
      expect(fn).not.toThrow(expect.stringMatching(/^amount:/));
    });
  });

  describe('boolean field type', () => {
    const schemaWithBool: InputSchema = {
      enabled: {
        schema: z.boolean(),
        flag: '--enabled',
        description: 'Enable feature',
      },
    };

    it('accepts a true boolean value', () => {
      const result = resolveInput(
        { json: '{"enabled": true}' },
        schemaWithBool,
      );
      expect(result).toEqual({ enabled: true });
    });

    it('accepts a false boolean value', () => {
      const result = resolveInput(
        { json: '{"enabled": false}' },
        schemaWithBool,
      );
      expect(result).toEqual({ enabled: false });
    });

    it('throws when a boolean field receives a string', () => {
      expect(() =>
        resolveInput({ json: '{"enabled": "yes"}' }, schemaWithBool),
      ).toThrow('enabled');
    });

    it('throws when a boolean field receives a number', () => {
      expect(() =>
        resolveInput({ json: '{"enabled": 1}' }, schemaWithBool),
      ).toThrow('enabled');
    });
  });

  describe('array field type', () => {
    const schemaWithArray: InputSchema = {
      items: {
        schema: z.array(z.unknown()),
        flag: '--item <item>',
        description: 'Items',
      },
    };

    it('accepts an array value', () => {
      const result = resolveInput(
        { json: '{"items": [1, 2, 3]}' },
        schemaWithArray,
      );
      expect(result).toEqual({ items: [1, 2, 3] });
    });

    it('accepts an empty array', () => {
      const result = resolveInput({ json: '{"items": []}' }, schemaWithArray);
      expect(result).toEqual({ items: [] });
    });

    it('throws when an array field receives an object', () => {
      expect(() =>
        resolveInput(
          { outputJson: true, json: '{"items": {"a": 1}}' },
          schemaWithArray,
        ),
      ).toThrow('items');
    });

    it('throws when an array field receives a string', () => {
      expect(() =>
        resolveInput(
          { outputJson: true, json: '{"items": "not-array"}' },
          schemaWithArray,
        ),
      ).toThrow('items');
    });
  });
});
