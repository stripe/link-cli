import { z } from 'zod';

// Backend inventory rechecked 2026-11-05, Mint b1a3f78603596df4c39a5dd82d4733e690b43b50.
// Producer messages checked at bad8deae / 34139ea; compatibility is not a live-producer claim.
export const declaredActionTypes = [
  'ssn_verification',
  'identity_verification',
  'credit_file_match_ca',
  'rfc_verification_mx',
  'doc_upload_ca',
  'contact_support',
  'select_payment_method',
  'retry_without_delegated_approval',
  'add_payment_method',
  'update_payment_method',
  're_authorize',
  'three_d_secure',
  'three_d_secure_retry',
  'partner_auth_challenge',
  'partner_auth_challenge_retry',
  'partner_create_card_enrollment',
  'reauthorize_additional_scope',
] as const;
export const resolutions = [
  'auto_resume',
  'create_new_spend_request',
  'create_new_spend_request_after_completion',
  'reauthorize_with_additional_scope',
] as const;

// URL shapes rechecked against Mint 6c9007027432c3321bd1a3991fb7877e612eaeca:
// LinkUrlBuilder and create_partner_initiated_spend_request/build_verification_url.
// Keep real route/query shapes under a synthetic namespace, using fixed fake inputs.
// CLI-local schema: the real SDK union intentionally does not constrain fixtures.
export const simulationActionSchema = z
  .object({
    type: z
      .union([
        z.enum(declaredActionTypes),
        z.literal('future_verification_example'),
      ])
      .nullable(),
    resolution: z.enum(resolutions),
    display_message: z.string().min(1),
    action_url: z.url().nullable().optional(),
    expires_at: z.iso.datetime().nullable().optional(),
  })
  .strict()
  .nullable();
export type SimulationAction = z.infer<typeof simulationActionSchema>;

type Scenario = {
  scenario: string;
  type: string | null;
  resolution: (typeof resolutions)[number] | null;
  url_kind: 'present' | 'null' | 'absent';
  evidence_kind:
    | 'verified_producer'
    | 'contract_variant'
    | 'documented_compatibility'
    | 'control'
    | 'defensive_sample';
  description: string;
  source_envelope:
    | 'record_status_details'
    | 'error_next_action'
    | 'documented_compatibility'
    | 'synthetic_control';
  aliases: string[];
  expected_continuation:
    | 'keep_same_request'
    | 'create_new_request'
    | 'complete_then_create_new_request'
    | 'obtain_required_scope'
    | 'no_action';
  action: SimulationAction;
};

// Private storage: only fresh copies are exposed, including descriptors and aliases.
const registry: readonly Scenario[] = [
  {
    scenario: 'ssn_verification',
    type: 'ssn_verification',
    resolution: 'create_new_spend_request_after_completion',
    url_kind: 'present',
    evidence_kind: 'verified_producer',
    description:
      'Additional identity verification is required. Please verify your SSN to continue.',
    source_envelope: 'record_status_details',
    aliases: [],
    expected_continuation: 'complete_then_create_new_request',
    action: {
      type: 'ssn_verification',
      resolution: 'create_new_spend_request_after_completion',
      display_message:
        'Additional identity verification is required. Please verify your SSN to continue.',
      action_url:
        'https://example.invalid/link-simulation/finish_setup?verify=ssn_collection&intended_email=agent%2Bsimulation%40example.invalid&fromEmail=agent%2Bsimulation%40example.invalid',
      expires_at: null,
    },
  },
  {
    scenario: 'identity_verification',
    type: 'identity_verification',
    resolution: 'create_new_spend_request_after_completion',
    url_kind: 'present',
    evidence_kind: 'verified_producer',
    description:
      'Additional identity verification is required. Please complete identity verification to continue.',
    source_envelope: 'record_status_details',
    aliases: [],
    expected_continuation: 'complete_then_create_new_request',
    action: {
      type: 'identity_verification',
      resolution: 'create_new_spend_request_after_completion',
      display_message:
        'Additional identity verification is required. Please complete identity verification to continue.',
      action_url:
        'https://example.invalid/link-simulation/finish_setup?verify=identity_verification&intended_email=agent%2Bsimulation%40example.invalid&fromEmail=agent%2Bsimulation%40example.invalid',
      expires_at: null,
    },
  },
  {
    scenario: 'credit_file_match_ca',
    type: 'credit_file_match_ca',
    resolution: 'create_new_spend_request_after_completion',
    url_kind: 'present',
    evidence_kind: 'verified_producer',
    description: 'Additional identity verification is required to continue.',
    source_envelope: 'record_status_details',
    aliases: [],
    expected_continuation: 'complete_then_create_new_request',
    action: {
      type: 'credit_file_match_ca',
      resolution: 'create_new_spend_request_after_completion',
      display_message:
        'Additional identity verification is required to continue.',
      action_url:
        'https://example.invalid/link-simulation/finish_setup?verify=credit_file_match_ca&regional_verification=ca&intended_email=agent%2Bsimulation%40example.invalid&fromEmail=agent%2Bsimulation%40example.invalid',
      expires_at: null,
    },
  },
  {
    scenario: 'rfc_verification_mx',
    type: 'rfc_verification_mx',
    resolution: 'create_new_spend_request_after_completion',
    url_kind: 'present',
    evidence_kind: 'verified_producer',
    description: 'Additional identity verification is required to continue.',
    source_envelope: 'record_status_details',
    aliases: [],
    expected_continuation: 'complete_then_create_new_request',
    action: {
      type: 'rfc_verification_mx',
      resolution: 'create_new_spend_request_after_completion',
      display_message:
        'Additional identity verification is required to continue.',
      action_url:
        'https://example.invalid/link-simulation/finish_setup?verify=rfc_verification_mx&regional_verification=mx&intended_email=agent%2Bsimulation%40example.invalid&fromEmail=agent%2Bsimulation%40example.invalid',
      expires_at: null,
    },
  },
  {
    scenario: 'doc_upload_ca',
    type: 'doc_upload_ca',
    resolution: 'create_new_spend_request_after_completion',
    url_kind: 'present',
    evidence_kind: 'verified_producer',
    description: 'Additional identity verification is required to continue.',
    source_envelope: 'record_status_details',
    aliases: [],
    expected_continuation: 'complete_then_create_new_request',
    action: {
      type: 'doc_upload_ca',
      resolution: 'create_new_spend_request_after_completion',
      display_message:
        'Additional identity verification is required to continue.',
      action_url:
        'https://example.invalid/link-simulation/finish_setup?verify=doc_upload_ca&regional_verification=ca&intended_email=agent%2Bsimulation%40example.invalid&fromEmail=agent%2Bsimulation%40example.invalid',
      expires_at: null,
    },
  },
  {
    scenario: 'contact_support',
    type: 'contact_support',
    resolution: 'create_new_spend_request_after_completion',
    url_kind: 'present',
    evidence_kind: 'verified_producer',
    description: 'Identity verification has failed. Please contact support.',
    source_envelope: 'record_status_details',
    aliases: [],
    expected_continuation: 'complete_then_create_new_request',
    action: {
      type: 'contact_support',
      resolution: 'create_new_spend_request_after_completion',
      display_message:
        'Identity verification has failed. Please contact support.',
      action_url: 'https://example.invalid/link-simulation/',
      expires_at: null,
    },
  },
  {
    scenario: 'select_payment_method',
    type: 'select_payment_method',
    resolution: 'create_new_spend_request',
    url_kind: 'null',
    evidence_kind: 'verified_producer',
    description:
      'This card is not eligible for agentic payments. Link did not decline this transaction. Please contact your bank for more information, and try again with a different card.',
    source_envelope: 'record_status_details',
    aliases: [],
    expected_continuation: 'create_new_request',
    action: {
      type: 'select_payment_method',
      resolution: 'create_new_spend_request',
      display_message:
        'This card is not eligible for agentic payments. Link did not decline this transaction. Please contact your bank for more information, and try again with a different card.',
      action_url: null,
      expires_at: null,
    },
  },
  {
    scenario: 'retry_without_delegated_approval',
    type: 'retry_without_delegated_approval',
    resolution: 'create_new_spend_request',
    url_kind: 'null',
    evidence_kind: 'verified_producer',
    description:
      'Visa requires additional action to complete. Retry the spend request without delegated approval.',
    source_envelope: 'error_next_action',
    aliases: [],
    expected_continuation: 'create_new_request',
    action: {
      type: 'retry_without_delegated_approval',
      resolution: 'create_new_spend_request',
      display_message:
        'Visa requires additional action to complete. Retry the spend request without delegated approval.',
      action_url: null,
      expires_at: null,
    },
  },
  {
    scenario: 'add_payment_method',
    type: 'add_payment_method',
    resolution: 'create_new_spend_request_after_completion',
    url_kind: 'present',
    evidence_kind: 'verified_producer',
    description:
      'This card is not eligible for agentic payments. Link did not decline this transaction. Please contact your bank for more information, and try again with a different card.',
    source_envelope: 'record_status_details',
    aliases: [],
    expected_continuation: 'complete_then_create_new_request',
    action: {
      type: 'add_payment_method',
      resolution: 'create_new_spend_request_after_completion',
      display_message:
        'This card is not eligible for agentic payments. Link did not decline this transaction. Please contact your bank for more information, and try again with a different card.',
      action_url:
        'https://example.invalid/link-simulation/wallet?link_action=add_payment_method&spend_request_id=lsrq_simulation',
      expires_at: null,
    },
  },
  {
    scenario: 'update_payment_method',
    type: 'update_payment_method',
    resolution: 'create_new_spend_request',
    url_kind: 'present',
    evidence_kind: 'verified_producer',
    description:
      'Your payment failed because your billing address could not be verified. Please update your card details and try again.',
    source_envelope: 'record_status_details',
    aliases: [],
    expected_continuation: 'create_new_request',
    action: {
      type: 'update_payment_method',
      resolution: 'create_new_spend_request',
      display_message:
        'Your payment failed because your billing address could not be verified. Please update your card details and try again.',
      action_url:
        'https://example.invalid/link-simulation/wallet?link_action=update_payment_method&spend_request_id=lsrq_simulation',
      expires_at: null,
    },
  },
  {
    scenario: 're_authorize',
    type: 're_authorize',
    resolution: 'create_new_spend_request',
    url_kind: 'null',
    evidence_kind: 'verified_producer',
    description:
      'This transaction exceeded your authorized spend amount. Please try your payment again.',
    source_envelope: 'record_status_details',
    aliases: [],
    expected_continuation: 'create_new_request',
    action: {
      type: 're_authorize',
      resolution: 'create_new_spend_request',
      display_message:
        'This transaction exceeded your authorized spend amount. Please try your payment again.',
      action_url: null,
      expires_at: null,
    },
  },
  {
    scenario: 'three_d_secure',
    type: 'three_d_secure',
    resolution: 'auto_resume',
    url_kind: 'present',
    evidence_kind: 'verified_producer',
    description:
      'Your bank requires additional verification to complete this payment. Please complete the verification to continue.',
    source_envelope: 'record_status_details',
    aliases: [],
    expected_continuation: 'keep_same_request',
    action: {
      type: 'three_d_secure',
      resolution: 'auto_resume',
      display_message:
        'Your bank requires additional verification to complete this payment. Please complete the verification to continue.',
      action_url:
        'https://example.invalid/link-simulation/finish_setup?verify=3ds_complete&spend_request_id=lsrq_simulation&intended_email=agent%2Bsimulation%40example.invalid&fromEmail=agent%2Bsimulation%40example.invalid',
      expires_at: '2099-01-01T00:30:00Z',
    },
  },
  {
    scenario: 'three_d_secure_retry',
    type: 'three_d_secure_retry',
    resolution: 'create_new_spend_request',
    url_kind: 'null',
    evidence_kind: 'verified_producer',
    description:
      'The verification attempt failed. Please create a new request to try again.',
    source_envelope: 'record_status_details',
    aliases: [],
    expected_continuation: 'create_new_request',
    action: {
      type: 'three_d_secure_retry',
      resolution: 'create_new_spend_request',
      display_message:
        'The verification attempt failed. Please create a new request to try again.',
      action_url: null,
      expires_at: null,
    },
  },
  {
    scenario: 'partner_auth_challenge',
    type: 'partner_auth_challenge',
    resolution: 'auto_resume',
    url_kind: 'present',
    evidence_kind: 'verified_producer',
    description:
      'Your card requires additional verification to complete this payment. Please complete the verification to continue.',
    source_envelope: 'record_status_details',
    aliases: ['visa_otp'],
    expected_continuation: 'keep_same_request',
    action: {
      type: 'partner_auth_challenge',
      resolution: 'auto_resume',
      display_message:
        'Your card requires additional verification to complete this payment. Please complete the verification to continue.',
      action_url:
        'https://example.invalid/link-simulation/activity/approve/lsrq_simulation',
      expires_at: null,
    },
  },
  {
    scenario: 'partner_auth_challenge_retry',
    type: 'partner_auth_challenge_retry',
    resolution: 'create_new_spend_request',
    url_kind: 'null',
    evidence_kind: 'documented_compatibility',
    description:
      'Declared and documented retry contract; no active constructor verified. Current no-retry handling can select or add a payment method.',
    source_envelope: 'documented_compatibility',
    aliases: [],
    expected_continuation: 'create_new_request',
    action: {
      type: 'partner_auth_challenge_retry',
      resolution: 'create_new_spend_request',
      display_message:
        'The verification attempt failed. Please create a new request to try again.',
      action_url: null,
      expires_at: null,
    },
  },
  {
    scenario: 'partner_create_card_enrollment',
    type: 'partner_create_card_enrollment',
    resolution: 'auto_resume',
    url_kind: 'present',
    evidence_kind: 'verified_producer',
    description: 'Please continue to finish setting up your payment.',
    source_envelope: 'record_status_details',
    aliases: [],
    expected_continuation: 'keep_same_request',
    action: {
      type: 'partner_create_card_enrollment',
      resolution: 'auto_resume',
      display_message: 'Please continue to finish setting up your payment.',
      action_url:
        'https://example.invalid/link-simulation/activity/approve/lsrq_simulation',
      expires_at: null,
    },
  },
  {
    scenario: 'reauthorize_additional_scope',
    type: 'reauthorize_additional_scope',
    resolution: 'reauthorize_with_additional_scope',
    url_kind: 'absent',
    evidence_kind: 'verified_producer',
    description:
      'Missing delegated-approval scope; producer uses HTTP 403 with a compacted top-level next_action. Simulation exits successfully and does not emulate HTTP errors.',
    source_envelope: 'error_next_action',
    aliases: [],
    expected_continuation: 'obtain_required_scope',
    action: {
      type: 'reauthorize_additional_scope',
      resolution: 'reauthorize_with_additional_scope',
      display_message:
        'The access token is missing the scope required for delegated approval. Re-authenticate the consumer with the required scope.',
    },
  },
  {
    scenario: 'identity_verification_ca',
    type: 'identity_verification',
    resolution: 'create_new_spend_request_after_completion',
    url_kind: 'present',
    evidence_kind: 'contract_variant',
    description: 'Configured regional identity verification: ca.',
    source_envelope: 'record_status_details',
    aliases: [],
    expected_continuation: 'complete_then_create_new_request',
    action: {
      type: 'identity_verification',
      resolution: 'create_new_spend_request_after_completion',
      display_message:
        'Additional identity verification is required to continue.',
      action_url:
        'https://example.invalid/link-simulation/finish_setup?verify=identity_verification&regional_verification=ca&intended_email=agent%2Bsimulation%40example.invalid&fromEmail=agent%2Bsimulation%40example.invalid',
      expires_at: null,
    },
  },
  {
    scenario: 'identity_verification_mx',
    type: 'identity_verification',
    resolution: 'create_new_spend_request_after_completion',
    url_kind: 'present',
    evidence_kind: 'contract_variant',
    description: 'Configured regional identity verification: mx.',
    source_envelope: 'record_status_details',
    aliases: [],
    expected_continuation: 'complete_then_create_new_request',
    action: {
      type: 'identity_verification',
      resolution: 'create_new_spend_request_after_completion',
      display_message:
        'Additional identity verification is required to continue.',
      action_url:
        'https://example.invalid/link-simulation/finish_setup?verify=identity_verification&regional_verification=mx&intended_email=agent%2Bsimulation%40example.invalid&fromEmail=agent%2Bsimulation%40example.invalid',
      expires_at: null,
    },
  },
  {
    scenario: 'identity_verification_jp',
    type: 'identity_verification',
    resolution: 'create_new_spend_request_after_completion',
    url_kind: 'present',
    evidence_kind: 'contract_variant',
    description: 'Configured regional identity verification: jp.',
    source_envelope: 'record_status_details',
    aliases: [],
    expected_continuation: 'complete_then_create_new_request',
    action: {
      type: 'identity_verification',
      resolution: 'create_new_spend_request_after_completion',
      display_message:
        'Additional identity verification is required to continue.',
      action_url:
        'https://example.invalid/link-simulation/finish_setup?verify=identity_verification&regional_verification=jp&intended_email=agent%2Bsimulation%40example.invalid&fromEmail=agent%2Bsimulation%40example.invalid',
      expires_at: null,
    },
  },
  {
    scenario: 'identity_verification_sg',
    type: 'identity_verification',
    resolution: 'create_new_spend_request_after_completion',
    url_kind: 'present',
    evidence_kind: 'contract_variant',
    description: 'Configured regional identity verification: sg.',
    source_envelope: 'record_status_details',
    aliases: [],
    expected_continuation: 'complete_then_create_new_request',
    action: {
      type: 'identity_verification',
      resolution: 'create_new_spend_request_after_completion',
      display_message:
        'Additional identity verification is required to continue.',
      action_url:
        'https://example.invalid/link-simulation/finish_setup?verify=identity_verification&regional_verification=sg&intended_email=agent%2Bsimulation%40example.invalid&fromEmail=agent%2Bsimulation%40example.invalid',
      expires_at: null,
    },
  },
  {
    scenario: 'credit_file_match_ca_pending',
    type: 'credit_file_match_ca',
    resolution: 'create_new_spend_request_after_completion',
    url_kind: 'null',
    evidence_kind: 'contract_variant',
    description:
      'Shared pending requirement suppresses URL; not a claim about live regional/account availability.',
    source_envelope: 'record_status_details',
    aliases: [],
    expected_continuation: 'complete_then_create_new_request',
    action: {
      type: 'credit_file_match_ca',
      resolution: 'create_new_spend_request_after_completion',
      display_message:
        'Additional identity verification is required to continue.',
      action_url: null,
      expires_at: null,
    },
  },
  {
    scenario: 'rfc_verification_mx_pending',
    type: 'rfc_verification_mx',
    resolution: 'create_new_spend_request_after_completion',
    url_kind: 'null',
    evidence_kind: 'contract_variant',
    description:
      'Shared pending requirement suppresses URL; not a claim about live regional/account availability.',
    source_envelope: 'record_status_details',
    aliases: [],
    expected_continuation: 'complete_then_create_new_request',
    action: {
      type: 'rfc_verification_mx',
      resolution: 'create_new_spend_request_after_completion',
      display_message:
        'Additional identity verification is required to continue.',
      action_url: null,
      expires_at: null,
    },
  },
  {
    scenario: 'identity_verification_pending',
    type: 'identity_verification',
    resolution: 'create_new_spend_request_after_completion',
    url_kind: 'null',
    evidence_kind: 'contract_variant',
    description:
      'Shared pending requirement suppresses URL; not a claim about live regional/account availability.',
    source_envelope: 'record_status_details',
    aliases: [],
    expected_continuation: 'complete_then_create_new_request',
    action: {
      type: 'identity_verification',
      resolution: 'create_new_spend_request_after_completion',
      display_message:
        'Additional identity verification is required to continue.',
      action_url: null,
      expires_at: null,
    },
  },
  {
    scenario: 'doc_upload_ca_pending',
    type: 'doc_upload_ca',
    resolution: 'create_new_spend_request_after_completion',
    url_kind: 'null',
    evidence_kind: 'contract_variant',
    description:
      'Shared pending requirement suppresses URL; not a claim about live regional/account availability.',
    source_envelope: 'record_status_details',
    aliases: [],
    expected_continuation: 'complete_then_create_new_request',
    action: {
      type: 'doc_upload_ca',
      resolution: 'create_new_spend_request_after_completion',
      display_message:
        'Additional identity verification is required to continue.',
      action_url: null,
      expires_at: null,
    },
  },
  {
    scenario: 'update_payment_method_cvc',
    type: 'update_payment_method',
    resolution: 'create_new_spend_request',
    url_kind: 'present',
    evidence_kind: 'verified_producer',
    description:
      "Your payment failed because your card's security code could not be verified. Please update your card details and try again.",
    source_envelope: 'record_status_details',
    aliases: [],
    expected_continuation: 'create_new_request',
    action: {
      type: 'update_payment_method',
      resolution: 'create_new_spend_request',
      display_message:
        "Your payment failed because your card's security code could not be verified. Please update your card details and try again.",
      action_url:
        'https://example.invalid/link-simulation/wallet?link_action=update_payment_method&spend_request_id=lsrq_simulation',
      expires_at: null,
    },
  },
  {
    scenario: 'update_payment_method_missing_cardholder_name',
    type: 'update_payment_method',
    resolution: 'create_new_spend_request',
    url_kind: 'present',
    evidence_kind: 'verified_producer',
    description:
      'Your payment failed because your card is missing a cardholder name. Please update your card details and try again.',
    source_envelope: 'record_status_details',
    aliases: [],
    expected_continuation: 'create_new_request',
    action: {
      type: 'update_payment_method',
      resolution: 'create_new_spend_request',
      display_message:
        'Your payment failed because your card is missing a cardholder name. Please update your card details and try again.',
      action_url:
        'https://example.invalid/link-simulation/wallet?link_action=update_payment_method&spend_request_id=lsrq_simulation',
      expires_at: null,
    },
  },
  {
    scenario: 'update_payment_method_expired',
    type: 'update_payment_method',
    resolution: 'create_new_spend_request',
    url_kind: 'present',
    evidence_kind: 'verified_producer',
    description:
      'Your payment method has expired. Please update it in your Link wallet and try again.',
    source_envelope: 'record_status_details',
    aliases: [],
    expected_continuation: 'create_new_request',
    action: {
      type: 'update_payment_method',
      resolution: 'create_new_spend_request',
      display_message:
        'Your payment method has expired. Please update it in your Link wallet and try again.',
      action_url:
        'https://example.invalid/link-simulation/wallet?link_action=update_payment_method&spend_request_id=lsrq_simulation',
      expires_at: null,
    },
  },
  {
    scenario: 'partner_auth_challenge_without_url',
    type: 'partner_auth_challenge',
    resolution: 'auto_resume',
    url_kind: 'null',
    evidence_kind: 'documented_compatibility',
    description:
      'Documented no-URL partner verification contract; still display the message.',
    source_envelope: 'documented_compatibility',
    aliases: [],
    expected_continuation: 'keep_same_request',
    action: {
      type: 'partner_auth_challenge',
      resolution: 'auto_resume',
      display_message:
        'Your card requires additional verification to complete this payment. Please complete the verification to continue.',
      action_url: null,
      expires_at: null,
    },
  },
  {
    scenario: 'no_next_action',
    type: null,
    resolution: null,
    url_kind: 'absent',
    evidence_kind: 'control',
    description:
      'No action; do not invent a link or claim approval/payment success.',
    source_envelope: 'synthetic_control',
    aliases: [],
    expected_continuation: 'no_action',
    action: null,
  },
  {
    scenario: 'three_d_secure_expired',
    type: 'three_d_secure',
    resolution: 'auto_resume',
    url_kind: 'present',
    evidence_kind: 'defensive_sample',
    description:
      'Fixed expired session; inspect a current real response in an actual workflow. Does not model server cleanup timing.',
    source_envelope: 'synthetic_control',
    aliases: [],
    expected_continuation: 'keep_same_request',
    action: {
      type: 'three_d_secure',
      resolution: 'auto_resume',
      display_message:
        'Your bank requires additional verification to complete this payment. Please complete the verification to continue.',
      action_url:
        'https://example.invalid/link-simulation/finish_setup?verify=3ds_complete&spend_request_id=lsrq_simulation&intended_email=agent%2Bsimulation%40example.invalid&fromEmail=agent%2Bsimulation%40example.invalid',
      expires_at: '2000-01-01T00:00:00Z',
    },
  },
  {
    scenario: 'three_d_secure_without_expiry',
    type: 'three_d_secure',
    resolution: 'auto_resume',
    url_kind: 'present',
    evidence_kind: 'defensive_sample',
    description:
      'Optional/older expiry field omitted; not current producer output.',
    source_envelope: 'synthetic_control',
    aliases: [],
    expected_continuation: 'keep_same_request',
    action: {
      type: 'three_d_secure',
      resolution: 'auto_resume',
      display_message:
        'Your bank requires additional verification to complete this payment. Please complete the verification to continue.',
      action_url:
        'https://example.invalid/link-simulation/finish_setup?verify=3ds_complete&spend_request_id=lsrq_simulation&intended_email=agent%2Bsimulation%40example.invalid&fromEmail=agent%2Bsimulation%40example.invalid',
    },
  },
  {
    scenario: 'null_action_type',
    type: null,
    resolution: 'auto_resume',
    url_kind: 'present',
    evidence_kind: 'defensive_sample',
    description:
      'Synthetic schema resilience case; not a declared production type.',
    source_envelope: 'synthetic_control',
    aliases: [],
    expected_continuation: 'keep_same_request',
    action: {
      type: null,
      resolution: 'auto_resume',
      display_message:
        'Synthetic verification example. Please present the supplied URL to the user.',
      action_url: 'https://example.invalid/link-simulation/null_action_type',
      expires_at: null,
    },
  },
  {
    scenario: 'unknown_action_type',
    type: 'future_verification_example',
    resolution: 'auto_resume',
    url_kind: 'present',
    evidence_kind: 'defensive_sample',
    description:
      'Synthetic schema resilience case; not a declared production type.',
    source_envelope: 'synthetic_control',
    aliases: [],
    expected_continuation: 'keep_same_request',
    action: {
      type: 'future_verification_example',
      resolution: 'auto_resume',
      display_message:
        'Synthetic verification example. Please present the supplied URL to the user.',
      action_url: 'https://example.invalid/link-simulation/unknown_action_type',
      expires_at: null,
    },
  },
];
export const scenarioAliases: Readonly<Record<string, string>> = Object.freeze({
  visa_otp: 'partner_auth_challenge',
});
export function getScenarioIds(): string[] {
  return registry.map(({ scenario }) => scenario);
}
export function getSimulationScenario(id: string): Scenario | undefined {
  const canonical = Object.hasOwn(scenarioAliases, id)
    ? scenarioAliases[id]
    : id;
  const entry = registry.find(({ scenario }) => scenario === canonical);
  return entry ? structuredClone(entry) : undefined;
}
export function listSimulationScenarios() {
  return registry.map(
    ({
      action: _action,
      expected_continuation: _continuation,
      ...descriptor
    }) => structuredClone(descriptor),
  );
}
