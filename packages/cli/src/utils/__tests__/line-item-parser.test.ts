import { describe, expect, it } from 'vitest';
import { parseLineItemFlag, parseTotalFlag } from '../line-item-parser';

describe('parseLineItemFlag', () => {
  it('parses a line item with just name', () => {
    const result = parseLineItemFlag('name:Shoes');
    expect(result).toEqual({ name: 'Shoes' });
  });

  it('parses a line item with all fields', () => {
    const result = parseLineItemFlag(
      'name:Shoes,unit_amount:5000,quantity:2,url:https://nike.com,image_url:https://img.com/shoe.png,description:Running shoes,sku:SKU123,product_url:https://nike.com/shoes',
    );
    expect(result).toEqual({
      name: 'Shoes',
      unit_amount: 5000,
      quantity: 2,
      url: 'https://nike.com',
      image_url: 'https://img.com/shoe.png',
      description: 'Running shoes',
      sku: 'SKU123',
      product_url: 'https://nike.com/shoes',
    });
  });

  it('handles URLs with colons correctly', () => {
    const result = parseLineItemFlag(
      'name:Widget,unit_amount:500,url:https://example.com:8080/path',
    );
    expect(result).toEqual({
      name: 'Widget',
      unit_amount: 500,
      url: 'https://example.com:8080/path',
    });
  });

  it('throws on missing name', () => {
    expect(() => parseLineItemFlag('unit_amount:10')).toThrow('name');
  });

  it('throws when unit_amount is not a number', () => {
    expect(() => parseLineItemFlag('name:Shoes,unit_amount:abc')).toThrow(
      'unit_amount',
    );
  });

  it('throws on unknown keys', () => {
    expect(() => parseLineItemFlag('name:Shoes,color:red')).toThrow('color');
  });

  it('throws on fields missing colon separator', () => {
    expect(() => parseLineItemFlag('name Shoes')).toThrow("missing ':'");
  });
});

describe('parseTotalFlag', () => {
  it('parses a total with all required fields', () => {
    const result = parseTotalFlag('type:total,display_text:Total,amount:5000');
    expect(result).toEqual({
      type: 'total',
      display_text: 'Total',
      amount: 5000,
    });
  });

  it('throws on missing type', () => {
    expect(() => parseTotalFlag('display_text:Total,amount:5000')).toThrow(
      'type',
    );
  });

  it('throws on missing display_text', () => {
    expect(() => parseTotalFlag('type:total,amount:5000')).toThrow(
      'display_text',
    );
  });

  it('throws on missing amount', () => {
    expect(() => parseTotalFlag('type:total,display_text:Total')).toThrow(
      'amount',
    );
  });

  it('throws when amount is not a number', () => {
    expect(() =>
      parseTotalFlag('type:total,display_text:Total,amount:abc'),
    ).toThrow('amount');
  });

  it('throws on unknown keys', () => {
    expect(() =>
      parseTotalFlag('type:total,display_text:Total,amount:5000,extra:value'),
    ).toThrow('extra');
  });

  it('throws on fields missing colon separator', () => {
    expect(() => parseTotalFlag('type total')).toThrow("missing ':'");
  });
});
