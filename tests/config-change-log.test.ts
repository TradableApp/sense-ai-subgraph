import {
  assert,
  describe,
  test,
  clearStore,
  afterEach,
} from "matchstick-as/assembly/index";
import { Address, BigInt } from "@graphprotocol/graph-ts";
import {
  handlePromptFeeUpdated,
  handleBranchFeeUpdated,
  handleCancellationFeeUpdated,
  handleMetadataUpdateFeeUpdated,
  handleTreasuryUpdated,
} from "../src/evmai-agent-escrow";
import {
  createPromptFeeUpdatedEvent,
  createBranchFeeUpdatedEvent,
  createCancellationFeeUpdatedEvent,
  createMetadataUpdateFeeUpdatedEvent,
  createTreasuryUpdatedEvent,
} from "./admin-config-utils";

const TREASURY_ONE = "0x00000000000000000000000000000000000000c1";
const TREASURY_TWO = "0x00000000000000000000000000000000000000c2";

describe("Change history — treasury", () => {
  afterEach(() => {
    clearStore();
  });

  test("each treasury change is one record with the address before and after", () => {
    let first = createTreasuryUpdatedEvent(Address.fromString(TREASURY_ONE));
    first.logIndex = BigInt.fromI32(1);
    handleTreasuryUpdated(first);
    let second = createTreasuryUpdatedEvent(Address.fromString(TREASURY_TWO));
    second.logIndex = BigInt.fromI32(2);
    second.block.number = BigInt.fromI32(77);
    second.block.timestamp = BigInt.fromI32(1700000000);
    handleTreasuryUpdated(second);
    let firstId = first.transaction.hash.toHexString() + "-1";
    let secondId = second.transaction.hash.toHexString() + "-2";

    assert.entityCount("TreasuryChange", 2);
    assert.fieldEquals("TreasuryChange", firstId, "previousTreasury", "null");
    assert.fieldEquals("TreasuryChange", firstId, "newTreasury", TREASURY_ONE);
    assert.fieldEquals(
      "TreasuryChange",
      secondId,
      "previousTreasury",
      TREASURY_ONE
    );
    assert.fieldEquals("TreasuryChange", secondId, "newTreasury", TREASURY_TWO);
    assert.fieldEquals("TreasuryChange", secondId, "blockNumber", "77");
    assert.fieldEquals("TreasuryChange", secondId, "timestamp", "1700000000");
    assert.fieldEquals(
      "TreasuryChange",
      secondId,
      "sender",
      second.transaction.from.toHexString()
    );
    assert.fieldEquals(
      "TreasuryChange",
      secondId,
      "txHash",
      second.transaction.hash.toHexString()
    );
  });
});

describe("Change history — fees", () => {
  afterEach(() => {
    clearStore();
  });

  test("each fee change is one record with the fee name and the amount before and after", () => {
    let first = createPromptFeeUpdatedEvent(BigInt.fromI32(1000000));
    first.logIndex = BigInt.fromI32(1);
    handlePromptFeeUpdated(first);
    let second = createPromptFeeUpdatedEvent(BigInt.fromI32(2000000));
    second.logIndex = BigInt.fromI32(2);
    handlePromptFeeUpdated(second);
    let firstId = first.transaction.hash.toHexString() + "-1";
    let secondId = second.transaction.hash.toHexString() + "-2";

    assert.entityCount("FeeChange", 2);
    assert.fieldEquals("FeeChange", firstId, "fee", "PROMPT");
    // No fee event seen before the first: the amount before is 0, as FeeConfig holds it.
    assert.fieldEquals("FeeChange", firstId, "previousFee", "0");
    assert.fieldEquals("FeeChange", firstId, "newFee", "1000000");
    assert.fieldEquals("FeeChange", secondId, "previousFee", "1000000");
    assert.fieldEquals("FeeChange", secondId, "newFee", "2000000");
    assert.fieldEquals(
      "FeeChange",
      secondId,
      "sender",
      second.transaction.from.toHexString()
    );
  });

  test("the four fees are told apart by name", () => {
    let prompt = createPromptFeeUpdatedEvent(BigInt.fromI32(4));
    prompt.logIndex = BigInt.fromI32(1);
    handlePromptFeeUpdated(prompt);
    let branch = createBranchFeeUpdatedEvent(BigInt.fromI32(3));
    branch.logIndex = BigInt.fromI32(2);
    handleBranchFeeUpdated(branch);
    let cancellation = createCancellationFeeUpdatedEvent(BigInt.fromI32(2));
    cancellation.logIndex = BigInt.fromI32(3);
    handleCancellationFeeUpdated(cancellation);
    let metadata = createMetadataUpdateFeeUpdatedEvent(BigInt.fromI32(1));
    metadata.logIndex = BigInt.fromI32(4);
    handleMetadataUpdateFeeUpdated(metadata);
    let hash = prompt.transaction.hash.toHexString();

    assert.entityCount("FeeChange", 4);
    assert.fieldEquals("FeeChange", hash + "-1", "fee", "PROMPT");
    assert.fieldEquals("FeeChange", hash + "-2", "fee", "BRANCH");
    assert.fieldEquals("FeeChange", hash + "-3", "fee", "CANCELLATION");
    assert.fieldEquals("FeeChange", hash + "-4", "fee", "METADATA_UPDATE");
    assert.fieldEquals("FeeChange", hash + "-4", "newFee", "1");
  });
});
