import { newMockEvent } from "matchstick-as";
import { ethereum, Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  ConversationAdded,
  PromptMessageAdded,
  AnswerMessageAdded,
  ConversationBranched,
  ConversationMetadataUpdated,
  SearchIndexDeltaAdded,
  PromptSubmitted,
  PromptCancelled,
  BranchRequested,
  MetadataUpdateRequested,
} from "../generated/EVMAIAgent/EVMAIAgent";

export function createConversationAddedEvent(
  user: Address,
  conversationId: BigInt,
  conversationCID: string,
  metadataCID: string
): ConversationAdded {
  let conversationAddedEvent = changetype<ConversationAdded>(newMockEvent());

  conversationAddedEvent.parameters = new Array();

  conversationAddedEvent.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  );
  conversationAddedEvent.parameters.push(
    new ethereum.EventParam(
      "conversationId",
      ethereum.Value.fromUnsignedBigInt(conversationId)
    )
  );
  conversationAddedEvent.parameters.push(
    new ethereum.EventParam(
      "conversationCID",
      ethereum.Value.fromString(conversationCID)
    )
  );
  conversationAddedEvent.parameters.push(
    new ethereum.EventParam(
      "metadataCID",
      ethereum.Value.fromString(metadataCID)
    )
  );

  return conversationAddedEvent;
}

export function createPromptSubmittedEvent(
  user: Address,
  conversationId: BigInt,
  promptMessageId: BigInt,
  answerMessageId: BigInt
): PromptSubmitted {
  let event = changetype<PromptSubmitted>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  );
  event.parameters.push(
    new ethereum.EventParam(
      "conversationId",
      ethereum.Value.fromUnsignedBigInt(conversationId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "promptMessageId",
      ethereum.Value.fromUnsignedBigInt(promptMessageId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "answerMessageId",
      ethereum.Value.fromUnsignedBigInt(answerMessageId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "encryptedPayload",
      ethereum.Value.fromBytes(Bytes.fromHexString("0x"))
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "roflEncryptedKey",
      ethereum.Value.fromBytes(Bytes.fromHexString("0x"))
    )
  );
  return event;
}

export function createAgentPromptCancelledEvent(
  user: Address,
  answerMessageId: BigInt
): PromptCancelled {
  let event = changetype<PromptCancelled>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  );
  event.parameters.push(
    new ethereum.EventParam(
      "answerMessageId",
      ethereum.Value.fromUnsignedBigInt(answerMessageId)
    )
  );
  return event;
}

export function createPromptMessageAddedEvent(
  conversationId: BigInt,
  messageId: BigInt,
  messageCID: string
): PromptMessageAdded {
  let event = changetype<PromptMessageAdded>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "conversationId",
      ethereum.Value.fromUnsignedBigInt(conversationId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "messageId",
      ethereum.Value.fromUnsignedBigInt(messageId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam("messageCID", ethereum.Value.fromString(messageCID))
  );
  return event;
}

export function createAnswerMessageAddedEvent(
  conversationId: BigInt,
  messageId: BigInt,
  messageCID: string
): AnswerMessageAdded {
  let event = changetype<AnswerMessageAdded>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "conversationId",
      ethereum.Value.fromUnsignedBigInt(conversationId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "messageId",
      ethereum.Value.fromUnsignedBigInt(messageId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam("messageCID", ethereum.Value.fromString(messageCID))
  );
  return event;
}

export function createConversationBranchedEvent(
  user: Address,
  newConversationId: BigInt,
  originalConversationId: BigInt,
  branchPointMessageId: BigInt,
  conversationCID: string,
  metadataCID: string
): ConversationBranched {
  let event = changetype<ConversationBranched>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  );
  event.parameters.push(
    new ethereum.EventParam(
      "newConversationId",
      ethereum.Value.fromUnsignedBigInt(newConversationId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "originalConversationId",
      ethereum.Value.fromUnsignedBigInt(originalConversationId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "branchPointMessageId",
      ethereum.Value.fromUnsignedBigInt(branchPointMessageId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "conversationCID",
      ethereum.Value.fromString(conversationCID)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "metadataCID",
      ethereum.Value.fromString(metadataCID)
    )
  );
  return event;
}

export function createConversationMetadataUpdatedEvent(
  conversationId: BigInt,
  newConversationMetadataCID: string
): ConversationMetadataUpdated {
  let event = changetype<ConversationMetadataUpdated>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "conversationId",
      ethereum.Value.fromUnsignedBigInt(conversationId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "newConversationMetadataCID",
      ethereum.Value.fromString(newConversationMetadataCID)
    )
  );
  return event;
}

export function createSearchIndexDeltaAddedEvent(
  messageId: BigInt,
  searchDeltaCID: string
): SearchIndexDeltaAdded {
  let event = changetype<SearchIndexDeltaAdded>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "messageId",
      ethereum.Value.fromUnsignedBigInt(messageId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "searchDeltaCID",
      ethereum.Value.fromString(searchDeltaCID)
    )
  );
  return event;
}

export function createBranchRequestedEvent(
  user: Address,
  originalConversationId: BigInt,
  branchPointMessageId: BigInt,
  newConversationId: BigInt,
  encryptedPayload: Bytes,
  roflEncryptedKey: Bytes
): BranchRequested {
  let event = changetype<BranchRequested>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  );
  event.parameters.push(
    new ethereum.EventParam(
      "originalConversationId",
      ethereum.Value.fromUnsignedBigInt(originalConversationId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "branchPointMessageId",
      ethereum.Value.fromUnsignedBigInt(branchPointMessageId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "newConversationId",
      ethereum.Value.fromUnsignedBigInt(newConversationId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "encryptedPayload",
      ethereum.Value.fromBytes(encryptedPayload)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "roflEncryptedKey",
      ethereum.Value.fromBytes(roflEncryptedKey)
    )
  );
  return event;
}

export function createMetadataUpdateRequestedEvent(
  user: Address,
  conversationId: BigInt,
  encryptedPayload: Bytes,
  roflEncryptedKey: Bytes
): MetadataUpdateRequested {
  let event = changetype<MetadataUpdateRequested>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  );
  event.parameters.push(
    new ethereum.EventParam(
      "conversationId",
      ethereum.Value.fromUnsignedBigInt(conversationId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "encryptedPayload",
      ethereum.Value.fromBytes(encryptedPayload)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "roflEncryptedKey",
      ethereum.Value.fromBytes(roflEncryptedKey)
    )
  );
  return event;
}
