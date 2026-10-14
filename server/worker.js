// Global leaderboard for Volya: Dice & Chain Defense.
// Cloudflare Worker + D1. Scores are only accepted with a valid Telegram
// Mini App signature (initData), so a player's name and id come from Telegram,
// never from the client.
//
//   GET  /top?limit=50&uid=<telegram id>  -> { top: [...], total, me }
//   POST /score { initData, score, wave, kills, duration, hero } -> { best, rank, total, improved }
//   GET  /teams                            -> this week's team war: { week, endsIn, teams: [{ hero, total, players }] }
//   POST /daily { initData, day, score, hero } / GET /daily?day=&uid= -> daily challenge board
//   POST /invoice { initData, product }    -> { link } (Telegram Stars invoice)
//   POST /claim { initData }               -> { products: [...] } paid purchases not yet delivered
//   POST /tg-webhook                       -> Telegram bot updates (payments, /start)
//   POST /ping { initData, write? }        -> remembers the player for reminders -> { refs }
//   POST /ref { initData, ref }            -> credits an invite (both players get gold; 5 invites = a hero)
//   GET  /raid?uid= / POST /raid { initData, damage, duration } -> weekend World Boss shared by everyone
//   cron (scheduled)                        -> daily reminder message to players who allowed it
//   GET  /  (anything else)                -> the game (static assets in ./public)

const MAX_AUTH_AGE = 24 * 60 * 60; // seconds an initData signature stays valid
const MIN_SUBMIT_GAP = 3;          // seconds between two submissions from one player
const MAX_SCORE = 50_000_000;
const MAX_DAILY = 2_000_000;
const HEROES = ["volya", "pinkbull", "babyshark", "notcoin", "gramcat", "pengu", "teddy", "virus", "utya", "egor", "tgdog", "yoda", "memegram", "paws", "yaya", "noctis"];
// Telegram Stars products. Gold and boosters are delivered by the game after /claim.
export const PRODUCTS = {
  gold_s: { stars: 50, title: "600 Gold", description: "A pouch of 600 gold for boosters and continues." },
  gold_m: { stars: 150, title: "2,000 Gold", description: "A chest of 2,000 gold for boosters and continues." },
  gold_l: { stars: 400, title: "6,000 Gold", description: "A treasure of 6,000 gold for boosters and continues." },
  boosts: { stars: 100, title: "Booster pack", description: "5 rocket, 5 extra-moves and 5 shield boosters." },
  pass: { stars: 300, title: "Season Pass Premium", description: "Unlocks the premium track of the current season pass." },
  ...Object.fromEntries(HEROES.slice(1).map((h) => [`hero_${h}`, { stars: 75, title: "Unlock hero", description: `Unlock the ${h} hero right away.` }]))
};
const nowSec = () => Math.floor(Date.now() / 1000);
const weekOf = (sec) => Math.floor((sec / 86400 + 3) / 7);   // weeks start on Monday 00:00 UTC
const dayOf = (sec) => Math.floor(sec / 86400);
const REF_LIMIT_HERO = 5;
// World Boss: open Friday 00:00 UTC until Monday 00:00 UTC
function raidWindow(env, now) {
  const into = now - (weekOf(now) * 7 - 3) * 86400, day = Math.floor(into / 86400);
  const open = env.RAID_ALWAYS === "1" || day >= 4;
  return { week: weekOf(now), open, opensIn: open ? 0 : 4 * 86400 - into, endsIn: 7 * 86400 - into, maxHp: Number(env.RAID_HP) || 3_000_000 };
}

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
      if (url.pathname === "/teams" && req.method === "GET") return json(await teams(env), cors);
      if (url.pathname === "/daily" && req.method === "POST") return json(await submitDaily(env, await readJson(req)), cors);
      if (url.pathname === "/daily" && req.method === "GET") return json(await topDaily(env, url), cors);
      if (url.pathname === "/invoice" && req.method === "POST") return json(await invoice(env, await readJson(req)), cors);
      if (url.pathname === "/claim" && req.method === "POST") return json(await claim(env, await readJson(req)), cors);
      if (url.pathname === "/tg-webhook" && req.method === "POST") return await webhook(env, req);
      if (url.pathname === "/ping" && req.method === "POST") return json(await ping(env, await readJson(req)), cors);
      if (url.pathname === "/ref" && req.method === "POST") return json(await referral(env, await readJson(req)), cors);
      if (url.pathname === "/raid" && req.method === "GET") return json(await raidStatus(env, int(url.searchParams.get("uid"))), cors);
      if (url.pathname === "/raid" && req.method === "POST") return json(await raidHit(env, await readJson(req)), cors);
      // Everything else is the game itself (static files deployed with the Worker).
      if (env.ASSETS && (req.method === "GET" || req.method === "HEAD")) return env.ASSETS.fetch(req);
      return json({ error: "not_found" }, cors, 404);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, cors, e.status);
      console.error(e);
      return json({ error: "server_error" }, cors, 500);
    }
  },
  async scheduled(event, env, ctx) { ctx.waitUntil(remind(env)); }
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

  // team war: each player's best run of the week counts for the hero they played
  const hero = HEROES.includes(body.hero) ? body.hero : "volya";
  await env.DB.prepare(
    `INSERT INTO team_scores (week, user_id, hero, best) VALUES (?, ?, ?, ?)
     ON CONFLICT(week, user_id, hero) DO UPDATE SET best = MAX(team_scores.best, excluded.best)`
  ).bind(weekOf(now), user.id, hero, score).run();

  const best = Math.max(score, prev ? prev.best : 0);
  return { best, rank: await rankOf(env, best), total: await total(env), improved: !prev || score > prev.best };
}

async function teams(env) {
  const now = nowSec(), week = weekOf(now);
  const rows = await env.DB.prepare(
    "SELECT hero, SUM(best) AS total, COUNT(DISTINCT user_id) AS players FROM team_scores WHERE week = ? GROUP BY hero ORDER BY total DESC"
  ).bind(week).all();
  return { week, endsIn: (week + 1) * 7 * 86400 - 3 * 86400 - now, teams: rows.results || [] };
}

async function submitDaily(env, body) {
  const user = await verifyInitData(body && body.initData, env.BOT_TOKEN);
  const day = int(body.day), score = int(body.score), now = nowSec();
  if (!Number.isInteger(day) || Math.abs(day - dayOf(now)) > 1) throw new HttpError(400, "bad_day");
  if (!Number.isInteger(score) || score < 0 || score > MAX_DAILY) throw new HttpError(422, "implausible");
  const prev = await env.DB.prepare("SELECT best, updated_at FROM daily_scores WHERE day = ? AND user_id = ?").bind(day, user.id).first();
  if (prev && now - prev.updated_at < MIN_SUBMIT_GAP) throw new HttpError(429, "too_fast");
  const hero = HEROES.includes(body.hero) ? body.hero : "volya";
  await env.DB.prepare(
    `INSERT INTO daily_scores (day, user_id, name, hero, best, updated_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(day, user_id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at,
       hero = CASE WHEN excluded.best > daily_scores.best THEN excluded.hero ELSE daily_scores.hero END,
       best = MAX(daily_scores.best, excluded.best)`
  ).bind(day, user.id, displayName(user), hero, score, now).run();
  const best = Math.max(score, prev ? prev.best : 0);
  const higher = await env.DB.prepare("SELECT COUNT(*) AS c FROM daily_scores WHERE day = ? AND best > ?").bind(day, best).first();
  return { best, rank: (higher ? higher.c : 0) + 1 };
}

async function topDaily(env, url) {
  const day = int(url.searchParams.get("day"));
  if (!Number.isInteger(day)) throw new HttpError(400, "bad_day");
  const uid = int(url.searchParams.get("uid"));
  const rows = await env.DB.prepare("SELECT user_id, name, hero, best FROM daily_scores WHERE day = ? ORDER BY best DESC, updated_at ASC LIMIT 50").bind(day).all();
  const list = (rows.results || []).map((r, i) => ({ rank: i + 1, name: r.name, hero: r.hero, best: r.best, you: r.user_id === uid || undefined }));
  const cnt = await env.DB.prepare("SELECT COUNT(*) AS c FROM daily_scores WHERE day = ?").bind(day).first();
  let me = null;
  if (Number.isSafeInteger(uid)) {
    const row = await env.DB.prepare("SELECT best FROM daily_scores WHERE day = ? AND user_id = ?").bind(day, uid).first();
    if (row) {
      const higher = await env.DB.prepare("SELECT COUNT(*) AS c FROM daily_scores WHERE day = ? AND best > ?").bind(day, row.best).first();
      me = { best: row.best, rank: (higher ? higher.c : 0) + 1 };
    }
  }
  return { day, top: list, total: cnt ? cnt.c : 0, me };
}

// ---- Telegram Stars ----------------------------------------------------
async function tgApi(env, method, payload) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => null);
  if (!data || !data.ok) throw new HttpError(502, "telegram_error");
  return data.result;
}

async function invoice(env, body) {
  const user = await verifyInitData(body && body.initData, env.BOT_TOKEN);
  const product = String((body && body.product) || "");
  const p = PRODUCTS[product];
  if (!p) throw new HttpError(400, "bad_product");
  const nonce = crypto.randomUUID().slice(0, 8);
  const link = await tgApi(env, "createInvoiceLink", {
    title: p.title, description: p.description, payload: `${user.id}|${product}|${nonce}`,
    currency: "XTR", prices: [{ label: p.title, amount: p.stars }]
  });
  return { link };
}

// Paid purchases are stored by the webhook; the game collects them here exactly once.
async function claim(env, body) {
  const user = await verifyInitData(body && body.initData, env.BOT_TOKEN);
  const rows = await env.DB.prepare("SELECT charge_id, product FROM purchases WHERE user_id = ? AND claimed = 0").bind(user.id).all();
  const list = rows.results || [];
  for (const r of list) await env.DB.prepare("UPDATE purchases SET claimed = 1 WHERE charge_id = ?").bind(r.charge_id).run();
  const products = list.map((r) => r.product);
  const raids = await env.DB.prepare(
    "SELECT h.week FROM raid_hits h JOIN raid_state s ON s.week = h.week WHERE h.user_id = ? AND h.claimed = 0 AND h.damage > 0 AND s.defeated_at IS NOT NULL"
  ).bind(user.id).all();
  for (const r of raids.results || []) {
    await env.DB.prepare("UPDATE raid_hits SET claimed = 1 WHERE week = ? AND user_id = ?").bind(r.week, user.id).run();
    products.push("raid_reward");
  }
  return { products };
}

async function webhook(env, req) {
  const ok = () => new Response("ok");
  if (!env.WEBHOOK_SECRET || req.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) return new Response("forbidden", { status: 403 });
  const upd = await req.json().catch(() => null);
  if (!upd) return ok();
  if (upd.pre_checkout_query) {
    const q = upd.pre_checkout_query, [uid, product] = String(q.invoice_payload || "").split("|");
    const p = PRODUCTS[product];
    const valid = p && Number(uid) === q.from.id && q.currency === "XTR" && q.total_amount === p.stars;
    await tgApi(env, "answerPreCheckoutQuery", valid ? { pre_checkout_query_id: q.id, ok: true } : { pre_checkout_query_id: q.id, ok: false, error_message: "This item is not available." });
    return ok();
  }
  const msg = upd.message;
  if (msg && msg.successful_payment) {
    const sp = msg.successful_payment, [, product] = String(sp.invoice_payload || "").split("|");
    if (PRODUCTS[product]) {
      await env.DB.prepare("INSERT OR IGNORE INTO purchases (charge_id, user_id, product, stars, claimed, created_at) VALUES (?, ?, ?, ?, 0, ?)")
        .bind(sp.telegram_payment_charge_id, msg.from.id, product, sp.total_amount, nowSec()).run();
    }
    return ok();
  }
  if (msg && typeof msg.text === "string" && msg.text.startsWith("/start") && env.GAME_URL) {
    // pass the deep-link payload (ref_…, h_…) on to the game
    if (msg.from) await touchUser(env, msg.from, true);
    const param = msg.text.split(" ")[1] || "";
    const safe = /^[A-Za-z0-9_-]{1,64}$/.test(param) ? param : "";
    const url = env.GAME_URL + (safe ? (env.GAME_URL.includes("?") ? "&" : "?") + "startapp=" + safe : "");
    await tgApi(env, "sendMessage", {
      chat_id: msg.chat.id,
      text: "💎 Volya Gem Defense\nMatch gems, blast monsters and lead your team to the top!",
      reply_markup: { inline_keyboard: [[{ text: "🎮 Play", web_app: { url } }]] }
    }).catch(() => {});
  }
  return ok();
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


// ---- Players, invites, World Boss, reminders ------------------------------
async function touchUser(env, user, write) {
  const now = nowSec();
  await env.DB.prepare(
    `INSERT INTO users (user_id, name, lang, first_seen, last_seen, can_write, refs) VALUES (?, ?, ?, ?, ?, ?, 0)
     ON CONFLICT(user_id) DO UPDATE SET name = excluded.name, lang = excluded.lang, last_seen = excluded.last_seen,
       can_write = CASE WHEN excluded.can_write = 1 THEN 1 ELSE users.can_write END`
  ).bind(user.id, displayName(user), user.language_code || null, now, now, write ? 1 : 0).run();
}

async function ping(env, body) {
  const user = await verifyInitData(body && body.initData, env.BOT_TOKEN);
  await touchUser(env, user, !!(body && body.write));
  const row = await env.DB.prepare("SELECT refs FROM users WHERE user_id = ?").bind(user.id).first();
  return { refs: row ? row.refs : 0 };
}

const grant = (env, chargeId, userId, product) =>
  env.DB.prepare("INSERT OR IGNORE INTO purchases (charge_id, user_id, product, stars, claimed, created_at) VALUES (?, ?, ?, 0, 0, ?)").bind(chargeId, userId, product, nowSec()).run();

// An invite counts once, only for a brand-new player who arrived through someone else's link.
async function referral(env, body) {
  const user = await verifyInitData(body && body.initData, env.BOT_TOKEN);
  const inviter = int(body && body.ref), now = nowSec();
  if (!Number.isSafeInteger(inviter) || inviter === user.id) throw new HttpError(400, "bad_ref");
  const known = await env.DB.prepare("SELECT user_id FROM users WHERE user_id = ?").bind(inviter).first();
  if (!known) throw new HttpError(404, "unknown_inviter");
  const me = await env.DB.prepare("SELECT first_seen FROM users WHERE user_id = ?").bind(user.id).first();
  if (me && now - me.first_seen > 2 * 3600) return { ok: false, reason: "not_new" };
  const dup = await env.DB.prepare("SELECT invitee FROM referrals WHERE invitee = ?").bind(user.id).first();
  if (dup) return { ok: false, reason: "already" };
  await touchUser(env, user, false);
  await env.DB.prepare("INSERT INTO referrals (invitee, inviter, created_at) VALUES (?, ?, ?)").bind(user.id, inviter, now).run();
  await env.DB.prepare("UPDATE users SET refs = refs + 1 WHERE user_id = ?").bind(inviter).run();
  await grant(env, `refin:${user.id}`, user.id, "ref_bonus");
  await grant(env, `refout:${user.id}`, inviter, "ref_bonus");
  const row = await env.DB.prepare("SELECT refs FROM users WHERE user_id = ?").bind(inviter).first();
  if (row && row.refs === REF_LIMIT_HERO) await grant(env, `refhero:${inviter}`, inviter, "ref_hero");
  return { ok: true };
}

async function raidStatus(env, uid) {
  const now = nowSec(), w = raidWindow(env, now);
  const tot = await env.DB.prepare("SELECT COALESCE(SUM(damage), 0) AS dmg, COUNT(*) AS players FROM raid_hits WHERE week = ? AND damage > 0").bind(w.week).first();
  let mine = 0;
  if (Number.isSafeInteger(uid)) {
    const row = await env.DB.prepare("SELECT damage FROM raid_hits WHERE week = ? AND user_id = ?").bind(w.week, uid).first();
    mine = row ? row.damage : 0;
  }
  const dmg = tot ? tot.dmg : 0;
  return { open: w.open, opensIn: w.opensIn, endsIn: w.endsIn, maxHp: w.maxHp, hp: Math.max(0, w.maxHp - dmg), players: tot ? tot.players : 0, mine, defeated: dmg >= w.maxHp };
}

async function raidHit(env, body) {
  const user = await verifyInitData(body && body.initData, env.BOT_TOKEN);
  const now = nowSec(), w = raidWindow(env, now);
  if (!w.open) throw new HttpError(409, "raid_closed");
  const damage = int(body.damage), duration = int(body.duration);
  if (![damage, duration].every((n) => Number.isInteger(n) && n >= 0) || duration > 600 || damage > 1000 + duration * 4000) throw new HttpError(422, "implausible");
  const prev = await env.DB.prepare("SELECT updated_at FROM raid_hits WHERE week = ? AND user_id = ?").bind(w.week, user.id).first();
  if (prev && now - prev.updated_at < 5) throw new HttpError(429, "too_fast");
  await env.DB.prepare(
    `INSERT INTO raid_hits (week, user_id, damage, updated_at, claimed) VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(week, user_id) DO UPDATE SET damage = raid_hits.damage + excluded.damage, updated_at = excluded.updated_at`
  ).bind(w.week, user.id, damage, now).run();
  const st = await raidStatus(env, user.id);
  if (st.defeated) await env.DB.prepare("INSERT OR IGNORE INTO raid_state (week, defeated_at) VALUES (?, ?)").bind(w.week, now).run();
  return st;
}

// Reminder texts: [daily, World Boss weekend]
const REMIND = {
  en: ["🎡 Your free spin and daily reward are waiting! Come back and play 💎", "👹 The World Boss is here! Join players everywhere and take it down ⚔️"],
  fa: ["🎡 چرخش رایگان و پاداش روزانه‌ات منتظرت است! برگرد و بازی کن 💎", "👹 غول جهانی آمده! با بازیکنان سراسر دنیا شکستش بده ⚔️"],
  ar: ["🎡 دورتك المجانية ومكافأتك اليومية بانتظارك! عد والعب 💎", "👹 الزعيم العالمي هنا! انضم للاعبين حول العالم واهزمه ⚔️"],
  ru: ["🎡 Тебя ждут бесплатное вращение и ежедневная награда! Возвращайся 💎", "👹 Мировой босс уже здесь! Победим его вместе ⚔️"],
  uk: ["🎡 На тебе чекають безкоштовне обертання й щоденна нагорода! Повертайся 💎", "👹 Світовий бос уже тут! Переможімо його разом ⚔️"],
  tr: ["🎡 Ücretsiz çevirme ve günlük ödülün seni bekliyor! Geri gel ve oyna 💎", "👹 Dünya Boss'u geldi! Tüm oyuncularla birlikte onu yen ⚔️"],
  az: ["🎡 Pulsuz fırlatma və gündəlik mükafat səni gözləyir! Qayıt və oyna 💎", "👹 Dünya Bossu gəldi! Hamı ilə birlikdə onu məğlub et ⚔️"],
  uz: ["🎡 Bepul aylantirish va kunlik sovg'a seni kutmoqda! Qayt va o'yna 💎", "👹 Jahon bossi keldi! Hamma bilan birga uni yeng ⚔️"],
  kk: ["🎡 Тегін айналдыру мен күнделікті сыйлық сені күтіп тұр! Қайта орал 💎", "👹 Әлем басы келді! Бәрімен бірге оны жең ⚔️"],
  es: ["🎡 ¡Tu giro gratis y tu recompensa diaria te esperan! Vuelve a jugar 💎", "👹 ¡Llegó el Jefe Mundial! Únete a todos y derrótalo ⚔️"],
  pt: ["🎡 Seu giro grátis e a recompensa diária estão esperando! Volte a jogar 💎", "👹 O Chefão Mundial chegou! Junte-se a todos e derrote-o ⚔️"],
  fr: ["🎡 Ton tour gratuit et ta récompense du jour t'attendent ! Reviens jouer 💎", "👹 Le Boss mondial est là ! Rejoins tout le monde pour l'abattre ⚔️"],
  de: ["🎡 Dein Gratis-Dreh und die Tagesbelohnung warten! Komm zurück 💎", "👹 Der Weltboss ist da! Besiegt ihn gemeinsam ⚔️"],
  it: ["🎡 Il tuo giro gratis e il premio giornaliero ti aspettano! Torna a giocare 💎", "👹 È arrivato il Boss mondiale! Sconfiggilo insieme a tutti ⚔️"],
  nl: ["🎡 Je gratis draai en dagelijkse beloning wachten! Kom terug 💎", "👹 De Wereldbaas is er! Versla hem samen met iedereen ⚔️"],
  pl: ["🎡 Czeka na ciebie darmowy obrót i nagroda dnia! Wracaj do gry 💎", "👹 Boss świata już tu jest! Pokonajmy go razem ⚔️"],
  id: ["🎡 Putaran gratis dan hadiah harianmu menunggu! Ayo main lagi 💎", "👹 Bos Dunia telah datang! Kalahkan bersama semua pemain ⚔️"],
  hi: ["🎡 तुम्हारा मुफ़्त स्पिन और रोज़ का इनाम इंतज़ार कर रहा है! वापस आओ 💎", "👹 विश्व बॉस आ गया! सबके साथ मिलकर उसे हराओ ⚔️"],
  zh: ["🎡 免费转盘和每日奖励在等你！快回来玩 💎", "👹 世界首领来了！和所有玩家一起击败它 ⚔️"],
  ja: ["🎡 無料スピンとデイリー報酬が待ってるよ！ 戻ってきてね 💎", "👹 ワールドボス出現！ みんなで倒そう ⚔️"],
  ko: ["🎡 무료 스핀과 일일 보상이 기다려요! 돌아와서 플레이하세요 💎", "👹 월드 보스 등장! 모두 함께 쓰러뜨려요 ⚔️"],
  vi: ["🎡 Lượt quay miễn phí và quà hằng ngày đang chờ bạn! Quay lại chơi nhé 💎", "👹 Trùm thế giới đã xuất hiện! Cùng mọi người hạ nó ⚔️"]
};
async function remind(env) {
  if (!env.GAME_URL) return 0;
  const now = nowSec(), raid = raidWindow(env, now).open;
  const rows = await env.DB.prepare(
    `SELECT user_id, lang FROM users WHERE can_write = 1 AND last_seen < ? AND last_seen > ?
     AND (last_remind IS NULL OR last_remind < ?) LIMIT 300`
  ).bind(now - 20 * 3600, now - 14 * 86400, now - 20 * 3600).all();
  let sent = 0;
  for (const r of rows.results || []) {
    const lang = String(r.lang || "en").slice(0, 2), t = REMIND[lang] || REMIND.en;
    const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: r.user_id, text: raid ? t[1] : t[0], reply_markup: { inline_keyboard: [[{ text: "🎮 Play", web_app: { url: env.GAME_URL } }]] } })
    }).then((x) => x.json()).catch(() => null);
    if (res && res.ok) sent++;
    // blocked the bot or never opened a chat: stop writing to them
    const gone = res && !res.ok && (res.error_code === 403 || res.error_code === 400);
    await env.DB.prepare(`UPDATE users SET last_remind = ?${gone ? ", can_write = 0" : ""} WHERE user_id = ?`).bind(now, r.user_id).run();
  }
  return sent;
}
export { remind };
