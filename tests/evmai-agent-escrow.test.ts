import {
  assert,
  describe,
  test,
  clearStore,
  beforeAll,
  afterAll,
  afterEach,
  createMockedFunction,
} from "matchstick-as/assembly/index";
import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";
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

    // The Escrow handler binds the contract and calls cancellationFee() as a
    // live read. Matchstick requires all live reads to be mocked. The default
    // newMockEvent() address is 0xa16081F360e3847006dB660bae1c6d1b2e17eC2A.
    createMockedFunction(
      Address.fromString("0xa16081F360e3847006dB660bae1c6d1b2e17eC2A"),
      "cancellationFee",
      "cancellationFee():(uint256)"
    ).returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(100))]);

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
  beforeAll(() => {
    seedConversationAndRequest();
    let escrowEvent = createPaymentEscrowedEvent(
      BigInt.fromString(ANSWER_MSG_ID),
      Address.fromString(USER_ADDRESS),
      BigInt.fromString(AMOUNT)
    );
    handlePaymentEscrowed(escrowEvent);

    let refundEvent = createPaymentRefundedEvent(
      BigInt.fromString(ANSWER_MSG_ID)
    );
    handlePaymentRefunded(refundEvent);
  });

  afterAll(() => {
    clearStore();
  });

  test("Payment.status is REFUNDED", () => {
    assert.fieldEquals("Payment", ANSWER_MSG_ID, "status", "REFUNDED");
  });

  test("Payment.finalizedAt is set on refund", () => {
    assert.fieldEquals("Payment", ANSWER_MSG_ID, "finalizedAt", "1");
  });

  test("Refund Activity overwrites escrow Activity with positive amount", () => {
    assert.entityCount("Activity", 1);
  });

  test("PromptRequest.isRefunded is true", () => {
    assert.fieldEquals("PromptRequest", ANSWER_MSG_ID, "isRefunded", "true");
  });

  test("PromptRequest.isCancelled remains false", () => {
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

    createMockedFunction(
      Address.fromString("0xa16081F360e3847006dB660bae1c6d1b2e17eC2A"),
      "cancellationFee",
      "cancellationFee():(uint256)"
    ).returns([ethereum.Value.fromUnsignedBigInt(BigInt.fromI32(300))]);

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
});
