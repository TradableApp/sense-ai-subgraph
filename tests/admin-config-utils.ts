import { newMockEvent } from "matchstick-as";
import { ethereum, Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  AgentEscrowUpdated,
  OracleUpdated,
  AgentJobSubmitted,
  RegenerationRequested,
} from "../generated/EVMAIAgent/EVMAIAgent";
import {
  PromptFeeUpdated,
  BranchFeeUpdated,
  CancellationFeeUpdated,
  MetadataUpdateFeeUpdated,
  TreasuryUpdated,
} from "../generated/EVMAIAgentEscrow/EVMAIAgentEscrow";

export function createAgentEscrowUpdatedEvent(
  newAIAgentEscrow: Address
): AgentEscrowUpdated {
  let event = changetype<AgentEscrowUpdated>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "newAIAgentEscrow",
      ethereum.Value.fromAddress(newAIAgentEscrow)
    )
  );
  return event;
}

export function createOracleUpdatedEvent(newOracle: Address): OracleUpdated {
  let event = changetype<OracleUpdated>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "newOracle",
      ethereum.Value.fromAddress(newOracle)
    )
  );
  return event;
}

export function createAgentJobSubmittedEvent(
  user: Address,
  jobId: BigInt,
  triggerId: BigInt,
  encryptedPayload: Bytes,
  roflEncryptedKey: Bytes
): AgentJobSubmitted {
  let event = changetype<AgentJobSubmitted>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam("user", ethereum.Value.fromAddress(user))
  );
  event.parameters.push(
    new ethereum.EventParam(
      "jobId",
      ethereum.Value.fromUnsignedBigInt(jobId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "triggerId",
      ethereum.Value.fromUnsignedBigInt(triggerId)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "encryptedPayload",
      ethereum.Value.fromBytes(encryptedPayload)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "roflEncryptedKey",
      ethereum.Value.fromBytes(roflEncryptedKey)
    )
  );
  return event;
}

export function createRegenerationRequestedEvent(
  user: Address,
  conversationId: BigInt,
  promptMessageId: BigInt,
  originalAnswerMessageId: BigInt,
  answerMessageId: BigInt,
  encryptedPayload: Bytes,
  roflEncryptedKey: Bytes
): RegenerationRequested {
  let event = changetype<RegenerationRequested>(newMockEvent());
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
      "originalAnswerMessageId",
      ethereum.Value.fromUnsignedBigInt(originalAnswerMessageId)
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
      ethereum.Value.fromBytes(encryptedPayload)
    )
  );
  event.parameters.push(
    new ethereum.EventParam(
      "roflEncryptedKey",
      ethereum.Value.fromBytes(roflEncryptedKey)
    )
  );
  return event;
}

export function createPromptFeeUpdatedEvent(newFee: BigInt): PromptFeeUpdated {
  let event = changetype<PromptFeeUpdated>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "newFee",
      ethereum.Value.fromUnsignedBigInt(newFee)
    )
  );
  return event;
}

export function createBranchFeeUpdatedEvent(newFee: BigInt): BranchFeeUpdated {
  let event = changetype<BranchFeeUpdated>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "newFee",
      ethereum.Value.fromUnsignedBigInt(newFee)
    )
  );
  return event;
}

export function createCancellationFeeUpdatedEvent(
  newFee: BigInt
): CancellationFeeUpdated {
  let event = changetype<CancellationFeeUpdated>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "newFee",
      ethereum.Value.fromUnsignedBigInt(newFee)
    )
  );
  return event;
}

export function createMetadataUpdateFeeUpdatedEvent(
  newFee: BigInt
): MetadataUpdateFeeUpdated {
  let event = changetype<MetadataUpdateFeeUpdated>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "newFee",
      ethereum.Value.fromUnsignedBigInt(newFee)
    )
  );
  return event;
}

export function createTreasuryUpdatedEvent(
  newTreasury: Address
): TreasuryUpdated {
  let event = changetype<TreasuryUpdated>(newMockEvent());
  event.parameters = new Array();
  event.parameters.push(
    new ethereum.EventParam(
      "newTreasury",
      ethereum.Value.fromAddress(newTreasury)
    )
  );
  return event;
}
