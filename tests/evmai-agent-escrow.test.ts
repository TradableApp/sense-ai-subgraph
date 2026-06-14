import {
  assert,
  describe,
  test,
  clearStore,
  beforeAll,
  afterAll,
  afterEach,
} from "matchstick-as/assembly/index";
import { Address, BigInt } from "@graphprotocol/graph-ts";
import {
  handlePaymentEscrowed,
  handlePaymentFinalized,
  handlePaymentRefunded,
  handlePromptCancelled,
  handleSpendingLimitSet,
  handleSpendingLimitCancelled,
} from "../src/evmai-agent-escrow";
import { handleConversationAdded, handlePromptSubmitted } from "../src/evmai-agent";
import { createConversationAddedEvent, createPromptSubmittedEvent } from "./evmai-agent-utils";
import {
  createPaymentEscrowedEvent,
  createPaymentFinalizedEvent,
  createPaymentRefundedEvent,
  createEscrowPromptCancelledEvent,
  createSpendingLimitSetEvent,
  createSpendingLimitCancelledEvent,
} from "./evmai-agent-escrow-utils";
import { FeeConfig } from "../generated/schema";

// Seeds the singleton FeeConfig (all fees 0) so a handler can read the fee it charges
// from the indexed entity instead of an eth_call. Callers set the specific fee + save().
function seedFeeConfig(): FeeConfig {
  let fc = new FeeConfig("singleton");
  fc.promptFee = BigInt.fromI32(0);
  fc.cancellationFee = BigInt.fromI32(0);
  fc.metadataUpdateFee = BigInt.fromI32(0);
  fc.branchFee = BigInt.fromI32(0);
  fc.updatedAt = BigInt.fromI32(1);
  return fc;
}

const USER_ADDRESS = "0x0000000000000000000000000000000000000001";
const CONV_ID = "1";
const PROMPT_MSG_ID = "99";
const ANSWER_MSG_ID = "100";
const AMOUNT = "1000000000000000000"; // 1 token in wei

// Helper: seed a Conversation and PromptRequest in the store
function seedConversationAndRequest(): void {
  let user = Address.fromString(USER_ADDRESS);
  let convEvent = createConversationAddedEvent(
    user,
    BigInt.fromString(CONV_ID),
    "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi",
    "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
  );
  handleConversationAdded(convEvent);

  let promptEvent = createPromptSubmittedEvent(
    user,
    BigInt.fromString(CONV_ID),
    BigInt.fromString(PROMPT_MSG_ID),
    BigInt.fromString(ANSWER_MSG_ID)
  );
  handlePromptSubmitted(promptEvent);
}

// ---------------------------------------------------------------------------
// PaymentFinalized → PromptRequest.isAnswered = true (cross-repo continuity)
// ---------------------------------------------------------------------------
describe("handlePaymentFinalized", () => {
  beforeAll(() => {
    seedConversationAndRequest();

    // Seed payment so we can verify Payment.status too
    let escrowEvent = createPaymentEscrowedEvent(
      BigInt.fromString(ANSWER_MSG_ID),
      Address.fromString(USER_ADDRESS),
      BigInt.fromString(AMOUNT)
    );
    handlePaymentEscrowed(escrowEvent);

    let finalEvent = createPaymentFinalizedEvent(BigInt.fromString(ANSWER_MSG_ID));
    handlePaymentFinalized(finalEvent);
  });

  afterAll(() => {
    clearStore();
  });

  test("Payment status is set to COMPLETE", () => {
    assert.fieldEquals("Payment", ANSWER_MSG_ID, "status", "COMPLETE");
  });

  test("PromptRequest.isAnswered is set to true", () => {
    assert.fieldEquals("PromptRequest", ANSWER_MSG_ID, "isAnswered", "true");
  });
});

// ---------------------------------------------------------------------------
// PaymentRefunded → PromptRequest.isRefunded = true
// ---------------------------------------------------------------------------
describe("handlePaymentRefunded", () => {
  beforeAll(() => {
    seedConversationAndRequest();

    let escrowEvent = createPaymentEscrowedEvent(
      BigInt.fromString(ANSWER_MSG_ID),
      Address.fromString(USER_ADDRESS),
      BigInt.fromString(AMOUNT)
    );
    handlePaymentEscrowed(escrowEvent);

    let refundEvent = createPaymentRefundedEvent(BigInt.fromString(ANSWER_MSG_ID));
    handlePaymentRefunded(refundEvent);
  });

  afterAll(() => {
    clearStore();
  });

  test("Payment status is set to REFUNDED", () => {
    assert.fieldEquals("Payment", ANSWER_MSG_ID, "status", "REFUNDED");
  });

  test("PromptRequest.isRefunded is set to true", () => {
    assert.fieldEquals("PromptRequest", ANSWER_MSG_ID, "isRefunded", "true");
  });

  test("Refund Activity is created", () => {
    // newMockEvent() assigns the same tx hash to all events, so the two Activity
    // IDs (txHash-logIndex) collide and the REFUND write overwrites the CONVERSATION
    // write — only 1 Activity entity exists in the store at any time.
    assert.entityCount("Activity", 1);
  });
});

// ---------------------------------------------------------------------------
// Escrow PromptCancelled → creates Activity only, does NOT touch PromptRequest
// ---------------------------------------------------------------------------
describe("handlePromptCancelled (Escrow)", () => {
  beforeAll(() => {
    seedConversationAndRequest();

    // The Escrow handler reads cancellationFee from the indexed FeeConfig (no eth_call).
    // FeeConfig is intentionally left unset here — this block only asserts the handler
    // does NOT touch PromptRequest; the fee amount is covered in the block below.
    let cancelEvent = createEscrowPromptCancelledEvent(
      Address.fromString(USER_ADDRESS),
      BigInt.fromString(ANSWER_MSG_ID)
    );
    handlePromptCancelled(cancelEvent);
  });

  afterAll(() => {
    clearStore();
  });

  test("PromptRequest.isCancelled remains false (Escrow handler does not set it)", () => {
    assert.fieldEquals("PromptRequest", ANSWER_MSG_ID, "isCancelled", "false");
  });

  test("Activity entity is created for Escrow cancellation", () => {
    assert.entityCount("Activity", 1);
  });
});

// ---------------------------------------------------------------------------
// SpendingLimit lifecycle
// ---------------------------------------------------------------------------
describe("SpendingLimit handlers", () => {
  const ALLOWANCE = "500000000000000000";
  const EXPIRES_AT = "9999999999";

  beforeAll(() => {
    let setEvent = createSpendingLimitSetEvent(
      Address.fromString(USER_ADDRESS),
      BigInt.fromString(ALLOWANCE),
      BigInt.fromString(EXPIRES_AT)
    );
    handleSpendingLimitSet(setEvent);
  });

  afterAll(() => {
    clearStore();
  });

  test("SpendingLimit entity is created with correct fields", () => {
    assert.entityCount("SpendingLimit", 1);
    assert.fieldEquals(
      "SpendingLimit",
      USER_ADDRESS,
      "allowance",
      ALLOWANCE
    );
    assert.fieldEquals(
      "SpendingLimit",
      USER_ADDRESS,
      "expiresAt",
      EXPIRES_AT
    );
  });

  test("SpendingLimitCancelled removes the entity", () => {
    let cancelEvent = createSpendingLimitCancelledEvent(
      Address.fromString(USER_ADDRESS)
    );
    handleSpendingLimitCancelled(cancelEvent);
    assert.entityCount("SpendingLimit", 0);
  });
});

// ---------------------------------------------------------------------------
// PaymentEscrowed — entity creation and Activity
// ---------------------------------------------------------------------------
describe("handlePaymentEscrowed — entity fields", () => {
  afterEach(() => {
    clearStore();
  });

  test("Payment is created with PENDING status", () => {
    let event = createPaymentEscrowedEvent(
      BigInt.fromString(ANSWER_MSG_ID),
      Address.fromString(USER_ADDRESS),
      BigInt.fromString(AMOUNT)
    );
    handlePaymentEscrowed(event);

    assert.entityCount("Payment", 1);
    assert.fieldEquals("Payment", ANSWER_MSG_ID, "status", "PENDING");
    assert.fieldEquals("Payment", ANSWER_MSG_ID, "user", USER_ADDRESS);
    assert.fieldEquals("Payment", ANSWER_MSG_ID, "amount", AMOUNT);
  });

  test("Activity is created with type CONVERSATION and negative amount", () => {
    let event = createPaymentEscrowedEvent(
      BigInt.fromString(ANSWER_MSG_ID),
      Address.fromString(USER_ADDRESS),
      BigInt.fromString(AMOUNT)
    );
    handlePaymentEscrowed(event);

    assert.entityCount("Activity", 1);
    let id =
      event.transaction.hash.toHexString() +
      "-" +
      event.logIndex.toString();
    assert.fieldEquals("Activity", id, "type", "CONVERSATION");
    assert.fieldEquals("Activity", id, "amount", "-" + AMOUNT);
    assert.fieldEquals("Activity", id, "user", USER_ADDRESS);
  });
});

// ---------------------------------------------------------------------------
// PaymentFinalized — sets finalizedAt timestamp
// ---------------------------------------------------------------------------
describe("handlePaymentFinalized — finalizedAt", () => {
  beforeAll(() => {
    seedConversationAndRequest();
    let escrowEvent = createPaymentEscrowedEvent(
      BigInt.fromString(ANSWER_MSG_ID),
      Address.fromString(USER_ADDRESS),
      BigInt.fromString(AMOUNT)
    );
    handlePaymentEscrowed(escrowEvent);

    let finalEvent = createPaymentFinalizedEvent(
      BigInt.fromString(ANSWER_MSG_ID)
    );
    handlePaymentFinalized(finalEvent);
  });

  afterAll(() => {
    clearStore();
  });

  test("Payment.finalizedAt is set on finalization", () => {
    assert.fieldEquals("Payment", ANSWER_MSG_ID, "status", "COMPLETE");
    assert.fieldEquals("Payment", ANSWER_MSG_ID, "finalizedAt", "1");
  });
});

// ---------------------------------------------------------------------------
// PaymentRefunded — sets finalizedAt and creates positive Activity
// ---------------------------------------------------------------------------
describe("handlePaymentRefunded — finalizedAt and Activity amount", () => {
  afterEach(() => {
    clearStore();
  });

  test("Payment.status is REFUNDED and finalizedAt is set", () => {
    seedConversationAndRequest();
    handlePaymentEscrowed(
      createPaymentEscrowedEvent(
        BigInt.fromString(ANSWER_MSG_ID),
        Address.fromString(USER_ADDRESS),
        BigInt.fromString(AMOUNT)
      )
    );
    handlePaymentRefunded(
      createPaymentRefundedEvent(BigInt.fromString(ANSWER_MSG_ID))
    );

    assert.fieldEquals("Payment", ANSWER_MSG_ID, "status", "REFUNDED");
    assert.fieldEquals("Payment", ANSWER_MSG_ID, "finalizedAt", "1");
  });

  test("Refund Activity has type REFUND and positive amount", () => {
    seedConversationAndRequest();
    handlePaymentEscrowed(
      createPaymentEscrowedEvent(
        BigInt.fromString(ANSWER_MSG_ID),
        Address.fromString(USER_ADDRESS),
        BigInt.fromString(AMOUNT)
      )
    );
    let refundEvent = createPaymentRefundedEvent(
      BigInt.fromString(ANSWER_MSG_ID)
    );
    refundEvent.logIndex = BigInt.fromI32(2);
    handlePaymentRefunded(refundEvent);

    assert.entityCount("Activity", 2);
    let refundId =
      refundEvent.transaction.hash.toHex() +
      "-" +
      refundEvent.logIndex.toString();
    assert.fieldEquals("Activity", refundId, "type", "REFUND");
    assert.fieldEquals("Activity", refundId, "amount", AMOUNT);
  });

  test("PromptRequest.isRefunded is true and isCancelled remains false", () => {
    seedConversationAndRequest();
    handlePaymentEscrowed(
      createPaymentEscrowedEvent(
        BigInt.fromString(ANSWER_MSG_ID),
        Address.fromString(USER_ADDRESS),
        BigInt.fromString(AMOUNT)
      )
    );
    handlePaymentRefunded(
      createPaymentRefundedEvent(BigInt.fromString(ANSWER_MSG_ID))
    );

    assert.fieldEquals("PromptRequest", ANSWER_MSG_ID, "isRefunded", "true");
    assert.fieldEquals("PromptRequest", ANSWER_MSG_ID, "isCancelled", "false");
  });
});

// ---------------------------------------------------------------------------
// SpendingLimit — upsert on second set
// ---------------------------------------------------------------------------
describe("SpendingLimit — upsert behaviour", () => {
  const ALLOWANCE = "500000000000000000";
  const UPDATED_ALLOWANCE = "750000000000000000";
  const EXPIRES_AT = "9999999999";

  afterEach(() => {
    clearStore();
  });

  test("second SpendingLimitSet updates existing entity", () => {
    let setEvent1 = createSpendingLimitSetEvent(
      Address.fromString(USER_ADDRESS),
      BigInt.fromString(ALLOWANCE),
      BigInt.fromString(EXPIRES_AT)
    );
    handleSpendingLimitSet(setEvent1);

    let setEvent2 = createSpendingLimitSetEvent(
      Address.fromString(USER_ADDRESS),
      BigInt.fromString(UPDATED_ALLOWANCE),
      BigInt.fromString(EXPIRES_AT)
    );
    handleSpendingLimitSet(setEvent2);

    assert.entityCount("SpendingLimit", 1);
    assert.fieldEquals(
      "SpendingLimit",
      USER_ADDRESS,
      "allowance",
      UPDATED_ALLOWANCE
    );
  });
});

// ---------------------------------------------------------------------------
// Escrow PromptCancelled — Activity amount uses cancellationFee
// ---------------------------------------------------------------------------
describe("handlePromptCancelled (Escrow) — Activity details", () => {
  afterEach(() => {
    clearStore();
  });

  test("Activity amount is negative cancellationFee", () => {
    seedConversationAndRequest();

    // The handler reads cancellationFee from the indexed FeeConfig, NOT via an eth_call.
    let fc = seedFeeConfig();
    fc.cancellationFee = BigInt.fromI32(300);
    fc.save();

    let cancelEvent = createEscrowPromptCancelledEvent(
      Address.fromString(USER_ADDRESS),
      BigInt.fromString(ANSWER_MSG_ID)
    );
    handlePromptCancelled(cancelEvent);

    let id =
      cancelEvent.transaction.hash.toHexString() +
      "-" +
      cancelEvent.logIndex.toString();
    assert.fieldEquals("Activity", id, "type", "CANCEL");
    assert.fieldEquals("Activity", id, "amount", "-300");
  });

  test("Activity amount falls back to 0 when FeeConfig is not yet indexed", () => {
    // FeeConfig deliberately NOT seeded (the initialize() fee events haven't been indexed
    // yet). The handler logs a warning and records 0 rather than reverting/crashing.
    seedConversationAndRequest();

    let cancelEvent = createEscrowPromptCancelledEvent(
      Address.fromString(USER_ADDRESS),
      BigInt.fromString(ANSWER_MSG_ID)
    );
    handlePromptCancelled(cancelEvent);

    let id =
      cancelEvent.transaction.hash.toHexString() +
      "-" +
      cancelEvent.logIndex.toString();
    assert.fieldEquals("Activity", id, "type", "CANCEL");
    assert.fieldEquals("Activity", id, "amount", "0");
  });
});
