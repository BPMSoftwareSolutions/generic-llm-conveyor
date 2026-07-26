Feature: Obtain a governed model response

  The generic LLM connector obtains a normalized model response
  under explicit provider, model, execution, and evidence authority.

  Scenario: Obtain a text response from a resolved provider
    Given a valid model request
    And the declared provider authority exists
    And the declared model alias resolves to a supported model
    And one provider attempt is authorized
    When the model response is obtained
    Then the declared provider adapter is invoked exactly once
    And the response disposition is "MODEL_RESPONSE_OBTAINED"
    And the response identifies the resolved provider
    And the response identifies the resolved model
    And the execution receipt contains the request hash
    And the execution receipt contains the response hash

  Scenario: Reject an unknown provider authority
    Given a valid model request
    And the declared provider authority does not exist
    When the model response is requested
    Then no provider adapter is invoked
    And the response disposition is "PROVIDER_AUTHORITY_NOT_FOUND"

  Scenario: Reject an unresolved model alias
    Given a valid model request
    And the declared provider authority exists
    And the declared model alias is not mapped
    When the model response is requested
    Then no provider adapter is invoked
    And the response disposition is "MODEL_ALIAS_NOT_FOUND"

  Scenario: Prevent silent provider substitution
    Given a model request authorizes only the Gemini provider
    And the Gemini provider is unavailable
    When the model response is requested
    Then the Gemini adapter is invoked exactly once
    And no other provider adapter is invoked
    And the response disposition is "PROVIDER_UNAVAILABLE"

  Scenario: Stop after the authorized attempt count
    Given a model request authorizes two attempts
    And the provider reports a transient failure for both attempts
    When the model response is requested
    Then the provider adapter is invoked exactly twice
    And two provider attempt testimonies are recorded
    And the response disposition is "ATTEMPT_AUTHORITY_EXHAUSTED"

  Scenario: Reject a response that violates the required format
    Given a model request requires a structured response
    And the provider returns text that cannot satisfy the declared schema
    When the model response is normalized
    Then the response disposition is "RESPONSE_FORMAT_NOT_SATISFIED"
    And the invalid provider response is represented only by its evidence hash
