// Polymarket markets (Gamma API) for the live "chat vs the market" prediction
// poll. Public read-only API, no auth. We only feature binary Yes/No markets so
// the chat can vote YES / NO and we can show the room's split next to the real odds.

const GAMMA = "https://gamma-api.polymarket.com";

function parseMarket(m) {
  if (!m) return null;
  let outcomes = m.outcomes;
  let prices = m.outcomePrices;
  try { if (typeof outcomes === "string") outcomes = JSON.parse(outcomes); } catch { outcomes = []; }
  try { if (typeof prices === "string") prices = JSON.parse(prices); } catch { prices = []; }
  return {
    id: String(m.id),
    slug: m.slug || "",
    question: m.question || m.title || "",
    outcomes: Array.isArray(outcomes) ? outcomes : [],
    odds: Array.isArray(prices) ? prices.map(Number) : [],
    volume24hr: Number(m.volume24hr) || 0,
    url: m.slug ? `https://polymarket.com/market/${m.slug}` : undefined,
  };
}

// Only binary Yes/No markets work for a YES/NO chat vote.
function isBinary(mk) {
  return (
    mk &&
    mk.outcomes.length === 2 &&
    mk.outcomes.map((o) => String(o).toLowerCase()).join(",") === "yes,no"
  );
}

async function gfetch(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`Gamma ${r.status}`);
  return r.json();
}

// Search markets for the Studio picker. With a query → text search; without →
// the highest-volume live markets. Binary Yes/No only.
export async function searchMarkets(q, limit = 24) {
  if (q && q.trim()) {
    const d = await gfetch(`${GAMMA}/public-search?q=${encodeURIComponent(q.trim())}&limit_per_type=20`);
    const out = [];
    for (const ev of d.events || [])
      for (const m of ev.markets || []) {
        const mk = parseMarket(m);
        if (isBinary(mk) && mk.question) out.push(mk);
      }
    return out.slice(0, limit);
  }
  const d = await gfetch(
    `${GAMMA}/markets?closed=false&active=true&order=volume24hr&ascending=false&limit=${limit * 2}`
  );
  const list = Array.isArray(d) ? d : d.data || [];
  return list.map(parseMarket).filter(isBinary).slice(0, limit);
}

// Fetch one market by id (used to refresh live odds for the active poll).
export async function getMarket(id) {
  const m = await gfetch(`${GAMMA}/markets/${encodeURIComponent(id)}`);
  return parseMarket(Array.isArray(m) ? m[0] : m);
}
