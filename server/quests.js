import crypto from "node:crypto";
import { loadDoc, saveDoc } from "./store.js";
import { solBalance, tokenBalance, interactedWithProgram } from "./sources/solana.js";

// ---- Quests (Ansem's ask, on Market Bubble rails) ----
// Verifiable on-chain actions → Bubbles + AIRDROP WEIGHT. Members link a wallet
// they PROVE they own (signature, checked in the route); the hub reads the chain
// (read-only) and marks quests done. The output is the operator's airdrop
// roster — ranked weights + verified receive addresses. The show sends tokens
// from ITS OWN wallet; this system never custodies or moves anything.
//
// Quest types:
//   hold      — hold ≥ minAmount of a mint (or native SOL) for `days` distinct
//               check-days in a row ("bonuses for longer hold times")
//   interact  — any transaction touching `programId` since the quest started
//               ("quests for holders to interact with different protocols")
//   manual    — operator-awarded (IRL activations, quality posts)

const QUESTS_FILE = new URL("./.mb-quests.json", import.meta.url);

let quests = Object.create(null); // id -> quest def
let members = Object.create(null); // mbKey -> { name, source, wallet, progress, weight, lastEvalAt }
let dirty = false;

export async function loadQuests() {
  const raw = await loadDoc("mb:quests", QUESTS_FILE);
  if (raw && typeof raw === "object") {
    if (raw.quests) quests = raw.quests;
    if (raw.members) members = raw.members;
  }
}
export function flushQuests() {
  if (!dirty) return;
  dirty = false;
  saveDoc("mb:quests", QUESTS_FILE, { quests, members, savedAt: Date.now() }).catch((e) => {
    dirty = true;
    console.warn("[quests] save failed:", e.message);
  });
}

const num = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

// ---- quest defs (operator) ----
const TYPES = ["hold", "interact", "manual"];
export function upsertQuest(q = {}) {
  const id = q.id && quests[q.id] ? q.id : crypto.randomBytes(5).toString("hex");
  const prev = quests[id] || {};
  const quest = {
    id,
    type: TYPES.includes(q.type) ? q.type : prev.type || "manual",
    title: String(q.title ?? prev.title ?? "").slice(0, 120),
    desc: String(q.desc ?? prev.desc ?? "").slice(0, 400),
    // hold params — mint empty = native SOL
    mint: String(q.mint ?? prev.mint ?? "").slice(0, 50) || null,
    minAmount: num(q.minAmount ?? prev.minAmount, 0),
    days: Math.max(1, Math.round(num(q.days ?? prev.days, 1))),
    // interact params
    programId: String(q.programId ?? prev.programId ?? "").slice(0, 50) || null,
    protocol: String(q.protocol ?? prev.protocol ?? "").slice(0, 60),
    // where to DO the quest (e.g. Bullpen with the show's ref) — https only
    link: /^https:\/\//.test(String(q.link ?? prev.link ?? "")) ? String(q.link ?? prev.link).slice(0, 300) : null,
    // rewards
    reward: Math.round(num(q.reward ?? prev.reward, 500)), // Bubbles
    weight: num(q.weight ?? prev.weight, 1), // airdrop weight
    active: q.active != null ? !!q.active : prev.active !== false,
    createdAt: prev.createdAt || Date.now(),
  };
  if (!quest.title) return { ok: false, error: "Quest needs a title." };
  if (quest.type === "interact" && !quest.programId) return { ok: false, error: "Interact quests need a program id." };
  quests[id] = quest;
  dirty = true;
  return { ok: true, quest };
}
export function deleteQuest(id) {
  if (!quests[id]) return false;
  delete quests[id];
  dirty = true;
  return true;
}
export function listQuests({ activeOnly = true } = {}) {
  return Object.values(quests)
    .filter((q) => !activeOnly || q.active)
    .sort((a, b) => a.createdAt - b.createdAt);
}

// ---- member wallet + progress ----
function memberRec(mbKey, { name, source } = {}) {
  const m = members[mbKey] || (members[mbKey] = { wallet: null, progress: {}, weight: 0 });
  if (name) m.name = name;
  if (source) m.source = source;
  return m;
}

// Called by the route AFTER identity proof + (optionally) signature verification.
export function setQuestWallet(mbKey, { name, source, address, verified }) {
  const m = memberRec(mbKey, { name, source });
  // switching address resets on-chain progress (fresh streaks for a fresh wallet)
  if (m.wallet?.address && m.wallet.address !== address) m.progress = {};
  m.wallet = { address, verified: !!verified, verifiedAt: verified ? Date.now() : null };
  dirty = true;
  return m.wallet;
}

export function questStateFor(mbKey) {
  const m = members[mbKey];
  return {
    wallet: m?.wallet ?? null,
    weight: m?.weight ?? 0,
    progress: m?.progress ?? {},
  };
}

const dayStr = (ts) => new Date(ts).toISOString().slice(0, 10);

// Evaluate every active quest for one member. Returns Bubble awards to credit.
// RPC failures leave progress untouched (retried next sweep).
export async function evaluateMember(mbKey, { force = false } = {}) {
  const m = members[mbKey];
  if (!m?.wallet?.verified) return [];
  if (!force && m.lastEvalAt && Date.now() - m.lastEvalAt < 5 * 60000) return [];
  m.lastEvalAt = Date.now();
  const awards = [];

  for (const q of listQuests()) {
    if (q.type === "manual") continue;
    const p = (m.progress[q.id] = m.progress[q.id] || { status: "open", streakDays: 0, lastCheckDay: "" });
    if (p.status === "done") continue;
    try {
      if (q.type === "hold") {
        const bal = q.mint ? await tokenBalance(m.wallet.address, q.mint) : await solBalance(m.wallet.address);
        p.lastBalance = bal;
        const today = dayStr(Date.now());
        if (bal >= q.minAmount) {
          if (p.lastCheckDay !== today) {
            // consecutive if the last qualifying day was yesterday (or first day)
            const yesterday = dayStr(Date.now() - 86400e3);
            p.streakDays = p.lastCheckDay === yesterday ? p.streakDays + 1 : 1;
            p.lastCheckDay = today;
          }
        } else {
          p.streakDays = 0;
          p.lastCheckDay = "";
        }
        if (p.streakDays >= q.days) markDone(m, q, p, awards, mbKey);
      } else if (q.type === "interact") {
        const hit = await interactedWithProgram(m.wallet.address, q.programId, q.createdAt);
        if (hit) markDone(m, q, p, awards, mbKey);
      }
      dirty = true;
    } catch {
      // chain read failed — leave for the next sweep
    }
  }
  return awards;
}

function markDone(m, q, p, awards, mbKey) {
  p.status = "done";
  p.doneAt = Date.now();
  m.weight = (m.weight || 0) + q.weight;
  awards.push({ key: mbKey, source: m.source || "", name: m.name || mbKey, amount: q.reward });
}

// Operator hand-award (IRL activations / quality posts / tool builders).
export function awardManualQuest(mbKey, questId, { name, source } = {}) {
  const q = quests[questId];
  if (!q) return { ok: false, error: "quest not found" };
  const m = memberRec(mbKey, { name, source });
  const p = (m.progress[questId] = m.progress[questId] || { status: "open" });
  if (p.status === "done") return { ok: false, error: "already awarded" };
  const awards = [];
  markDone(m, q, p, awards, mbKey);
  dirty = true;
  return { ok: true, award: awards[0] };
}

// The whole point: the ranked airdrop roster. The operator exports this and
// sends from the show's own public wallet.
export function questRoster() {
  return Object.entries(members)
    .filter(([, m]) => m.wallet?.address && (m.weight > 0 || m.wallet.verified))
    .map(([key, m]) => ({
      key,
      name: m.name || key,
      source: m.source || "",
      wallet: m.wallet.address,
      verified: !!m.wallet.verified,
      weight: m.weight || 0,
      done: Object.entries(m.progress || {})
        .filter(([, p]) => p.status === "done")
        .map(([qid]) => quests[qid]?.title || qid),
    }))
    .sort((a, b) => b.weight - a.weight);
}

// Members the sweep should evaluate (verified wallet + something left to do).
export function membersForSweep() {
  const activeIds = listQuests().filter((q) => q.type !== "manual").map((q) => q.id);
  if (!activeIds.length) return [];
  return Object.entries(members)
    .filter(([, m]) => m.wallet?.verified && activeIds.some((id) => m.progress?.[id]?.status !== "done"))
    .map(([key]) => key);
}
