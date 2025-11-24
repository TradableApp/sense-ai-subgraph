import { BigInt } from "@graphprotocol/graph-ts";
import {
  PaymentEscrowed,
  PaymentFinalized,
  PaymentRefunded,
  SubscriptionSet,
} from "../generated/EVMAIAgentEscrow/EVMAIAgentEscrow";
import { Payment, Subscription } from "../generated/schema";

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
  let payment = Payment.load(event.params.escrowId.toString());
  if (payment) {
    payment.status = "REFUNDED";
    payment.finalizedAt = event.block.timestamp;
    payment.save();
  }
}

export function handleSubscriptionSet(event: SubscriptionSet): void {
  let id = event.params.user.toHexString();
  let sub = new Subscription(id);
  sub.user = event.params.user;
  sub.allowance = event.params.allowance;
  sub.expiresAt = event.params.expiresAt;
  sub.updatedAt = event.block.timestamp;
  sub.save();
}
