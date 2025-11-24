import { newMockEvent } from "matchstick-as";
import { ethereum, Address, BigInt } from "@graphprotocol/graph-ts";
import { ConversationAdded } from "../generated/EVMAIAgent/EVMAIAgent";

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
