import { PaymentMethodsResource, SpendRequestResource } from '@stripe/link-sdk';
import { describe, expect, it } from 'vitest';
import { LinkAuthResource } from '../../auth/auth-resource';
import { ResourceFactory } from '../resource-factory';

describe('ResourceFactory', () => {
  it('caches resource instances', () => {
    const factory = new ResourceFactory();

    expect(factory.createAuthResource()).toBe(factory.createAuthResource());
    expect(factory.createSpendRequestResource()).toBe(
      factory.createSpendRequestResource(),
    );
    expect(factory.createPaymentMethodsResource()).toBe(
      factory.createPaymentMethodsResource(),
    );
    expect(factory.createAuthResource()).toBeInstanceOf(LinkAuthResource);
    expect(factory.createSpendRequestResource()).toBeInstanceOf(
      SpendRequestResource,
    );
    expect(factory.createPaymentMethodsResource()).toBeInstanceOf(
      PaymentMethodsResource,
    );
  });
});
