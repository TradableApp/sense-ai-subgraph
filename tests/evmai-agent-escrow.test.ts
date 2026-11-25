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
  handleCancellationSettled,
  handleSpendingLimitSet,
  handleSpendingLimitCancelled,
} from "../src/evmai-agent-escrow";
import { handleConversationAdded, handlePromptSubmitted } from "../src/evmai-agent";
import { createConversationAddedEvent, createPromptSubmittedEvent } from "./evmai-agent-utils";
import {
  createPaymentEscrowedEvent,
  createPaymentFinalizedEvent,
  createPaymentRefundedEvent,
  createCancellationSettledEvent,
  createSpendingLimitSetEvent,
  createSpendingLimitCancelledEvent,
} from "./evmai-agent-escrow-utils";
import { Activity, FeeConfig } from "../generated/schema";

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
// Escrow CancellationSettled — the cancel's rows and the payment, from the event's own amounts
// ---------------------------------------------------------------------------
describe("handleCancellationSettled (Escrow)", () => {
  // The escrow held AMOUNT (1000000000000000000) and a cancel cost 300 of it.
  const FEE = "300";
  // 1000000000000000000 - 300
  const RETURNED = "999999999999999700";

  afterEach(() => {
    clearStore();
  });

  function escrowed(): void {
    let escrowEvent = createPaymentEscrowedEvent(
      BigInt.fromString(ANSWER_MSG_ID),
      Address.fromString(USER_ADDRESS),
      BigInt.fromString(AMOUNT)
    );
    escrowEvent.logIndex = BigInt.fromI32(1);
    handlePaymentEscrowed(escrowEvent);
  }

  function settled(fee: string, returned: string): string {
    let event = createCancellationSettledEvent(
      BigInt.fromString(ANSWER_MSG_ID),
      Address.fromString(USER_ADDRESS),
      BigInt.fromString(fee),
      BigInt.fromString(returned)
    );
    event.logIndex = BigInt.fromI32(2);
    handleCancellationSettled(event);
    return event.transaction.hash.toHexString() + "-2";
  }

  test("records CANCEL for minus the fee and CANCEL_RETURN for plus what was returned", () => {
    seedConversationAndRequest();
    escrowed();
    let cancelId = settled(FEE, RETURNED);

    assert.fieldEquals("Activity", cancelId, "type", "CANCEL");
    assert.fieldEquals("Activity", cancelId, "amount", "-" + FEE);
    assert.fieldEquals("Activity", cancelId, "user", USER_ADDRESS);
    assert.fieldEquals("Activity", cancelId + "-return", "type", "CANCEL_RETURN");
    assert.fieldEquals("Activity", cancelId + "-return", "amount", RETURNED);
    assert.fieldEquals("Activity", cancelId + "-return", "user", USER_ADDRESS);
    // CONVERSATION + CANCEL + CANCEL_RETURN.
    assert.entityCount("Activity", 3);
  });

  test("the fee is the event's, whatever FeeConfig holds", () => {
    seedConversationAndRequest();
    let fc = seedFeeConfig();
    // A fee setting of 5 that the event does not agree with: the event is what was charged.
    fc.cancellationFee = BigInt.fromI32(5);
    fc.save();
    escrowed();
    let cancelId = settled(FEE, RETURNED);

    assert.fieldEquals("Activity", cancelId, "amount", "-" + FEE);
  });

  test("CONVERSATION and CANCEL_RETURN sum to minus the fee; the CANCEL row names that fee", () => {
    seedConversationAndRequest();
    escrowed();
    let cancelId = settled(FEE, RETURNED);

    let hash = cancelId.slice(0, cancelId.length - 2);
    let conversation = Activity.load(hash + "-1");
    let cancel = Activity.load(cancelId);
    let returned = Activity.load(cancelId + "-return");
    assert.assertNotNull(conversation);
    assert.assertNotNull(cancel);
    assert.assertNotNull(returned);

    // The fee came out of the escrowed amount, so what moved is the prompt's payment and the
    // return: -1000000000000000000 + 999999999999999700 = -300, the fee the CANCEL row shows.
    let moved = conversation!.amount.plus(returned!.amount);
    assert.stringEquals(moved.toString(), "-" + FEE);
    assert.stringEquals(cancel!.amount.toString(), "-" + FEE);
  });

  test("a fee that took the whole escrowed amount writes a return row of 0", () => {
    seedConversationAndRequest();
    escrowed();
    let cancelId = settled(AMOUNT, "0");

    assert.fieldEquals("Activity", cancelId, "amount", "-" + AMOUNT);
    assert.fieldEquals("Activity", cancelId + "-return", "amount", "0");
  });

  // The escrow closes its record on a cancel. A payment left at PENDING is listed as stuck and
  // later offered a refund the contract refuses.
  test("the Payment is CANCELLED, with its amount and user left as they were", () => {
    seedConversationAndRequest();
    escrowed();
    settled(FEE, RETURNED);

    assert.fieldEquals("Payment", ANSWER_MSG_ID, "status", "CANCELLED");
    assert.fieldEquals("Payment", ANSWER_MSG_ID, "finalizedAt", "1");
    assert.fieldEquals("Payment", ANSWER_MSG_ID, "amount", AMOUNT);
    assert.entityCount("Payment", 1);
  });

  test("with no Payment indexed it creates none and still records both rows", () => {
    seedConversationAndRequest();
    let cancelId = settled(FEE, RETURNED);

    assert.entityCount("Payment", 0);
    assert.fieldEquals("Activity", cancelId, "type", "CANCEL");
    assert.fieldEquals("Activity", cancelId + "-return", "amount", RETURNED);
  });

  test("it does not touch the PromptRequest, which the agent's event marks", () => {
    seedConversationAndRequest();
    escrowed();
    settled(FEE, RETURNED);

    assert.fieldEquals("PromptRequest", ANSWER_MSG_ID, "isCancelled", "false");
  });
});
