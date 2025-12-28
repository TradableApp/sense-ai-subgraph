import { BigInt, Bytes, ethereum, Address } from "@graphprotocol/graph-ts";
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
  EVMAIAgent,
} from "../generated/EVMAIAgent/EVMAIAgent";
import { EVMAIAgentEscrow } from "../generated/EVMAIAgentEscrow/EVMAIAgentEscrow";
import {
  Conversation,
  Message,
  SearchDelta,
  PromptRequest,
  Activity,
} from "../generated/schema";

// Helper function to create activities
function createActivity(
  event: ethereum.Event,
  user: Bytes,
  type: String,
  amount: BigInt
): void {
  let activity = new Activity(
    event.transaction.hash.toHex() + "-" + event.logIndex.toString()
  );
  activity.user = user;
  activity.type = type.toString();
  activity.amount = amount;
  activity.timestamp = event.block.timestamp;
  activity.transactionHash = event.transaction.hash;
  activity.save();
}

// Helper to get the Escrow contract to read fees
function getEscrowContract(agentAddress: Address): EVMAIAgentEscrow {
  let agent = EVMAIAgent.bind(agentAddress);
  let escrowAddress = agent.aiAgentEscrow();
  return EVMAIAgentEscrow.bind(escrowAddress);
}

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

  // Mark the request as answered so we don't sync it as "pending" or "cancelled"
  let requestId = event.params.messageId.toString();
  let request = PromptRequest.load(requestId);
  if (request) {
    request.isAnswered = true;
    request.save();
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

    // Update timestamp to ensure sync service picks up the change
    conversation.lastMessageCreatedAt = event.block.timestamp;

    // Note: We don't explicitly track "isDeleted" here because the metadata CID
    // contains the encrypted "isDeleted" flag which the frontend handles.
    // However, if you want to filter deleted convos purely on the graph,
    // you would need a specific event for deletion or metadata parsing (impossible here).
    conversation.save();
  }
}

// --- Handle Raw Intent for Cancelled History ---

export function handlePromptSubmitted(event: PromptSubmitted): void {
  // We key by answerMessageId because that's the only ID available during cancellation
  let id = event.params.answerMessageId.toString();

  let entity = new PromptRequest(id);
  entity.promptMessageId = event.params.promptMessageId;
  entity.conversation = event.params.conversationId.toString();
  entity.user = event.params.user;
  entity.encryptedPayload = event.params.encryptedPayload;

  // Initialize state
  entity.isCancelled = false;
  entity.isAnswered = false;
  entity.isRefunded = false;

  entity.createdAt = event.block.timestamp;
  entity.transactionHash = event.transaction.hash.toHexString();

  entity.save();

  // Update Conversation Timestamp so syncService picks up the "Pending" item
  let conversation = Conversation.load(event.params.conversationId.toString());
  if (conversation) {
    conversation.lastMessageCreatedAt = event.block.timestamp;
    conversation.save();
  }
}

export function handlePromptCancelled(event: PromptCancelled): void {
  let id = event.params.answerMessageId.toString();
  let entity = PromptRequest.load(id);

  if (entity) {
    entity.isCancelled = true;
    entity.save();

    // Update Conversation Timestamp so syncService picks up the "Cancelled" status
    let conversation = Conversation.load(entity.conversation);
    if (conversation) {
      conversation.lastMessageCreatedAt = event.block.timestamp;
      conversation.save();
    }
  }
}

// --- Activity Handlers for Direct Actions ---

export function handleBranchRequested(event: BranchRequested): void {
  // Capture fee from Escrow contract state
  let escrow = getEscrowContract(event.address);
  let fee = escrow.branchFee();

  createActivity(event, event.params.user, "BRANCH", fee.neg());
}

export function handleMetadataUpdateRequested(
  event: MetadataUpdateRequested
): void {
  // Capture fee from Escrow contract state
  let escrow = getEscrowContract(event.address);
  let fee = escrow.metadataUpdateFee();

  // Encrypted payload means we don't know if it's rename or delete here
  createActivity(event, event.params.user, "METADATA_UPDATE", fee.neg());
}
