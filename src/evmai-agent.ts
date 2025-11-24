import { BigInt } from "@graphprotocol/graph-ts";
import {
  ConversationAdded,
  PromptMessageAdded,
  AnswerMessageAdded,
  ConversationBranched,
  ConversationMetadataUpdated,
  SearchIndexDeltaAdded,
} from "../generated/EVMAIAgent/EVMAIAgent";
import { Conversation, Message, SearchDelta } from "../generated/schema";

export function handleConversationAdded(event: ConversationAdded): void {
  let entity = new Conversation(event.params.conversationId.toString());
  entity.owner = event.params.user;
  entity.conversationId = event.params.conversationId;
  entity.conversationCID = event.params.conversationCID;
  entity.conversationMetadataCID = event.params.metadataCID;
  entity.lastMessageCreatedAt = event.block.timestamp;
  entity.createdAtBlock = event.block.number;
  entity.isDeleted = false;
  entity.save();
}

export function handleConversationBranched(event: ConversationBranched): void {
  let entity = new Conversation(event.params.newConversationId.toString());
  entity.owner = event.params.user;
  entity.conversationId = event.params.newConversationId;
  entity.conversationCID = event.params.conversationCID;
  entity.conversationMetadataCID = event.params.metadataCID;
  entity.lastMessageCreatedAt = event.block.timestamp;
  entity.createdAtBlock = event.block.number;
  entity.isDeleted = false;

  // Link to original conversation
  entity.branchedFrom = event.params.originalConversationId.toString();

  entity.save();
}

export function handlePromptMessageAdded(event: PromptMessageAdded): void {
  let conversationId = event.params.conversationId.toString();
  let messageId = event.params.messageId.toString();

  let message = new Message(messageId);
  message.messageId = event.params.messageId;
  message.conversation = conversationId;
  message.messageCID = event.params.messageCID;
  message.role = "user";
  message.createdAt = event.block.timestamp;
  message.transactionHash = event.transaction.hash.toHexString();
  message.save();

  // Update conversation timestamp for sorting
  let conversation = Conversation.load(conversationId);
  if (conversation) {
    conversation.lastMessageCreatedAt = event.block.timestamp;
    conversation.save();
  }
}

export function handleAnswerMessageAdded(event: AnswerMessageAdded): void {
  let conversationId = event.params.conversationId.toString();
  let messageId = event.params.messageId.toString();

  let message = new Message(messageId);
  message.messageId = event.params.messageId;
  message.conversation = conversationId;
  message.messageCID = event.params.messageCID;
  message.role = "assistant";
  message.createdAt = event.block.timestamp;
  message.transactionHash = event.transaction.hash.toHexString();
  message.save();

  // Update conversation timestamp for sorting
  let conversation = Conversation.load(conversationId);
  if (conversation) {
    conversation.lastMessageCreatedAt = event.block.timestamp;
    conversation.save();
  }
}

export function handleSearchIndexDeltaAdded(
  event: SearchIndexDeltaAdded
): void {
  let messageId = event.params.messageId.toString();

  let delta = new SearchDelta(messageId);
  delta.message = messageId;
  delta.searchDeltaCID = event.params.searchDeltaCID;
  delta.save();
}

export function handleConversationMetadataUpdated(
  event: ConversationMetadataUpdated
): void {
  let conversation = Conversation.load(event.params.conversationId.toString());
  if (conversation) {
    conversation.conversationMetadataCID =
      event.params.newConversationMetadataCID;
    // Note: We don't explicitly track "isDeleted" here because the metadata CID
    // contains the encrypted "isDeleted" flag which the frontend handles.
    // However, if you want to filter deleted convos purely on the graph,
    // you would need a specific event for deletion or metadata parsing (impossible here).
    conversation.save();
  }
}
