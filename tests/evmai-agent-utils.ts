import { newMockEvent } from "matchstick-as";
import { ethereum, Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  ConversationAdded,
  PromptSubmitted,
  PromptCancelled,
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
