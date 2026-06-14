import {
  assert,
  describe,
  test,
  clearStore,
  beforeAll,
  afterAll,
  afterEach,
} from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  handleConversationAdded,
  handlePromptSubmitted,
  handlePromptCancelled,
  handlePromptMessageAdded,
  handleAnswerMessageAdded,
  handleConversationBranched,
  handleConversationMetadataUpdated,
  handleSearchIndexDeltaAdded,
  handleBranchRequested,
  handleMetadataUpdateRequested,
} from "../src/evmai-agent";
import {
  createConversationAddedEvent,
  createPromptSubmittedEvent,
  createAgentPromptCancelledEvent,
  createPromptMessageAddedEvent,
  createAnswerMessageAddedEvent,
  createConversationBranchedEvent,
  createConversationMetadataUpdatedEvent,
  createSearchIndexDeltaAddedEvent,
  createBranchRequestedEvent,
  createMetadataUpdateRequestedEvent,
} from "./evmai-agent-utils";
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
const CONV_CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const META_CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const PROMPT_MSG_ID = "99";
const ANSWER_MSG_ID = "100";
const MSG_CID = "bafyreib2e3felzxe3gw6joj3cvsepv7ux5mhgp3mlb7xn3ddlzah5hbfwi";
const SEARCH_CID = "bafyreic3p3gpt76ht7k2lqz57unpaus27k2gqz3lcctp5e3ebmv3v7ahdi";
const MOCK_EVENT_ADDRESS = "0xa16081f360e3847006db660bae1c6d1b2e17ec2a";
const MOCK_ESCROW_ADDRESS = "0x0000000000000000000000000000000000000099";

function seedConversation(): void {
  let user = Address.fromString(USER_ADDRESS);
  handleConversationAdded(
    createConversationAddedEvent(
      user,
      BigInt.fromString(CONV_ID),
      CONV_CID,
      META_CID
    )
  );
}

function seedConversationAndPrompt(): void {
  seedConversation();
  let user = Address.fromString(USER_ADDRESS);
  handlePromptSubmitted(
    createPromptSubmittedEvent(
      user,
      BigInt.fromString(CONV_ID),
      BigInt.fromString(PROMPT_MSG_ID),
      BigInt.fromString(ANSWER_MSG_ID)
    )
  );
}

// ---------------------------------------------------------------------------
// ConversationAdded
// ---------------------------------------------------------------------------
describe("EVMAIAgent — Conversation creation", () => {
  beforeAll(() => {
    seedConversation();
  });

  afterAll(() => {
    clearStore();
  });

  test("Conversation entity is created", () => {
    assert.entityCount("Conversation", 1);
    assert.fieldEquals("Conversation", CONV_ID, "owner", USER_ADDRESS);
    assert.fieldEquals("Conversation", CONV_ID, "conversationCID", CONV_CID);
    assert.fieldEquals("Conversation", CONV_ID, "isDeleted", "false");
  });

  test("Conversation stores conversationId and metadata CID", () => {
    assert.fieldEquals("Conversation", CONV_ID, "conversationId", CONV_ID);
    assert.fieldEquals(
      "Conversation",
      CONV_ID,
      "conversationMetadataCID",
      META_CID
    );
  });
});

// ---------------------------------------------------------------------------
// PromptSubmitted — entity field verification
// ---------------------------------------------------------------------------
describe("EVMAIAgent — handlePromptSubmitted creates PromptRequest", () => {
  beforeAll(() => {
    seedConversationAndPrompt();
  });

  afterAll(() => {
    clearStore();
  });

  test("PromptRequest is keyed by answerMessageId", () => {
    assert.entityCount("PromptRequest", 1);
    assert.fieldEquals(
      "PromptRequest",
      ANSWER_MSG_ID,
      "promptMessageId",
      PROMPT_MSG_ID
    );
  });

  test("PromptRequest links to conversation", () => {
    assert.fieldEquals("PromptRequest", ANSWER_MSG_ID, "conversation", CONV_ID);
  });

  test("PromptRequest stores user address", () => {
    assert.fieldEquals("PromptRequest", ANSWER_MSG_ID, "user", USER_ADDRESS);
  });

  test("PromptRequest state flags initialise to false", () => {
    assert.fieldEquals("PromptRequest", ANSWER_MSG_ID, "isCancelled", "false");
    assert.fieldEquals("PromptRequest", ANSWER_MSG_ID, "isAnswered", "false");
    assert.fieldEquals("PromptRequest", ANSWER_MSG_ID, "isRefunded", "false");
  });
});

// ---------------------------------------------------------------------------
// PromptCancelled (Agent) — sets isCancelled on PromptRequest
// ---------------------------------------------------------------------------
describe("EVMAIAgent — handlePromptCancelled sets isCancelled", () => {
  beforeAll(() => {
    seedConversationAndPrompt();

    handlePromptCancelled(
      createAgentPromptCancelledEvent(
        Address.fromString(USER_ADDRESS),
        BigInt.fromString(ANSWER_MSG_ID)
      )
    );
  });

  afterAll(() => {
    clearStore();
  });

  test("PromptRequest.isCancelled is set to true", () => {
    assert.fieldEquals("PromptRequest", ANSWER_MSG_ID, "isCancelled", "true");
  });

  test("PromptRequest.isAnswered remains false after cancellation", () => {
    assert.fieldEquals("PromptRequest", ANSWER_MSG_ID, "isAnswered", "false");
  });
});

// ---------------------------------------------------------------------------
// PromptCancelled (Agent) — graceful when PromptRequest missing
// ---------------------------------------------------------------------------
describe("EVMAIAgent — handlePromptCancelled with missing PromptRequest", () => {
  afterEach(() => {
    clearStore();
  });

  test("does not crash when PromptRequest does not exist", () => {
    handlePromptCancelled(
      createAgentPromptCancelledEvent(
        Address.fromString(USER_ADDRESS),
        BigInt.fromI32(999)
      )
    );
    assert.entityCount("PromptRequest", 0);
  });
});

// ---------------------------------------------------------------------------
// PromptMessageAdded — user Message creation
// ---------------------------------------------------------------------------
describe("EVMAIAgent — handlePromptMessageAdded creates user Message", () => {
  const MSG_ID = "50";

  beforeAll(() => {
    seedConversation();
    handlePromptMessageAdded(
      createPromptMessageAddedEvent(
        BigInt.fromString(CONV_ID),
        BigInt.fromString(MSG_ID),
        MSG_CID
      )
    );
  });

  afterAll(() => {
    clearStore();
  });

  test("Message entity is created with role user", () => {
    assert.entityCount("Message", 1);
    assert.fieldEquals("Message", MSG_ID, "role", "user");
  });

  test("Message links to conversation", () => {
    assert.fieldEquals("Message", MSG_ID, "conversation", CONV_ID);
  });

  test("Message stores messageId and CID", () => {
    assert.fieldEquals("Message", MSG_ID, "messageId", MSG_ID);
    assert.fieldEquals("Message", MSG_ID, "messageCID", MSG_CID);
  });
});

// ---------------------------------------------------------------------------
// AnswerMessageAdded — assistant Message + PromptRequest answered
// ---------------------------------------------------------------------------
describe("EVMAIAgent — handleAnswerMessageAdded creates assistant Message", () => {
  beforeAll(() => {
    seedConversationAndPrompt();
    handleAnswerMessageAdded(
      createAnswerMessageAddedEvent(
        BigInt.fromString(CONV_ID),
        BigInt.fromString(ANSWER_MSG_ID),
        MSG_CID
      )
    );
  });

  afterAll(() => {
    clearStore();
  });

  test("Message entity is created with role assistant", () => {
    assert.entityCount("Message", 1);
    assert.fieldEquals("Message", ANSWER_MSG_ID, "role", "assistant");
  });

  test("Message links to conversation", () => {
    assert.fieldEquals("Message", ANSWER_MSG_ID, "conversation", CONV_ID);
  });

  test("PromptRequest.isAnswered is set to true", () => {
    assert.fieldEquals("PromptRequest", ANSWER_MSG_ID, "isAnswered", "true");
  });
});

// ---------------------------------------------------------------------------
// AnswerMessageAdded — graceful when PromptRequest missing
// ---------------------------------------------------------------------------
describe("EVMAIAgent — handleAnswerMessageAdded without PromptRequest", () => {
  afterEach(() => {
    clearStore();
  });

  test("creates Message even when PromptRequest does not exist", () => {
    seedConversation();
    handleAnswerMessageAdded(
      createAnswerMessageAddedEvent(
        BigInt.fromString(CONV_ID),
        BigInt.fromI32(777),
        MSG_CID
      )
    );
    assert.entityCount("Message", 1);
    assert.fieldEquals("Message", "777", "role", "assistant");
  });
});

// ---------------------------------------------------------------------------
// ConversationBranched — branched Conversation with link
// ---------------------------------------------------------------------------
describe("EVMAIAgent — handleConversationBranched", () => {
  const ORIGINAL_CONV_ID = "1";
  const BRANCH_CONV_ID = "2";
  const BRANCH_MSG_ID = "50";
  const BRANCH_CID = "bafybranch";
  const BRANCH_META_CID = "bafybranchmeta";

  beforeAll(() => {
    seedConversation();
    handleConversationBranched(
      createConversationBranchedEvent(
        Address.fromString(USER_ADDRESS),
        BigInt.fromString(BRANCH_CONV_ID),
        BigInt.fromString(ORIGINAL_CONV_ID),
        BigInt.fromString(BRANCH_MSG_ID),
        BRANCH_CID,
        BRANCH_META_CID
      )
    );
  });

  afterAll(() => {
    clearStore();
  });

  test("creates new Conversation entity for the branch", () => {
    assert.entityCount("Conversation", 2);
    assert.fieldEquals("Conversation", BRANCH_CONV_ID, "owner", USER_ADDRESS);
  });

  test("branched Conversation links to original via branchedFrom", () => {
    assert.fieldEquals(
      "Conversation",
      BRANCH_CONV_ID,
      "branchedFrom",
      ORIGINAL_CONV_ID
    );
  });

  test("branched Conversation stores its own CIDs", () => {
    assert.fieldEquals(
      "Conversation",
      BRANCH_CONV_ID,
      "conversationCID",
      BRANCH_CID
    );
    assert.fieldEquals(
      "Conversation",
      BRANCH_CONV_ID,
      "conversationMetadataCID",
      BRANCH_META_CID
    );
  });

  test("branched Conversation isDeleted is false", () => {
    assert.fieldEquals("Conversation", BRANCH_CONV_ID, "isDeleted", "false");
  });
});

// ---------------------------------------------------------------------------
// ConversationMetadataUpdated — updates CID
// ---------------------------------------------------------------------------
describe("EVMAIAgent — handleConversationMetadataUpdated", () => {
  const NEW_META_CID = "bafynewmeta";

  afterEach(() => {
    clearStore();
  });

  test("updates conversationMetadataCID on existing Conversation", () => {
    seedConversation();
    handleConversationMetadataUpdated(
      createConversationMetadataUpdatedEvent(
        BigInt.fromString(CONV_ID),
        NEW_META_CID
      )
    );
    assert.fieldEquals(
      "Conversation",
      CONV_ID,
      "conversationMetadataCID",
      NEW_META_CID
    );
  });

  test("does not crash when Conversation does not exist", () => {
    handleConversationMetadataUpdated(
      createConversationMetadataUpdatedEvent(
        BigInt.fromI32(999),
        NEW_META_CID
      )
    );
    assert.entityCount("Conversation", 0);
  });
});

// ---------------------------------------------------------------------------
// SearchIndexDeltaAdded — creates SearchDelta linked to Message
// ---------------------------------------------------------------------------
describe("EVMAIAgent — handleSearchIndexDeltaAdded", () => {
  const MSG_ID = "50";

  beforeAll(() => {
    seedConversation();
    handlePromptMessageAdded(
      createPromptMessageAddedEvent(
        BigInt.fromString(CONV_ID),
        BigInt.fromString(MSG_ID),
        MSG_CID
      )
    );
    handleSearchIndexDeltaAdded(
      createSearchIndexDeltaAddedEvent(BigInt.fromString(MSG_ID), SEARCH_CID)
    );
  });

  afterAll(() => {
    clearStore();
  });

  test("SearchDelta entity is created", () => {
    assert.entityCount("SearchDelta", 1);
  });

  test("SearchDelta links to message", () => {
    assert.fieldEquals("SearchDelta", MSG_ID, "message", MSG_ID);
  });

  test("SearchDelta stores searchDeltaCID", () => {
    assert.fieldEquals("SearchDelta", MSG_ID, "searchDeltaCID", SEARCH_CID);
  });
});

// ---------------------------------------------------------------------------
// BranchRequested — creates Activity with branch fee
// ---------------------------------------------------------------------------
describe("EVMAIAgent — handleBranchRequested creates BRANCH Activity", () => {
  afterEach(() => {
    clearStore();
  });

  test("Activity is created with type BRANCH and negative fee", () => {
    // The handler reads branchFee from the indexed FeeConfig, NOT via an eth_call.
    let fc = seedFeeConfig();
    fc.branchFee = BigInt.fromI32(500);
    fc.save();

    let event = createBranchRequestedEvent(
      Address.fromString(USER_ADDRESS),
      BigInt.fromI32(1),
      BigInt.fromI32(50),
      BigInt.fromI32(2),
      Bytes.fromHexString("0xaa"),
      Bytes.fromHexString("0xbb")
    );
    handleBranchRequested(event);

    assert.entityCount("Activity", 1);
    let id =
      event.transaction.hash.toHexString() +
      "-" +
      event.logIndex.toString();
    assert.fieldEquals("Activity", id, "type", "BRANCH");
    assert.fieldEquals("Activity", id, "amount", "-500");
    assert.fieldEquals("Activity", id, "user", USER_ADDRESS);
  });
});

// ---------------------------------------------------------------------------
// MetadataUpdateRequested — creates Activity with metadata update fee
// ---------------------------------------------------------------------------
describe("EVMAIAgent — handleMetadataUpdateRequested creates METADATA_UPDATE Activity", () => {
  afterEach(() => {
    clearStore();
  });

  test("Activity is created with type METADATA_UPDATE and negative fee", () => {
    // The handler reads metadataUpdateFee from the indexed FeeConfig, NOT via an eth_call.
    let fc = seedFeeConfig();
    fc.metadataUpdateFee = BigInt.fromI32(200);
    fc.save();

    let event = createMetadataUpdateRequestedEvent(
      Address.fromString(USER_ADDRESS),
      BigInt.fromI32(1),
      Bytes.fromHexString("0xcc"),
      Bytes.fromHexString("0xdd")
    );
    handleMetadataUpdateRequested(event);

    assert.entityCount("Activity", 1);
    let id =
      event.transaction.hash.toHexString() +
      "-" +
      event.logIndex.toString();
    assert.fieldEquals("Activity", id, "type", "METADATA_UPDATE");
    assert.fieldEquals("Activity", id, "amount", "-200");
    assert.fieldEquals("Activity", id, "user", USER_ADDRESS);
  });
});

// ---------------------------------------------------------------------------
// Full prompt lifecycle: Submit → Answer
// ---------------------------------------------------------------------------
describe("EVMAIAgent — PromptRequest lifecycle: submit then answer", () => {
  beforeAll(() => {
    seedConversationAndPrompt();
    handleAnswerMessageAdded(
      createAnswerMessageAddedEvent(
        BigInt.fromString(CONV_ID),
        BigInt.fromString(ANSWER_MSG_ID),
        MSG_CID
      )
    );
  });

  afterAll(() => {
    clearStore();
  });

  test("PromptRequest.isAnswered transitions to true", () => {
    assert.fieldEquals("PromptRequest", ANSWER_MSG_ID, "isAnswered", "true");
  });

  test("PromptRequest.isCancelled remains false", () => {
    assert.fieldEquals("PromptRequest", ANSWER_MSG_ID, "isCancelled", "false");
  });

  test("PromptRequest.isRefunded remains false", () => {
    assert.fieldEquals("PromptRequest", ANSWER_MSG_ID, "isRefunded", "false");
  });

  test("answer Message is created alongside the request update", () => {
    assert.entityCount("Message", 1);
    assert.fieldEquals("Message", ANSWER_MSG_ID, "role", "assistant");
  });
});

// ---------------------------------------------------------------------------
// Full prompt lifecycle: Submit → Cancel
// ---------------------------------------------------------------------------
describe("EVMAIAgent — PromptRequest lifecycle: submit then cancel", () => {
  beforeAll(() => {
    seedConversationAndPrompt();
    handlePromptCancelled(
      createAgentPromptCancelledEvent(
        Address.fromString(USER_ADDRESS),
        BigInt.fromString(ANSWER_MSG_ID)
      )
    );
  });

  afterAll(() => {
    clearStore();
  });

  test("PromptRequest.isCancelled transitions to true", () => {
    assert.fieldEquals("PromptRequest", ANSWER_MSG_ID, "isCancelled", "true");
  });

  test("PromptRequest.isAnswered remains false", () => {
    assert.fieldEquals("PromptRequest", ANSWER_MSG_ID, "isAnswered", "false");
  });

  test("PromptRequest.isRefunded remains false", () => {
    assert.fieldEquals("PromptRequest", ANSWER_MSG_ID, "isRefunded", "false");
  });
});
