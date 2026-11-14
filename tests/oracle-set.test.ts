import {
  assert,
  describe,
  test,
  clearStore,
  afterEach,
} from "matchstick-as/assembly/index";
import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  handleRoleGranted,
  handleRoleRevoked,
  handleOracleEncryptionKeyUpdated,
} from "../src/evmai-agent";
import {
  createRoleGrantedEvent,
  createRoleRevokedEvent,
  createOracleEncryptionKeyUpdatedEvent,
} from "./admin-config-utils";

// keccak256("ORACLE_ROLE"), as the agent contract declares it. Written out here, not computed, so
// a wrong hash in the mapping fails this file.
const ORACLE_ROLE =
  "0x68e79a7bf1e0bc45d0a330c573bc367f9cf464fd326078812f301165fbda4ef1";
// Any other role: the mapping must ignore it.
const OTHER_ROLE =
  "0x00000000000000000000000000000000000000000000000000000000000000aa";

const OWNER = "0x00000000000000000000000000000000000000a1";
const ORACLE_ONE = "0x00000000000000000000000000000000000000b1";
const ORACLE_TWO = "0x00000000000000000000000000000000000000b2";
const SINGLETON_ID = "singleton";

// A compressed secp256k1 public key is 33 bytes: 0x02 or 0x03, then the x coordinate.
const KEY_ONE = "0x02" + "11".repeat(32);
const KEY_TWO = "0x03" + "22".repeat(32);

function grant(oracle: string, logIndex: i32 = 1): string {
  let event = createRoleGrantedEvent(
    Bytes.fromHexString(ORACLE_ROLE),
    Address.fromString(oracle),
    Address.fromString(OWNER),
    logIndex
  );
  handleRoleGranted(event);
  return event.transaction.hash.toHexString() + "-" + logIndex.toString();
}

function revoke(oracle: string, sender: string, logIndex: i32): string {
  let event = createRoleRevokedEvent(
    Bytes.fromHexString(ORACLE_ROLE),
    Address.fromString(oracle),
    Address.fromString(sender),
    logIndex
  );
  handleRoleRevoked(event);
  return event.transaction.hash.toHexString() + "-" + logIndex.toString();
}

function grantAt(oracle: string, logIndex: i32, timestamp: i32): void {
  let event = createRoleGrantedEvent(
    Bytes.fromHexString(ORACLE_ROLE),
    Address.fromString(oracle),
    Address.fromString(OWNER),
    logIndex
  );
  event.block.timestamp = BigInt.fromI32(timestamp);
  handleRoleGranted(event);
}

function revokeAt(oracle: string, logIndex: i32, timestamp: i32): void {
  let event = createRoleRevokedEvent(
    Bytes.fromHexString(ORACLE_ROLE),
    Address.fromString(oracle),
    Address.fromString(OWNER),
    logIndex
  );
  event.block.timestamp = BigInt.fromI32(timestamp);
  handleRoleRevoked(event);
}

describe("Oracle set — who holds the oracle role now", () => {
  afterEach(() => {
    clearStore();
  });

  test("a granted oracle is listed as active", () => {
    grant(ORACLE_ONE);

    assert.entityCount("Oracle", 1);
    assert.fieldEquals("Oracle", ORACLE_ONE, "address", ORACLE_ONE);
    assert.fieldEquals("Oracle", ORACLE_ONE, "active", "true");
  });

  test("two oracles can be active at once", () => {
    grant(ORACLE_ONE, 1);
    grant(ORACLE_TWO, 2);

    assert.entityCount("Oracle", 2);
    assert.fieldEquals("Oracle", ORACLE_ONE, "active", "true");
    assert.fieldEquals("Oracle", ORACLE_TWO, "active", "true");
  });

  test("a removed oracle stays on record as inactive, and the other stays active", () => {
    grant(ORACLE_ONE, 1);
    grant(ORACLE_TWO, 2);
    revoke(ORACLE_ONE, OWNER, 3);

    assert.entityCount("Oracle", 2);
    assert.fieldEquals("Oracle", ORACLE_ONE, "active", "false");
    assert.fieldEquals("Oracle", ORACLE_TWO, "active", "true");
  });

  test("an oracle added again after removal is active again, in the same record", () => {
    grantAt(ORACLE_ONE, 1, 1000);
    revokeAt(ORACLE_ONE, 2, 2000);
    assert.fieldEquals("Oracle", ORACLE_ONE, "active", "false");
    assert.fieldEquals("Oracle", ORACLE_ONE, "addedAt", "1000");
    assert.fieldEquals("Oracle", ORACLE_ONE, "removedAt", "2000");
    assert.fieldEquals("Oracle", ORACLE_ONE, "updatedAt", "2000");

    grantAt(ORACLE_ONE, 3, 3000);
    assert.entityCount("Oracle", 1);
    assert.fieldEquals("Oracle", ORACLE_ONE, "active", "true");
    assert.fieldEquals("Oracle", ORACLE_ONE, "addedAt", "3000");
    assert.fieldEquals("Oracle", ORACLE_ONE, "removedAt", "null");
    assert.fieldEquals("Oracle", ORACLE_ONE, "updatedAt", "3000");
  });

  test("a grant or revoke of any other role is ignored", () => {
    handleRoleGranted(
      createRoleGrantedEvent(
        Bytes.fromHexString(OTHER_ROLE),
        Address.fromString(ORACLE_ONE),
        Address.fromString(OWNER),
        1
      )
    );
    assert.entityCount("Oracle", 0);
    assert.entityCount("OracleChange", 0);

    grant(ORACLE_ONE, 2);
    handleRoleRevoked(
      createRoleRevokedEvent(
        Bytes.fromHexString(OTHER_ROLE),
        Address.fromString(ORACLE_ONE),
        Address.fromString(OWNER),
        3
      )
    );
    assert.fieldEquals("Oracle", ORACLE_ONE, "active", "true");
    assert.entityCount("OracleChange", 1);
  });

  test("a revoke for an address never seen as an oracle creates no oracle record", () => {
    let id = revoke(ORACLE_ONE, OWNER, 1);

    assert.entityCount("Oracle", 0);
    // The event did happen on chain, so the history keeps it.
    assert.fieldEquals("OracleChange", id, "kind", "REMOVED");

    // Added again later, the address gets its record like any other oracle.
    grant(ORACLE_ONE, 2);
    assert.entityCount("Oracle", 1);
    assert.fieldEquals("Oracle", ORACLE_ONE, "active", "true");
    assert.fieldEquals("Oracle", ORACLE_ONE, "removedAt", "null");
  });
});

describe("Oracle set — the history of changes", () => {
  afterEach(() => {
    clearStore();
  });

  test("each grant and each revoke is one record naming the oracle and who did it", () => {
    let added = grant(ORACLE_ONE, 1);
    // An oracle can give up its own role: the sender is then the oracle itself.
    let removed = revoke(ORACLE_ONE, ORACLE_ONE, 2);

    assert.entityCount("OracleChange", 2);
    assert.fieldEquals("OracleChange", added, "kind", "ADDED");
    assert.fieldEquals("OracleChange", added, "oracle", ORACLE_ONE);
    assert.fieldEquals("OracleChange", added, "caller", OWNER);
    assert.fieldEquals("OracleChange", removed, "kind", "REMOVED");
    assert.fieldEquals("OracleChange", removed, "oracle", ORACLE_ONE);
    assert.fieldEquals("OracleChange", removed, "caller", ORACLE_ONE);
    // A role record is not a key record.
    assert.fieldEquals("OracleChange", added, "previousKey", "null");
    assert.fieldEquals("OracleChange", added, "newKey", "null");
    assert.fieldEquals("OracleChange", removed, "newKey", "null");
  });

  test("a role record keeps the caller the event names and the transaction's sender apart", () => {
    // Under a multisig owner the caller is the multisig and the transaction's sender is the
    // account that executed it. The mock event's transaction sender is not OWNER.
    let event = createRoleGrantedEvent(
      Bytes.fromHexString(ORACLE_ROLE),
      Address.fromString(ORACLE_ONE),
      Address.fromString(OWNER),
      1
    );
    handleRoleGranted(event);
    let id = event.transaction.hash.toHexString() + "-1";

    assert.assertTrue(event.transaction.from.toHexString() != OWNER);
    assert.fieldEquals("OracleChange", id, "caller", OWNER);
    assert.fieldEquals(
      "OracleChange",
      id,
      "txFrom",
      event.transaction.from.toHexString()
    );
  });

  test("a record carries the block, the time and the transaction", () => {
    let event = createRoleGrantedEvent(
      Bytes.fromHexString(ORACLE_ROLE),
      Address.fromString(ORACLE_ONE),
      Address.fromString(OWNER),
      1
    );
    event.block.number = BigInt.fromI32(1234);
    event.block.timestamp = BigInt.fromI32(1700000000);
    handleRoleGranted(event);
    let id = event.transaction.hash.toHexString() + "-1";

    assert.fieldEquals("OracleChange", id, "blockNumber", "1234");
    assert.fieldEquals("OracleChange", id, "timestamp", "1700000000");
    assert.fieldEquals(
      "OracleChange",
      id,
      "txHash",
      event.transaction.hash.toHexString()
    );
    assert.fieldEquals("Oracle", ORACLE_ONE, "addedAt", "1700000000");
  });
});

describe("Oracle encryption key — the key clients encrypt to", () => {
  afterEach(() => {
    clearStore();
  });

  test("the published key is the current key on ProtocolConfig", () => {
    handleOracleEncryptionKeyUpdated(
      createOracleEncryptionKeyUpdatedEvent(Bytes.fromHexString(KEY_ONE), 1)
    );

    assert.entityCount("ProtocolConfig", 1);
    assert.fieldEquals(
      "ProtocolConfig",
      SINGLETON_ID,
      "oracleEncryptionKey",
      KEY_ONE
    );
  });

  test("a second publication replaces the current key and the history keeps both", () => {
    let first = createOracleEncryptionKeyUpdatedEvent(
      Bytes.fromHexString(KEY_ONE),
      1
    );
    handleOracleEncryptionKeyUpdated(first);
    let second = createOracleEncryptionKeyUpdatedEvent(
      Bytes.fromHexString(KEY_TWO),
      2
    );
    handleOracleEncryptionKeyUpdated(second);
    let firstId = first.transaction.hash.toHexString() + "-1";
    let secondId = second.transaction.hash.toHexString() + "-2";

    assert.fieldEquals(
      "ProtocolConfig",
      SINGLETON_ID,
      "oracleEncryptionKey",
      KEY_TWO
    );
    assert.entityCount("OracleChange", 2);
    assert.fieldEquals("OracleChange", firstId, "kind", "ENCRYPTION_KEY");
    assert.fieldEquals("OracleChange", firstId, "newKey", KEY_ONE);
    assert.fieldEquals("OracleChange", firstId, "previousKey", "null");
    assert.fieldEquals("OracleChange", secondId, "newKey", KEY_TWO);
    assert.fieldEquals("OracleChange", secondId, "previousKey", KEY_ONE);
    // The key event names no caller, so the record has only the transaction's sender.
    assert.fieldEquals("OracleChange", secondId, "caller", "null");
    assert.fieldEquals("OracleChange", secondId, "oracle", "null");
    assert.fieldEquals(
      "OracleChange",
      secondId,
      "txFrom",
      second.transaction.from.toHexString()
    );
  });
});
