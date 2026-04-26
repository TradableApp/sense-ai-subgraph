import {
  assert,
  describe,
  test,
  clearStore,
  beforeAll,
  afterAll,
} from "matchstick-as/assembly/index";
import { Address, BigInt } from "@graphprotocol/graph-ts";
import {
  handleConversationAdded,
  handlePromptSubmitted,
  handlePromptCancelled,
} from "../src/evmai-agent";
import {
  createConversationAddedEvent,
  createPromptSubmittedEvent,
  createAgentPromptCancelledEvent,
} from "./evmai-agent-utils";

const USER_ADDRESS = "0x0000000000000000000000000000000000000001";
const CONV_ID = "1";
const CONV_CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const META_CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const PROMPT_MSG_ID = "99";
const ANSWER_MSG_ID = "100";

describe("EVMAIAgent — Conversation creation", () => {
  beforeAll(() => {
    let user = Address.fromString(USER_ADDRESS);
    let newEvent = createConversationAddedEvent(
      user,
      BigInt.fromString(CONV_ID),
      CONV_CID,
      META_CID
    );
    handleConversationAdded(newEvent);
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
});

// ---------------------------------------------------------------------------
// Agent PromptCancelled → PromptRequest.isCancelled = true (cross-repo contract)
// ---------------------------------------------------------------------------
describe("EVMAIAgent — handlePromptCancelled sets isCancelled", () => {
  beforeAll(() => {
    let user = Address.fromString(USER_ADDRESS);

    handleConversationAdded(
      createConversationAddedEvent(
        user,
        BigInt.fromString(CONV_ID),
        CONV_CID,
        META_CID
      )
    );

    handlePromptSubmitted(
      createPromptSubmittedEvent(
        user,
        BigInt.fromString(CONV_ID),
        BigInt.fromString(PROMPT_MSG_ID),
        BigInt.fromString(ANSWER_MSG_ID)
      )
    );

    handlePromptCancelled(
      createAgentPromptCancelledEvent(user, BigInt.fromString(ANSWER_MSG_ID))
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
