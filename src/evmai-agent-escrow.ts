import { BigInt, store } from "@graphprotocol/graph-ts";
import {
  PaymentEscrowed,
  PaymentFinalized,
  PaymentRefunded,
  SpendingLimitSet,
  SpendingLimitCancelled,
} from "../generated/EVMAIAgentEscrow/EVMAIAgentEscrow";
import {
  Payment,
  SpendingLimit,
  PromptRequest,
  Conversation,
} from "../generated/schema";

export function handlePaymentEscrowed(event: PaymentEscrowed): void {
  let payment = new Payment(event.params.escrowId.toString());
  payment.user = event.params.user;
  payment.amount = event.params.amount;
  payment.status = "PENDING";
  payment.createdAt = event.block.timestamp;
  payment.txHash = event.transaction.hash.toHexString();
  payment.save();
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

export function handleSpendingLimitSet(event: SpendingLimitSet): void {
  let id = event.params.user.toHexString();
  let limit = new SpendingLimit(id);
  limit.user = event.params.user;
  limit.allowance = event.params.allowance;
  limit.expiresAt = event.params.expiresAt;
  limit.updatedAt = event.block.timestamp;
  limit.save();
}

export function handleSpendingLimitCancelled(
  event: SpendingLimitCancelled
): void {
  store.remove("SpendingLimit", event.params.user.toHexString());
}
