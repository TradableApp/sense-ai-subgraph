import {
  assert,
  describe,
  test,
  clearStore,
  beforeAll,
  afterAll,
} from "matchstick-as/assembly/index";
import { Address, BigInt } from "@graphprotocol/graph-ts";
import { handleConversationAdded } from "../src/evmai-agent";
import { createConversationAddedEvent } from "./evmai-agent-utils";

// Define constants for the test
const USER_ADDRESS = "0x0000000000000000000000000000000000000001";
const CONV_ID = "1";
const CONV_CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";
const META_CID = "bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi";

describe("EVMAIAgent Logic", () => {
  beforeAll(() => {
    let user = Address.fromString(USER_ADDRESS);
    let conversationId = BigInt.fromString(CONV_ID);

    // 1. Create the mock event
    let newEvent = createConversationAddedEvent(
      user,
      conversationId,
      CONV_CID,
      META_CID
    );

    // 2. Run the handler
    handleConversationAdded(newEvent);
  });

  afterAll(() => {
    clearStore();
  });

  test("Conversation entity is created", () => {
    // 3. Assert that the entity was saved to the store
    // The ID is the string version of the conversationId (defined in your mapping)
    assert.entityCount("Conversation", 1);

    assert.fieldEquals("Conversation", CONV_ID, "owner", USER_ADDRESS);
    assert.fieldEquals("Conversation", CONV_ID, "conversationCID", CONV_CID);
    assert.fieldEquals("Conversation", CONV_ID, "isDeleted", "false");
  });
});
