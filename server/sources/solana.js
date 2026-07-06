import crypto from "node:crypto";

// ---- Solana reads + wallet-signature verification (Quests) ----
// READ-ONLY chain access via JSON-RPC (free public endpoint; override with
// SOLANA_RPC for a Helius/Triton key when volume demands). The hub never holds
// keys and never moves funds — it reads balances/activity and verifies that a
// member really owns the address they linked (an ed25519 message signature from
// their wallet, e.g. Phantom's signMessage — a signature, not a transaction).

const RPC = process.env.SOLANA_RPC || "https://api.mainnet-beta.solana.com";

async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`rpc ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(j.error.message || "rpc error");
  return j.result;
}

// --- base58 (Solana addresses/signatures) — tiny, no deps ---
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const B58_MAP = Object.fromEntries([...B58].map((c, i) => [c, i]));
export function base58Decode(s) {
  let bytes = [0];
  for (const c of String(s)) {
    const v = B58_MAP[c];
    if (v === undefined) throw new Error("bad base58");
    let carry = v;
    for (let i = 0; i < bytes.length; i++) {
      const x = bytes[i] * 58 + carry;
      bytes[i] = x & 0xff;
      carry = x >> 8;
    }
    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const c of String(s)) {
    if (c !== "1") break;
    bytes.push(0);
  }
  return Buffer.from(bytes.reverse());
}
export function base58Encode(buf) {
  let digits = [0];
  for (const byte of buf) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      const x = (digits[i] << 8) + carry;
      digits[i] = x % 58;
      carry = Math.floor(x / 58);
    }
    while (carry) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  for (const byte of buf) {
    if (byte !== 0) break;
    digits.push(0);
  }
  return digits.reverse().map((d) => B58[d]).join("");
}

export function isSolAddress(s) {
  try {
    return base58Decode(String(s)).length === 32;
  } catch {
    return false;
  }
}

// Verify an ed25519 message signature against a Solana address (its pubkey).
// signature: base58 or base64. Uses node:crypto only (raw key via SPKI DER).
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
export function verifyWalletSignature(address, message, signature) {
  try {
    const pub = base58Decode(address);
    if (pub.length !== 32) return false;
    let sig;
    try {
      sig = base58Decode(signature);
    } catch {
      sig = Buffer.from(String(signature), "base64");
    }
    if (sig.length !== 64) {
      sig = Buffer.from(String(signature), "base64");
      if (sig.length !== 64) return false;
    }
    const key = crypto.createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, pub]),
      format: "der",
      type: "spki",
    });
    return crypto.verify(null, Buffer.from(String(message), "utf8"), key, sig);
  } catch {
    return false;
  }
}

// --- chain reads (all read-only) ---

// Native SOL balance (lamports → SOL).
export async function solBalance(address) {
  const r = await rpc("getBalance", [address, { commitment: "confirmed" }]);
  return (r?.value ?? 0) / 1e9;
}

// SPL token balance for a mint held by this owner (summed across accounts).
export async function tokenBalance(address, mint) {
  const r = await rpc("getTokenAccountsByOwner", [
    address,
    { mint },
    { encoding: "jsonParsed", commitment: "confirmed" },
  ]);
  let total = 0;
  for (const acc of r?.value ?? []) {
    total += Number(acc?.account?.data?.parsed?.info?.tokenAmount?.uiAmount || 0);
  }
  return total;
}

// Did this wallet interact with `programId` since `sinceTs`? Reads the wallet's
// recent signatures and inspects transactions for the program (capped so a
// check costs a bounded number of RPC calls on the free endpoint).
export async function interactedWithProgram(address, programId, sinceTs, { maxTx = 20 } = {}) {
  const sigs = await rpc("getSignaturesForAddress", [address, { limit: 50 }]);
  const candidates = (sigs ?? [])
    .filter((s) => !s.err && (!sinceTs || (s.blockTime || 0) * 1000 >= sinceTs))
    .slice(0, maxTx);
  for (const s of candidates) {
    try {
      const tx = await rpc("getTransaction", [
        s.signature,
        { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "confirmed" },
      ]);
      const keys = tx?.transaction?.message?.accountKeys ?? [];
      if (keys.some((k) => (typeof k === "string" ? k : k?.pubkey) === programId)) return true;
      const instr = tx?.transaction?.message?.instructions ?? [];
      if (instr.some((i) => i?.programId === programId)) return true;
    } catch {
      // one bad tx read shouldn't kill the check
    }
  }
  return false;
}
