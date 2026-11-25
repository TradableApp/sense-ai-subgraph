import { BigInt, store, Bytes, ethereum, log } from "@graphprotocol/graph-ts";
import {
  PaymentEscrowed,
  PaymentFinalized,
  PaymentRefunded,
  SpendingLimitSet,
  SpendingLimitCancelled,
  CancellationSettled,
  DirectPaymentProcessed,
  PromptFeeUpdated,
  BranchFeeUpdated,
  CancellationFeeUpdated,
  MetadataUpdateFeeUpdated,
  TreasuryUpdated,
} from "../generated/EVMAIAgentEscrow/EVMAIAgentEscrow";
import {
  Payment,
  SpendingLimit,
  PromptRequest,
  Conversation,
  Activity,
  FeeConfig,
  ProtocolConfig,
  TreasuryChange,
  FeeChange,
  PendingDirectPayment,
} from "../generated/schema";

// Helper function to create activities. The id is txHash-logIndex; a second row written for
// the same event (the amount a cancel hands back) passes a suffix so the ids stay distinct.
function createActivity(
  event: ethereum.Event,
  user: Bytes,
  type: String,
  amount: BigInt,
  idSuffix: string = ""
): void {
  let activity = new Activity(
    event.transaction.hash.toHex() + "-" + event.logIndex.toString() + idSuffix
  );
  activity.user = user;
  activity.type = type.toString();
  activity.amount = amount;
  activity.timestamp = event.block.timestamp;
  activity.transactionHash = event.transaction.hash;
  activity.save();
}

export function handlePaymentEscrowed(event: PaymentEscrowed): void {
  let payment = new Payment(event.params.escrowId.toString());
  payment.user = event.params.user;
  payment.amount = event.params.amount;
  payment.status = "PENDING";
  payment.createdAt = event.block.timestamp;
  payment.txHash = event.transaction.hash.toHexString();
  payment.save();

  createActivity(
    event,
    event.params.user,
    "CONVERSATION",
    event.params.amount.neg()
  );
}

export function handlePaymentFinalized(event: PaymentFinalized): void {
  let payment = Payment.load(event.params.escrowId.toString());
  if (payment) {
    payment.status = "COMPLETE";
    payment.finalizedAt = event.block.timestamp;
    payment.save();
  }

  let requestId = event.params.escrowId.toString();
  let request = PromptRequest.load(requestId);
  if (request) {
    request.isAnswered = true;
    request.save();

    let conversation = Conversation.load(request.conversation);
    if (conversation) {
      conversation.lastMessageCreatedAt = event.block.timestamp;
      conversation.save();
    }
  }
}

export function handlePaymentRefunded(event: PaymentRefunded): void {
  // 1. Update Payment Entity
  let payment = Payment.load(event.params.escrowId.toString());
  if (payment) {
    payment.status = "REFUNDED";
    payment.finalizedAt = event.block.timestamp;
    payment.save();

    createActivity(event, payment.user, "REFUND", payment.amount);
  }

  // 2. Update PromptRequest Entity
  // The escrowId matches the answerMessageId used as the ID for PromptRequest
  let requestId = event.params.escrowId.toString();
  let request = PromptRequest.load(requestId);

  if (request) {
    request.isRefunded = true;
    request.save();

    // Update Conversation Timestamp so syncService picks up the "Refunded" status
    let conversation = Conversation.load(request.conversation);
    if (conversation) {
      conversation.lastMessageCreatedAt = event.block.timestamp;
      conversation.save();
    }
  }
}

// A cancel is filed from the escrow's own event, which carries the user, the fee charged and the
// amount sent back: no fee setting and no stored Payment is needed to know them. The fee comes
// out of the escrowed amount. The rows keep the shape they had: CANCEL is minus the fee, and
// CANCEL_RETURN is plus the whole escrowed amount released by the cancel (the fee and what was
// sent back), so the prompt's CONVERSATION row, CANCEL and CANCEL_RETURN sum to minus the fee,
// which is what the cancel cost. The agent's PromptCancelled, in the same transaction, marks the
// PromptRequest.
export function handleCancellationSettled(event: CancellationSettled): void {
  createActivity(event, event.params.user, "CANCEL", event.params.fee.neg());
  createActivity(
    event,
    event.params.user,
    "CANCEL_RETURN",
    event.params.fee.plus(event.params.returned),
    "-return"
  );

  // The escrow closes its record on a cancel, and its id is the answer message id. Left at
  // PENDING, the payment would be listed as stuck and offered a refund the contract refuses.
  let payment = Payment.load(event.params.escrowId.toString());
  if (payment) {
    payment.status = "CANCELLED";
    payment.finalizedAt = event.block.timestamp;
    payment.save();
  } else {
    log.warning(
      "[handleCancellationSettled] no Payment indexed for escrow {}",
      [event.params.escrowId.toString()]
    );
  }
}

// The escrow emits this for a branch or a metadata update, before the agent's BranchRequested /
// MetadataUpdateRequested in the same transaction. Queue the amount by transaction so the
// agent's handler records the amount this event carries. With these contracts that is the same
// number as the fee in force (FeeConfig follows the fee events in log order); what is gained is
// that the amount no longer depends on FeeConfig being complete, where a fee whose *FeeUpdated was
// never indexed (a start block after initialize) is recorded as 0.
export function handleDirectPaymentProcessed(
  event: DirectPaymentProcessed
): void {
  let id = event.transaction.hash.toHexString();
  let pending = PendingDirectPayment.load(id);
  let users: Array<Bytes>;
  let amounts: Array<BigInt>;
  if (pending) {
    users = pending.users;
    amounts = pending.amounts;
  } else {
    pending = new PendingDirectPayment(id);
    users = new Array<Bytes>();
    amounts = new Array<BigInt>();
  }
  pending.users = users.concat([changetype<Bytes>(event.params.user)]);
  pending.amounts = amounts.concat([event.params.amount]);
  pending.save();
}

export function handleSpendingLimitSet(event: SpendingLimitSet): void {
  let id = event.params.user.toHexString();
  let limit = new SpendingLimit(id);
  limit.user = event.params.user;
  limit.allowance = event.params.allowance;
  limit.expiresAt = event.params.expiresAt;
  limit.updatedAt = event.block.timestamp;
  limit.save();

  createActivity(event, event.params.user, "PLAN_UPDATE", BigInt.fromI32(0));
}

export function handleSpendingLimitCancelled(
  event: SpendingLimitCancelled
): void {
  store.remove("SpendingLimit", event.params.user.toHexString());

  createActivity(event, event.params.user, "PLAN_REVOKE", BigInt.fromI32(0));
}

// --- Fee Config Handlers ---

function loadOrCreateFeeConfig(timestamp: BigInt): FeeConfig {
  let fees = FeeConfig.load("singleton");
  if (!fees) {
    // Each fee stays unset until its own event is seen: the change history must not claim a fee
    // was 0 before its first event. So a reader must check a fee for null before using it, as
    // the existing ones do; FeeConfig existing does not mean every fee is known.
    fees = new FeeConfig("singleton");
    fees.updatedAt = timestamp;
  }
  return fees;
}

// One immutable record per fee change, beside the current value on FeeConfig.
function recordFeeChange(
  event: ethereum.Event,
  fee: string,
  previousFee: BigInt | null,
  newFee: BigInt
): void {
  let id =
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let change = new FeeChange(id);
  change.fee = fee;
  change.previousFee = previousFee;
  change.newFee = newFee;
  change.txFrom = event.transaction.from;
  change.blockNumber = event.block.number;
  change.timestamp = event.block.timestamp;
  change.txHash = event.transaction.hash;
  change.save();
}

export function handlePromptFeeUpdated(event: PromptFeeUpdated): void {
  let fees = loadOrCreateFeeConfig(event.block.timestamp);
  recordFeeChange(event, "PROMPT", fees.promptFee, event.params.newFee);
  fees.promptFee = event.params.newFee;
  fees.updatedAt = event.block.timestamp;
  fees.save();
}

export function handleBranchFeeUpdated(event: BranchFeeUpdated): void {
  let fees = loadOrCreateFeeConfig(event.block.timestamp);
  recordFeeChange(event, "BRANCH", fees.branchFee, event.params.newFee);
  fees.branchFee = event.params.newFee;
  fees.updatedAt = event.block.timestamp;
  fees.save();
}

export function handleCancellationFeeUpdated(
  event: CancellationFeeUpdated
): void {
  let fees = loadOrCreateFeeConfig(event.block.timestamp);
  recordFeeChange(
    event,
    "CANCELLATION",
    fees.cancellationFee,
    event.params.newFee
  );
  fees.cancellationFee = event.params.newFee;
  fees.updatedAt = event.block.timestamp;
  fees.save();
}

export function handleMetadataUpdateFeeUpdated(
  event: MetadataUpdateFeeUpdated
): void {
  let fees = loadOrCreateFeeConfig(event.block.timestamp);
  recordFeeChange(
    event,
    "METADATA_UPDATE",
    fees.metadataUpdateFee,
    event.params.newFee
  );
  fees.metadataUpdateFee = event.params.newFee;
  fees.updatedAt = event.block.timestamp;
  fees.save();
}

export function handleTreasuryUpdated(event: TreasuryUpdated): void {
  let config = ProtocolConfig.load("singleton");
  if (!config) {
    config = new ProtocolConfig("singleton");
  }
  let id =
    event.transaction.hash.toHexString() + "-" + event.logIndex.toString();
  let change = new TreasuryChange(id);
  change.previousTreasury = config.treasuryAddress;
  change.newTreasury = event.params.newTreasury;
  change.txFrom = event.transaction.from;
  change.blockNumber = event.block.number;
  change.timestamp = event.block.timestamp;
  change.txHash = event.transaction.hash;
  change.save();

  config.treasuryAddress = event.params.newTreasury;
  config.updatedAt = event.block.timestamp;
  config.save();
}
