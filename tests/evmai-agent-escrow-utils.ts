import { newMockEvent } from "matchstick-as";
import { ethereum, Address, BigInt } from "@graphprotocol/graph-ts";
import {
  CancellationSettled,
  DirectPaymentProcessed,
  PaymentEscrowed,
  PaymentFinalized,
  PaymentRefunded,
  SpendingLimitSet,
  SpendingLimitCancelled,
} from "../generated/EVMAIAgentEscrow/EVMAIAgentEscrow";

export function createPaymentEscrowedEvent(
  escrowId: BigInt,
  user: Address,
  amount: BigInt
): PaymentEscrowed {
  let event = changetype<PaymentEscrowed>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "escrowId",
      ethereum.Value.fromUnsignedBigInt(escrowId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  );
  event.parameters.push(
    new ethereum.EventParam(
      "amount",
      ethereum.Value.fromUnsignedBigInt(amount)
    )
  );
  return event;
}

export function createPaymentFinalizedEvent(escrowId: BigInt): PaymentFinalized {
  let event = changetype<PaymentFinalized>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "escrowId",
      ethereum.Value.fromUnsignedBigInt(escrowId)
    )
  );
  return event;
}

export function createPaymentRefundedEvent(escrowId: BigInt): PaymentRefunded {
  let event = changetype<PaymentRefunded>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "escrowId",
      ethereum.Value.fromUnsignedBigInt(escrowId)
    )
  );
  return event;
}

export function createCancellationSettledEvent(
  escrowId: BigInt,
  user: Address,
  fee: BigInt,
  returned: BigInt
): CancellationSettled {
  let event = changetype<CancellationSettled>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "escrowId",
      ethereum.Value.fromUnsignedBigInt(escrowId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  );
  event.parameters.push(
    new ethereum.EventParam("fee", ethereum.Value.fromUnsignedBigInt(fee))
  );
  event.parameters.push(
    new ethereum.EventParam(
      "returned",
      ethereum.Value.fromUnsignedBigInt(returned)
    )
  );
  return event;
}

export function createSpendingLimitSetEvent(
  user: Address,
  allowance: BigInt,
  expiresAt: BigInt
): SpendingLimitSet {
  let event = changetype<SpendingLimitSet>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  );
  event.parameters.push(
    new ethereum.EventParam(
      "allowance",
      ethereum.Value.fromUnsignedBigInt(allowance)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "expiresAt",
      ethereum.Value.fromUnsignedBigInt(expiresAt)
    )
  );
  return event;
}

export function createSpendingLimitCancelledEvent(
  user: Address
): SpendingLimitCancelled {
  let event = changetype<SpendingLimitCancelled>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  );
  return event;
}

export function createDirectPaymentProcessedEvent(
  user: Address,
  amount: BigInt
): DirectPaymentProcessed {
  let event = changetype<DirectPaymentProcessed>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  );
  event.parameters.push(
    new ethereum.EventParam(
      "amount",
      ethereum.Value.fromUnsignedBigInt(amount)
    )
  );
  return event;
}
