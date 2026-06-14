import { BigInt, Bytes, ethereum, log } from "@graphprotocol/graph-ts";
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
  AgentEscrowUpdated,
  OracleUpdated,
  AgentJobSubmitted,
  RegenerationRequested,
} from "../generated/EVMAIAgent/EVMAIAgent";
import {
  Conversation,
  Message,
  SearchDelta,
  PromptRequest,
  Activity,
  ProtocolConfig,
  AgentJob,
  RegenerationRequest,
  FeeConfig,
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

// Read fees from the indexed FeeConfig singleton (populated by the *FeeUpdated events,
// incl. on initialize) instead of an eth_call — The Graph "avoid eth_calls" best practice,
// and an eth_call also breaks graph-node↔Hardhat on localnet. Typed (not string-keyed) so
// an unknown field can't silently fall through to 0. If FeeConfig is missing (the
// initialize() fee events haven't been indexed — see tokenized-ai-agent #39), we log a
// warning and fall back to 0: Activity is immutable, so a wrong amount can't be patched.
function readBranchFee(): BigInt {
  let fees = FeeConfig.load("singleton");
  if (fees == null || fees.branchFee === null) {
    log.warning("[handleBranchRequested] FeeConfig branchFee missing — defaulting to 0", []);
    return BigInt.fromI32(0);
  }
  return fees.branchFee!;
}

function readMetadataUpdateFee(): BigInt {
  let fees = FeeConfig.load("singleton");
  if (fees == null || fees.metadataUpdateFee === null) {
    log.warning(
      "[handleMetadataUpdateRequested] FeeConfig metadataUpdateFee missing — defaulting to 0",
      []
    );
    return BigInt.fromI32(0);
  }
  return fees.metadataUpdateFee!;
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
  let fee = readBranchFee();
  createActivity(event, event.params.user, "BRANCH", fee.neg());
}

export function handleMetadataUpdateRequested(
  event: MetadataUpdateRequested
): void {
  // Encrypted payload means we don't know if it's rename or delete here
  let fee = readMetadataUpdateFee();
  createActivity(event, event.params.user, "METADATA_UPDATE", fee.neg());
}

// --- Admin / Config Handlers ---

export function handleAgentEscrowUpdated(event: AgentEscrowUpdated): void {
  let config = ProtocolConfig.load("singleton");
  if (!config) {
    config = new ProtocolConfig("singleton");
  }
  config.escrowAddress = event.params.newAIAgentEscrow;
  config.updatedAt = event.block.timestamp;
  config.save();
}

export function handleOracleUpdated(event: OracleUpdated): void {
  let config = ProtocolConfig.load("singleton");
  if (!config) {
    config = new ProtocolConfig("singleton");
  }
  config.oracleAddress = event.params.newOracle;
  config.updatedAt = event.block.timestamp;
  config.save();
}

export function handleAgentJobSubmitted(event: AgentJobSubmitted): void {
  let id =
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let job = new AgentJob(id);
  job.user = event.params.user;
  job.jobId = event.params.jobId;
  job.triggerId = event.params.triggerId;
  job.encryptedPayload = event.params.encryptedPayload;
  job.roflEncryptedKey = event.params.roflEncryptedKey;
  job.timestamp = event.block.timestamp;
  job.blockNumber = event.block.number;
  job.save();
}

export function handleRegenerationRequested(
  event: RegenerationRequested
): void {
  let id =
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let regen = new RegenerationRequest(id);
  regen.user = event.params.user;
  regen.conversationId = event.params.conversationId;
  regen.promptMessageId = event.params.promptMessageId;
  regen.originalAnswerMessageId = event.params.originalAnswerMessageId;
  regen.answerMessageId = event.params.answerMessageId;
  regen.encryptedPayload = event.params.encryptedPayload;
  regen.roflEncryptedKey = event.params.roflEncryptedKey;
  regen.timestamp = event.block.timestamp;
  regen.blockNumber = event.block.number;
  regen.save();
}
