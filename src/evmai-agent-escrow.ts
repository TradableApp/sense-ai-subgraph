import { BigInt, store, Bytes, ethereum } from "@graphprotocol/graph-ts";
import {
  EVMAIAgentEscrow,
  PaymentEscrowed,
  PaymentFinalized,
  PaymentRefunded,
  SpendingLimitSet,
  SpendingLimitCancelled,
  PromptCancelled,
} from "../generated/EVMAIAgentEscrow/EVMAIAgentEscrow";
import {
  Payment,
  SpendingLimit,
  PromptRequest,
  Conversation,
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

export function handlePromptCancelled(event: PromptCancelled): void {
  let contract = EVMAIAgentEscrow.bind(event.address);
  // We fetch the fee from the contract state to record the cost
  let cancellationFee = contract.cancellationFee();

  createActivity(event, event.params.user, "CANCEL", cancellationFee.neg());
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
