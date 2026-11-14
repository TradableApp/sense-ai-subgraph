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
      "txFrom",
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
    second.block.number = BigInt.fromI32(88);
    second.block.timestamp = BigInt.fromI32(1700000001);
    handlePromptFeeUpdated(second);
    let firstId = first.transaction.hash.toHexString() + "-1";
    let secondId = second.transaction.hash.toHexString() + "-2";

    assert.entityCount("FeeChange", 2);
    assert.fieldEquals("FeeChange", firstId, "fee", "PROMPT");
    // Nothing is known about the fee before the first event seen, so there is no amount before.
    assert.fieldEquals("FeeChange", firstId, "previousFee", "null");
    assert.fieldEquals("FeeChange", firstId, "newFee", "1000000");
    assert.fieldEquals("FeeChange", secondId, "previousFee", "1000000");
    assert.fieldEquals("FeeChange", secondId, "newFee", "2000000");
    assert.fieldEquals("FeeChange", secondId, "blockNumber", "88");
    assert.fieldEquals("FeeChange", secondId, "timestamp", "1700000001");
    assert.fieldEquals(
      "FeeChange",
      secondId,
      "txHash",
      second.transaction.hash.toHexString()
    );
    assert.fieldEquals(
      "FeeChange",
      secondId,
      "txFrom",
      second.transaction.from.toHexString()
    );
  });

  test("each of the four fees keeps its own name and its own amount before", () => {
    // Two rounds with eight different amounts: a handler that read another fee's value as the
    // amount before, or recorded after updating, gets a wrong previousFee in round two.
    let hash = createPromptFeeUpdatedEvent(BigInt.fromI32(0)).transaction.hash.toHexString();

    let prompt1 = createPromptFeeUpdatedEvent(BigInt.fromI32(11));
    prompt1.logIndex = BigInt.fromI32(1);
    handlePromptFeeUpdated(prompt1);
    let branch1 = createBranchFeeUpdatedEvent(BigInt.fromI32(22));
    branch1.logIndex = BigInt.fromI32(2);
    handleBranchFeeUpdated(branch1);
    let cancellation1 = createCancellationFeeUpdatedEvent(BigInt.fromI32(33));
    cancellation1.logIndex = BigInt.fromI32(3);
    handleCancellationFeeUpdated(cancellation1);
    let metadata1 = createMetadataUpdateFeeUpdatedEvent(BigInt.fromI32(44));
    metadata1.logIndex = BigInt.fromI32(4);
    handleMetadataUpdateFeeUpdated(metadata1);

    // The first event of each fee has no amount before, even though FeeConfig already exists.
    assert.fieldEquals("FeeChange", hash + "-2", "previousFee", "null");
    assert.fieldEquals("FeeChange", hash + "-3", "previousFee", "null");
    assert.fieldEquals("FeeChange", hash + "-4", "previousFee", "null");

    let prompt2 = createPromptFeeUpdatedEvent(BigInt.fromI32(55));
    prompt2.logIndex = BigInt.fromI32(5);
    handlePromptFeeUpdated(prompt2);
    let branch2 = createBranchFeeUpdatedEvent(BigInt.fromI32(66));
    branch2.logIndex = BigInt.fromI32(6);
    handleBranchFeeUpdated(branch2);
    let cancellation2 = createCancellationFeeUpdatedEvent(BigInt.fromI32(77));
    cancellation2.logIndex = BigInt.fromI32(7);
    handleCancellationFeeUpdated(cancellation2);
    let metadata2 = createMetadataUpdateFeeUpdatedEvent(BigInt.fromI32(88));
    metadata2.logIndex = BigInt.fromI32(8);
    handleMetadataUpdateFeeUpdated(metadata2);

    assert.entityCount("FeeChange", 8);
    assert.fieldEquals("FeeChange", hash + "-5", "fee", "PROMPT");
    assert.fieldEquals("FeeChange", hash + "-5", "previousFee", "11");
    assert.fieldEquals("FeeChange", hash + "-5", "newFee", "55");
    assert.fieldEquals("FeeChange", hash + "-6", "fee", "BRANCH");
    assert.fieldEquals("FeeChange", hash + "-6", "previousFee", "22");
    assert.fieldEquals("FeeChange", hash + "-6", "newFee", "66");
    assert.fieldEquals("FeeChange", hash + "-7", "fee", "CANCELLATION");
    assert.fieldEquals("FeeChange", hash + "-7", "previousFee", "33");
    assert.fieldEquals("FeeChange", hash + "-7", "newFee", "77");
    assert.fieldEquals("FeeChange", hash + "-8", "fee", "METADATA_UPDATE");
    assert.fieldEquals("FeeChange", hash + "-8", "previousFee", "44");
    assert.fieldEquals("FeeChange", hash + "-8", "newFee", "88");
  });
});

describe("Change history — the escrow's deployment", () => {
  afterEach(() => {
    clearStore();
  });

  test("four fee events and the treasury event in one transaction give five records and the right current values", () => {
    // The escrow's initialize emits all five in one transaction: one hash, five log positions.
    let prompt = createPromptFeeUpdatedEvent(BigInt.fromI32(4));
    prompt.logIndex = BigInt.fromI32(1);
    handlePromptFeeUpdated(prompt);
    let cancellation = createCancellationFeeUpdatedEvent(BigInt.fromI32(3));
    cancellation.logIndex = BigInt.fromI32(2);
    handleCancellationFeeUpdated(cancellation);
    let metadata = createMetadataUpdateFeeUpdatedEvent(BigInt.fromI32(2));
    metadata.logIndex = BigInt.fromI32(3);
    handleMetadataUpdateFeeUpdated(metadata);
    let branch = createBranchFeeUpdatedEvent(BigInt.fromI32(1));
    branch.logIndex = BigInt.fromI32(4);
    handleBranchFeeUpdated(branch);
    let treasury = createTreasuryUpdatedEvent(Address.fromString(TREASURY_ONE));
    treasury.logIndex = BigInt.fromI32(5);
    handleTreasuryUpdated(treasury);

    assert.entityCount("FeeChange", 4);
    assert.entityCount("TreasuryChange", 1);
    assert.entityCount("FeeConfig", 1);
    assert.fieldEquals("FeeConfig", "singleton", "promptFee", "4");
    assert.fieldEquals("FeeConfig", "singleton", "cancellationFee", "3");
    assert.fieldEquals("FeeConfig", "singleton", "metadataUpdateFee", "2");
    assert.fieldEquals("FeeConfig", "singleton", "branchFee", "1");
    assert.fieldEquals(
      "ProtocolConfig",
      "singleton",
      "treasuryAddress",
      TREASURY_ONE
    );
  });
});
