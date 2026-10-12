// Global leaderboard for Volya: Dice & Chain Defense.
// Cloudflare Worker + D1. Scores are only accepted with a valid Telegram
// Mini App signature (initData), so a player's name and id come from Telegram,
// never from the client.
//
//   GET  /top?limit=50&uid=<telegram id>  -> { top: [...], total, me }
//   GET  /  (anything else)                -> the game (static assets in ./public)
//   POST /score { initData, score, wave, kills, duration } -> { best, rank, total, improved }

const MAX_AUTH_AGE = 24 * 60 * 60; // seconds an initData signature stays valid
const MIN_SUBMIT_GAP = 3;          // seconds between two submissions from one player
const MAX_SCORE = 50_000_000;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const cors = {
      "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400"
    };
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    try {
      if (url.pathname === "/top" && req.method === "GET") return json(await top(env, url), cors);
      if (url.pathname === "/score" && req.method === "POST") return json(await submit(env, await readJson(req)), cors);
      // Everything else is the game itself (static files deployed with the Worker).
      if (env.ASSETS && (req.method === "GET" || req.method === "HEAD")) return env.ASSETS.fetch(req);
      return json({ error: "not_found" }, cors, 404);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, cors, e.status);
      console.error(e);
      return json({ error: "server_error" }, cors, 500);
    }
  }
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function json(data, headers, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

async function readJson(req) {
  try { return await req.json(); } catch { throw new HttpError(400, "bad_json"); }
}

// ---- Telegram initData verification ----------------------------------
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
const enc = new TextEncoder();

async function hmac(keyBytes, data) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, data));
}

const toHex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyInitData(initData, botToken, nowSec = Math.floor(Date.now() / 1000)) {
  if (!botToken) throw new HttpError(500, "bot_token_missing");
  if (typeof initData !== "string" || !initData) throw new HttpError(401, "no_auth");
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new HttpError(401, "no_auth");
  params.delete("hash");
  const dataCheck = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = await hmac(enc.encode("WebAppData"), enc.encode(botToken));
  const sig = toHex(await hmac(secret, enc.encode(dataCheck)));
  if (!safeEqual(sig, hash.toLowerCase())) throw new HttpError(401, "bad_auth");
  const authDate = Number(params.get("auth_date"));
  if (!authDate || nowSec - authDate > MAX_AUTH_AGE) throw new HttpError(401, "auth_expired");
  let user;
  try { user = JSON.parse(params.get("user") || ""); } catch { user = null; }
  if (!user || !Number.isSafeInteger(user.id)) throw new HttpError(401, "no_user");
  return user;
}

// ---- Handlers ---------------------------------------------------------
const int = (v) => (Number.isFinite(Number(v)) ? Math.floor(Number(v)) : NaN);

function displayName(user) {
  const full = [user.first_name, user.last_name].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return (full || user.username || "Player").slice(0, 32);
}

async function rankOf(env, best) {
  const higher = await env.DB.prepare("SELECT COUNT(*) AS c FROM scores WHERE best > ?").bind(best).first();
  return (higher ? higher.c : 0) + 1;
}

async function total(env) {
  const row = await env.DB.prepare("SELECT COUNT(*) AS c FROM scores").first();
  return row ? row.c : 0;
}

async function submit(env, body) {
  const user = await verifyInitData(body && body.initData, env.BOT_TOKEN);
  const score = int(body.score), wave = int(body.wave), kills = int(body.kills), duration = int(body.duration);
  if (![score, wave, kills, duration].every((n) => Number.isInteger(n) && n >= 0)) throw new HttpError(400, "bad_fields");
  if (score > MAX_SCORE || wave > 10_000 || kills > 1_000_000 || duration > 24 * 3600) throw new HttpError(422, "implausible");
  // A generous ceiling on points per second of play; anything above it was not earned in the game.
  if (score > 2000 + duration * 500) throw new HttpError(422, "implausible");

  const now = Math.floor(Date.now() / 1000);
  const prev = await env.DB.prepare("SELECT best, updated_at FROM scores WHERE user_id = ?").bind(user.id).first();
  if (prev && now - prev.updated_at < MIN_SUBMIT_GAP) throw new HttpError(429, "too_fast");

  await env.DB.prepare(
    `INSERT INTO scores (user_id, name, username, lang, best, wave, kills, games, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET
       name = excluded.name,
       username = excluded.username,
       lang = excluded.lang,
       games = scores.games + 1,
       updated_at = excluded.updated_at,
       wave  = CASE WHEN excluded.best > scores.best THEN excluded.wave  ELSE scores.wave  END,
       kills = CASE WHEN excluded.best > scores.best THEN excluded.kills ELSE scores.kills END,
       best_at = CASE WHEN excluded.best > scores.best THEN excluded.updated_at ELSE scores.best_at END,
       best  = MAX(scores.best, excluded.best)`
  ).bind(user.id, displayName(user), user.username || null, user.language_code || null, score, wave, kills, now, now).run();

  const best = Math.max(score, prev ? prev.best : 0);
  return { best, rank: await rankOf(env, best), total: await total(env), improved: !prev || score > prev.best };
}

async function top(env, url) {
  const limit = Math.min(100, Math.max(1, int(url.searchParams.get("limit")) || 50));
  const uid = int(url.searchParams.get("uid"));
  const rows = await env.DB.prepare(
    "SELECT user_id, name, best, wave FROM scores ORDER BY best DESC, best_at ASC LIMIT ?"
  ).bind(limit).all();
  let rank = 0, prevBest = null;
  const list = (rows.results || []).map((r, i) => {
    if (r.best !== prevBest) { rank = i + 1; prevBest = r.best; }
    return { rank, name: r.name, best: r.best, wave: r.wave, you: r.user_id === uid || undefined };
  });
  let me = null;
  if (Number.isSafeInteger(uid)) {
    const row = await env.DB.prepare("SELECT best, wave FROM scores WHERE user_id = ?").bind(uid).first();
    if (row) me = { best: row.best, wave: row.wave, rank: await rankOf(env, row.best) };
  }
  return { top: list, total: await total(env), me };
}
