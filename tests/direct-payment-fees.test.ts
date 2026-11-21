import {
  assert,
  describe,
  test,
  clearStore,
  afterEach,
} from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { handleDirectPaymentProcessed } from "../src/evmai-agent-escrow";
import {
  handleBranchRequested,
  handleMetadataUpdateRequested,
} from "../src/evmai-agent";
import {
  createBranchRequestedEvent,
  createMetadataUpdateRequestedEvent,
} from "./evmai-agent-utils";
import { createDirectPaymentProcessedEvent } from "./evmai-agent-escrow-utils";
import { FeeConfig } from "../generated/schema";

// The escrow emits DirectPaymentProcessed(user, amount) for a branch or a metadata update, in
// the same transaction and before the agent's BranchRequested / MetadataUpdateRequested. The
// activity takes its fee from that event; FeeConfig is read only when no such event was seen.

const USER_ADDRESS = "0x0000000000000000000000000000000000000001";
const OTHER_USER_ADDRESS = "0x0000000000000000000000000000000000000002";
const OTHER_TX_HASH =
  "0x00000000000000000000000000000000000000000000000000000000000000ff";

// FeeConfig with a branch fee of 500 and a metadata update fee of 200: values the events in
// these tests deliberately differ from, so a test can tell which source the amount came from.
function seedFeeConfig(): void {
  let fc = new FeeConfig("singleton");
  fc.promptFee = BigInt.fromI32(0);
  fc.cancellationFee = BigInt.fromI32(0);
  fc.branchFee = BigInt.fromI32(500);
  fc.metadataUpdateFee = BigInt.fromI32(200);
  fc.updatedAt = BigInt.fromI32(1);
  fc.save();
}

function directPayment(user: string, amount: i32, logIndex: i32): ethereum.Event {
  let event = createDirectPaymentProcessedEvent(
    Address.fromString(user),
    BigInt.fromI32(amount)
  );
  event.logIndex = BigInt.fromI32(logIndex);
  handleDirectPaymentProcessed(event);
  return event;
}

function branch(user: string, logIndex: i32): ethereum.Event {
  let event = createBranchRequestedEvent(
    Address.fromString(user),
    BigInt.fromI32(1),
    BigInt.fromI32(50),
    BigInt.fromI32(2),
    Bytes.fromHexString("0xaa"),
    Bytes.fromHexString("0xbb")
  );
  event.logIndex = BigInt.fromI32(logIndex);
  handleBranchRequested(event);
  return event;
}

function metadataUpdate(user: string, logIndex: i32): ethereum.Event {
  let event = createMetadataUpdateRequestedEvent(
    Address.fromString(user),
    BigInt.fromI32(1),
    Bytes.fromHexString("0xcc"),
    Bytes.fromHexString("0xdd")
  );
  event.logIndex = BigInt.fromI32(logIndex);
  handleMetadataUpdateRequested(event);
  return event;
}

function activityId(event: ethereum.Event): string {
  return event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
}

describe("Branch and metadata fees from DirectPaymentProcessed", () => {
  afterEach(() => {
    clearStore();
  });

  test("a branch records the amount of the escrow's event, not FeeConfig.branchFee", () => {
    seedFeeConfig();
    directPayment(USER_ADDRESS, 700, 1);
    let event = branch(USER_ADDRESS, 3);

    // The event says 700 was paid; FeeConfig's 500 is not used: amount = -700.
    assert.fieldEquals("Activity", activityId(event), "type", "BRANCH");
    assert.fieldEquals("Activity", activityId(event), "amount", "-700");
  });

  test("a metadata update records the amount of the escrow's event, not FeeConfig.metadataUpdateFee", () => {
    seedFeeConfig();
    directPayment(USER_ADDRESS, 250, 1);
    let event = metadataUpdate(USER_ADDRESS, 2);

    // The event says 250 was paid; FeeConfig's 200 is not used: amount = -250.
    assert.fieldEquals("Activity", activityId(event), "type", "METADATA_UPDATE");
    assert.fieldEquals("Activity", activityId(event), "amount", "-250");
  });

  test("two branches in one transaction each record their own amount, in order", () => {
    seedFeeConfig();
    directPayment(USER_ADDRESS, 700, 1);
    let first = branch(USER_ADDRESS, 3);
    directPayment(USER_ADDRESS, 900, 4);
    let second = branch(USER_ADDRESS, 6);

    // First payment (700) pairs with the first branch, second (900) with the second.
    assert.fieldEquals("Activity", activityId(first), "amount", "-700");
    assert.fieldEquals("Activity", activityId(second), "amount", "-900");
    // Both entries were taken, so nothing is left queued for the transaction.
    assert.entityCount("PendingDirectPayment", 0);
  });

  test("two payments queued before two branches still pair in order", () => {
    seedFeeConfig();
    directPayment(USER_ADDRESS, 700, 1);
    directPayment(USER_ADDRESS, 900, 2);
    let first = branch(USER_ADDRESS, 3);
    let second = branch(USER_ADDRESS, 4);

    // Queue is first in, first out: 700 then 900.
    assert.fieldEquals("Activity", activityId(first), "amount", "-700");
    assert.fieldEquals("Activity", activityId(second), "amount", "-900");
    assert.entityCount("PendingDirectPayment", 0);
  });

  test("with no event in the transaction, a branch and a metadata update fall back to FeeConfig", () => {
    seedFeeConfig();
    let branchEvent = branch(USER_ADDRESS, 1);
    let metadataEvent = metadataUpdate(USER_ADDRESS, 2);

    // No DirectPaymentProcessed seen: FeeConfig.branchFee 500 -> -500,
    // FeeConfig.metadataUpdateFee 200 -> -200.
    assert.fieldEquals("Activity", activityId(branchEvent), "amount", "-500");
    assert.fieldEquals("Activity", activityId(metadataEvent), "amount", "-200");
  });

  test("a queued payment for another user in the same transaction is not taken", () => {
    seedFeeConfig();
    directPayment(OTHER_USER_ADDRESS, 700, 1);
    let mine = branch(USER_ADDRESS, 2);

    // Nothing queued for this user: FeeConfig.branchFee 500 -> -500.
    assert.fieldEquals("Activity", activityId(mine), "amount", "-500");
    // The other user's entry is still there and pairs with that user's branch: -700.
    assert.entityCount("PendingDirectPayment", 1);
    let theirs = branch(OTHER_USER_ADDRESS, 3);
    assert.fieldEquals("Activity", activityId(theirs), "amount", "-700");
    assert.entityCount("PendingDirectPayment", 0);
  });

  test("a payment from another transaction is not taken", () => {
    seedFeeConfig();
    let payment = createDirectPaymentProcessedEvent(
      Address.fromString(USER_ADDRESS),
      BigInt.fromI32(700)
    );
    payment.transaction.hash = Bytes.fromHexString(OTHER_TX_HASH);
    handleDirectPaymentProcessed(payment);
    let event = branch(USER_ADDRESS, 1);

    // The 700 belongs to another transaction: FeeConfig.branchFee 500 -> -500.
    assert.fieldEquals("Activity", activityId(event), "amount", "-500");
  });
});
