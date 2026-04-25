import {
  assert,
  describe,
  test,
  clearStore,
  beforeEach,
  afterEach,
} from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  handleAgentEscrowUpdated,
  handleOracleUpdated,
  handleAgentJobSubmitted,
  handleRegenerationRequested,
} from "../src/evmai-agent";
import {
  handlePromptFeeUpdated,
  handleBranchFeeUpdated,
  handleCancellationFeeUpdated,
  handleMetadataUpdateFeeUpdated,
  handleTreasuryUpdated,
} from "../src/evmai-agent-escrow";
import {
  createAgentEscrowUpdatedEvent,
  createOracleUpdatedEvent,
  createAgentJobSubmittedEvent,
  createRegenerationRequestedEvent,
  createPromptFeeUpdatedEvent,
  createBranchFeeUpdatedEvent,
  createCancellationFeeUpdatedEvent,
  createMetadataUpdateFeeUpdatedEvent,
  createTreasuryUpdatedEvent,
} from "./admin-config-utils";

const ESCROW_ADDRESS = "0x0000000000000000000000000000000000000002";
const ORACLE_ADDRESS = "0x0000000000000000000000000000000000000003";
const TREASURY_ADDRESS = "0x0000000000000000000000000000000000000004";
const USER_ADDRESS = "0x0000000000000000000000000000000000000001";
const SINGLETON_ID = "singleton";

describe("ProtocolConfig — AgentEscrowUpdated", () => {
  afterEach(() => {
    clearStore();
  });

  test("creates ProtocolConfig singleton with escrowAddress", () => {
    let event = createAgentEscrowUpdatedEvent(
      Address.fromString(ESCROW_ADDRESS)
    );
    handleAgentEscrowUpdated(event);

    assert.entityCount("ProtocolConfig", 1);
    assert.fieldEquals(
      "ProtocolConfig",
      SINGLETON_ID,
      "escrowAddress",
      ESCROW_ADDRESS
    );
  });

  test("updates escrowAddress on second event", () => {
    let first = createAgentEscrowUpdatedEvent(
      Address.fromString(ESCROW_ADDRESS)
    );
    handleAgentEscrowUpdated(first);

    let newEscrow = "0x0000000000000000000000000000000000000099";
    let second = createAgentEscrowUpdatedEvent(Address.fromString(newEscrow));
    handleAgentEscrowUpdated(second);

    assert.entityCount("ProtocolConfig", 1);
    assert.fieldEquals(
      "ProtocolConfig",
      SINGLETON_ID,
      "escrowAddress",
      newEscrow
    );
  });
});

describe("ProtocolConfig — OracleUpdated", () => {
  afterEach(() => {
    clearStore();
  });

  test("sets oracleAddress on ProtocolConfig singleton", () => {
    let event = createOracleUpdatedEvent(Address.fromString(ORACLE_ADDRESS));
    handleOracleUpdated(event);

    assert.entityCount("ProtocolConfig", 1);
    assert.fieldEquals(
      "ProtocolConfig",
      SINGLETON_ID,
      "oracleAddress",
      ORACLE_ADDRESS
    );
  });
});

describe("ProtocolConfig — TreasuryUpdated", () => {
  afterEach(() => {
    clearStore();
  });

  test("sets treasuryAddress on ProtocolConfig singleton", () => {
    let event = createTreasuryUpdatedEvent(
      Address.fromString(TREASURY_ADDRESS)
    );
    handleTreasuryUpdated(event);

    assert.entityCount("ProtocolConfig", 1);
    assert.fieldEquals(
      "ProtocolConfig",
      SINGLETON_ID,
      "treasuryAddress",
      TREASURY_ADDRESS
    );
  });

  test("preserves existing escrow and oracle when treasury is set", () => {
    handleAgentEscrowUpdated(
      createAgentEscrowUpdatedEvent(Address.fromString(ESCROW_ADDRESS))
    );
    handleOracleUpdated(
      createOracleUpdatedEvent(Address.fromString(ORACLE_ADDRESS))
    );
    handleTreasuryUpdated(
      createTreasuryUpdatedEvent(Address.fromString(TREASURY_ADDRESS))
    );

    assert.entityCount("ProtocolConfig", 1);
    assert.fieldEquals(
      "ProtocolConfig",
      SINGLETON_ID,
      "escrowAddress",
      ESCROW_ADDRESS
    );
    assert.fieldEquals(
      "ProtocolConfig",
      SINGLETON_ID,
      "oracleAddress",
      ORACLE_ADDRESS
    );
    assert.fieldEquals(
      "ProtocolConfig",
      SINGLETON_ID,
      "treasuryAddress",
      TREASURY_ADDRESS
    );
  });
});

describe("AgentJob — AgentJobSubmitted", () => {
  afterEach(() => {
    clearStore();
  });

  test("creates AgentJob entity with all fields", () => {
    let user = Address.fromString(USER_ADDRESS);
    let jobId = BigInt.fromI32(42);
    let triggerId = BigInt.fromI32(7);
    let payload = Bytes.fromHexString("0xdeadbeef");
    let roflKey = Bytes.fromHexString("0xcafebabe");

    let event = createAgentJobSubmittedEvent(
      user,
      jobId,
      triggerId,
      payload,
      roflKey
    );
    handleAgentJobSubmitted(event);

    assert.entityCount("AgentJob", 1);

    let id =
      event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
    assert.fieldEquals("AgentJob", id, "user", USER_ADDRESS);
    assert.fieldEquals("AgentJob", id, "jobId", "42");
    assert.fieldEquals("AgentJob", id, "triggerId", "7");
  });

  test("creates separate AgentJob entities for multiple submissions", () => {
    let user = Address.fromString(USER_ADDRESS);
    let payload = Bytes.fromHexString("0xdeadbeef");
    let roflKey = Bytes.fromHexString("0xcafebabe");

    let event1 = createAgentJobSubmittedEvent(
      user,
      BigInt.fromI32(1),
      BigInt.fromI32(1),
      payload,
      roflKey
    );
    let event2 = createAgentJobSubmittedEvent(
      user,
      BigInt.fromI32(2),
      BigInt.fromI32(2),
      payload,
      roflKey
    );
    event2.logIndex = BigInt.fromI32(2);

    handleAgentJobSubmitted(event1);
    handleAgentJobSubmitted(event2);

    assert.entityCount("AgentJob", 2);
  });
});

describe("RegenerationRequest — RegenerationRequested", () => {
  afterEach(() => {
    clearStore();
  });

  test("creates RegenerationRequest entity with all fields", () => {
    let user = Address.fromString(USER_ADDRESS);
    let conversationId = BigInt.fromI32(10);
    let promptMessageId = BigInt.fromI32(5);
    let originalAnswerMessageId = BigInt.fromI32(6);
    let answerMessageId = BigInt.fromI32(11);
    let payload = Bytes.fromHexString("0xdeadbeef");
    let roflKey = Bytes.fromHexString("0xcafebabe");

    let event = createRegenerationRequestedEvent(
      user,
      conversationId,
      promptMessageId,
      originalAnswerMessageId,
      answerMessageId,
      payload,
      roflKey
    );
    handleRegenerationRequested(event);

    assert.entityCount("RegenerationRequest", 1);

    let id =
      event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
    assert.fieldEquals("RegenerationRequest", id, "user", USER_ADDRESS);
    assert.fieldEquals("RegenerationRequest", id, "conversationId", "10");
    assert.fieldEquals("RegenerationRequest", id, "promptMessageId", "5");
    assert.fieldEquals(
      "RegenerationRequest",
      id,
      "originalAnswerMessageId",
      "6"
    );
    assert.fieldEquals("RegenerationRequest", id, "answerMessageId", "11");
  });
});

describe("FeeConfig — fee update handlers", () => {
  afterEach(() => {
    clearStore();
  });

  test("handlePromptFeeUpdated creates FeeConfig with promptFee", () => {
    let fee = BigInt.fromI32(1000000);
    handlePromptFeeUpdated(createPromptFeeUpdatedEvent(fee));

    assert.entityCount("FeeConfig", 1);
    assert.fieldEquals("FeeConfig", SINGLETON_ID, "promptFee", "1000000");
  });

  test("handleBranchFeeUpdated sets branchFee", () => {
    let fee = BigInt.fromI32(500000);
    handleBranchFeeUpdated(createBranchFeeUpdatedEvent(fee));

    assert.entityCount("FeeConfig", 1);
    assert.fieldEquals("FeeConfig", SINGLETON_ID, "branchFee", "500000");
  });

  test("handleCancellationFeeUpdated sets cancellationFee", () => {
    let fee = BigInt.fromI32(250000);
    handleCancellationFeeUpdated(createCancellationFeeUpdatedEvent(fee));

    assert.entityCount("FeeConfig", 1);
    assert.fieldEquals("FeeConfig", SINGLETON_ID, "cancellationFee", "250000");
  });

  test("handleMetadataUpdateFeeUpdated sets metadataUpdateFee", () => {
    let fee = BigInt.fromI32(100000);
    handleMetadataUpdateFeeUpdated(createMetadataUpdateFeeUpdatedEvent(fee));

    assert.entityCount("FeeConfig", 1);
    assert.fieldEquals(
      "FeeConfig",
      SINGLETON_ID,
      "metadataUpdateFee",
      "100000"
    );
  });

  test("all four fee fields coexist on the singleton", () => {
    handlePromptFeeUpdated(
      createPromptFeeUpdatedEvent(BigInt.fromI32(1000000))
    );
    handleBranchFeeUpdated(createBranchFeeUpdatedEvent(BigInt.fromI32(500000)));
    handleCancellationFeeUpdated(
      createCancellationFeeUpdatedEvent(BigInt.fromI32(250000))
    );
    handleMetadataUpdateFeeUpdated(
      createMetadataUpdateFeeUpdatedEvent(BigInt.fromI32(100000))
    );

    assert.entityCount("FeeConfig", 1);
    assert.fieldEquals("FeeConfig", SINGLETON_ID, "promptFee", "1000000");
    assert.fieldEquals("FeeConfig", SINGLETON_ID, "branchFee", "500000");
    assert.fieldEquals("FeeConfig", SINGLETON_ID, "cancellationFee", "250000");
    assert.fieldEquals(
      "FeeConfig",
      SINGLETON_ID,
      "metadataUpdateFee",
      "100000"
    );
  });

  test("promptFee updates correctly on second event", () => {
    handlePromptFeeUpdated(
      createPromptFeeUpdatedEvent(BigInt.fromI32(1000000))
    );
    handlePromptFeeUpdated(
      createPromptFeeUpdatedEvent(BigInt.fromI32(2000000))
    );

    assert.entityCount("FeeConfig", 1);
    assert.fieldEquals("FeeConfig", SINGLETON_ID, "promptFee", "2000000");
  });
});
