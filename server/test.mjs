// Local test for worker.js: runs the Worker against an in-memory SQLite database
// standing in for D1, with initData signed exactly the way Telegram signs it.
//   node server/test.mjs
import { DatabaseSync } from "node:sqlite";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import worker, { verifyInitData } from "./worker.js";

const BOT_TOKEN = "123456:TEST-token";
const sqlite = new DatabaseSync(":memory:");
sqlite.exec(readFileSync(new URL("./schema.sql", import.meta.url), "utf8"));

// Minimal D1 shim over node:sqlite
const DB = {
  prepare(sql) {
    let args = [];
    const stmt = sqlite.prepare(sql);
    const api = {
      bind(...a) { args = a; return api; },
      async first() { return stmt.get(...args) ?? null; },
      async all() { return { results: stmt.all(...args) }; },
      async run() { stmt.run(...args); return { success: true }; }
    };
    return api;
  }
};
const env = { DB, BOT_TOKEN, ALLOWED_ORIGIN: "https://himn7980-bot.github.io", WEBHOOK_SECRET: "s3cret", GAME_URL: "https://game.example/" };

// fake Telegram Bot API
const tgCalls = [];
globalThis.fetch = async (url, opts) => {
  const method = String(url).split("/").pop(), body = JSON.parse(opts.body);
  tgCalls.push({ method, body });
  const result = method === "createInvoiceLink" ? "https://t.me/$invoice-" + body.payload : true;
  return new Response(JSON.stringify({ ok: true, result }));
};

function sign(user, authDate = Math.floor(Date.now() / 1000), token = BOT_TOKEN) {
  const fields = { query_id: "AAH" + user.id, user: JSON.stringify(user), auth_date: String(authDate) };
  const dcs = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(dcs).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

const call = async (method, path, body) => {
  const res = await worker.fetch(new Request("https://lb.example" + path, {
    method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined
  }), env);
  return { status: res.status, cors: res.headers.get("Access-Control-Allow-Origin"), data: res.status === 204 ? null : await res.json() };
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const ali = { id: 111, first_name: "Ali", last_name: "Rezaei", username: "ali", language_code: "fa" };
const sara = { id: 222, first_name: "Sara", language_code: "en" };
const kim = { id: 333, first_name: "Kim", language_code: "ko" };

// signature checks
assert.equal((await verifyInitData(sign(ali), BOT_TOKEN)).id, 111);
await assert.rejects(verifyInitData(sign(ali, undefined, "999:other-bot"), BOT_TOKEN), /bad_auth/);
await assert.rejects(verifyInitData(sign(ali).replace("Ali", "Bob"), BOT_TOKEN), /bad_auth/);
await assert.rejects(verifyInitData(sign(ali, Math.floor(Date.now() / 1000) - 3 * 86400), BOT_TOKEN), /auth_expired/);

// CORS preflight
let r = await call("OPTIONS", "/score");
assert.equal(r.status, 204); assert.equal(r.cors, "https://himn7980-bot.github.io");

// submissions
r = await call("POST", "/score", { initData: sign(ali), score: 1200, wave: 3, kills: 40, duration: 90 });
assert.equal(r.status, 200); assert.deepEqual(r.data, { best: 1200, rank: 1, total: 1, improved: true });
r = await call("POST", "/score", { initData: sign(sara), score: 5000, wave: 6, kills: 120, duration: 200 });
assert.deepEqual(r.data, { best: 5000, rank: 1, total: 2, improved: true });
r = await call("POST", "/score", { initData: sign(kim), score: 1200, wave: 3, kills: 35, duration: 100 });
assert.equal(r.data.rank, 2, "ties share a rank");

// forged, implausible and spammed scores are refused
r = await call("POST", "/score", { initData: sign(ali).replace("hash=", "hash=0"), score: 99999, wave: 1, kills: 1, duration: 10 });
assert.equal(r.status, 401);
r = await call("POST", "/score", { initData: sign({ id: 444, first_name: "Cheat" }), score: 9_000_000, wave: 1, kills: 1, duration: 10 });
assert.equal(r.status, 422);
r = await call("POST", "/score", { initData: sign(ali), score: 800, wave: 2, kills: 20, duration: 60 });
assert.equal(r.status, 429, "second submit inside 3 s is refused");

// a lower score later keeps the best; a higher one replaces it
sqlite.prepare("UPDATE scores SET updated_at = updated_at - 10").run();
r = await call("POST", "/score", { initData: sign(ali), score: 800, wave: 2, kills: 20, duration: 60 });
assert.deepEqual(r.data, { best: 1200, rank: 2, total: 3, improved: false });
sqlite.prepare("UPDATE scores SET updated_at = updated_at - 10").run();
r = await call("POST", "/score", { initData: sign(ali), score: 7000, wave: 8, kills: 200, duration: 300 });
assert.deepEqual(r.data, { best: 7000, rank: 1, total: 3, improved: true });
assert.equal(sqlite.prepare("SELECT games FROM scores WHERE user_id = 111").get().games, 3);

// leaderboard
r = await call("GET", "/top?limit=10&uid=333");
assert.equal(r.status, 200);
assert.deepEqual(r.data.top.map((x) => [x.rank, x.name, x.best]), [[1, "Ali Rezaei", 7000], [2, "Sara", 5000], [3, "Kim", 1200]]);
assert.equal(r.data.top[2].you, true);
assert.equal(r.data.top.some((x) => "user_id" in x), false, "Telegram ids are never published");
assert.deepEqual(r.data.me, { best: 1200, wave: 3, rank: 3 });
assert.equal(r.data.total, 3);
r = await call("GET", "/nope");
assert.equal(r.status, 404);

// team war: best run of the week per player, credited to the hero played
sqlite.prepare("UPDATE scores SET updated_at = updated_at - 10").run();
r = await call("POST", "/score", { initData: sign(sara), score: 6000, wave: 7, kills: 150, duration: 250, hero: "paws" });
assert.equal(r.status, 200);
sqlite.prepare("UPDATE scores SET updated_at = updated_at - 10").run();
r = await call("POST", "/score", { initData: sign(kim), score: 3000, wave: 5, kills: 90, duration: 200, hero: "paws" });
sqlite.prepare("UPDATE scores SET updated_at = updated_at - 10").run();
r = await call("POST", "/score", { initData: sign(kim), score: 1000, wave: 3, kills: 30, duration: 90, hero: "notreal" });
r = await call("GET", "/teams");
assert.equal(r.status, 200);
const team = Object.fromEntries(r.data.teams.map((t) => [t.hero, t]));
assert.deepEqual([team.paws.total, team.paws.players], [9000, 2]);
assert.equal(team.volya.total, 7000 + 5000 + 1200, "unknown heroes count for volya; best per player per hero");
assert.equal(r.data.teams[0].hero, "volya");
assert.ok(r.data.endsIn > 0 && r.data.endsIn <= 7 * 86400);

// daily challenge board
const today = Math.floor(Date.now() / 86400000);
r = await call("POST", "/daily", { initData: sign(ali), day: today, score: 900, hero: "teddy" });
assert.deepEqual(r.data, { best: 900, rank: 1 });
r = await call("POST", "/daily", { initData: sign(sara), day: today, score: 1500 });
assert.deepEqual(r.data, { best: 1500, rank: 1 });
r = await call("POST", "/daily", { initData: sign(kim), day: today - 5, score: 100 });
assert.equal(r.status, 400, "old days are closed");
r = await call("POST", "/daily", { initData: sign(kim), day: today, score: 99_000_000 });
assert.equal(r.status, 422);
r = await call("GET", `/daily?day=${today}&uid=111`);
assert.deepEqual(r.data.top.map((x) => [x.rank, x.name, x.best]), [[1, "Sara", 1500], [2, "Ali Rezaei", 900]]);
assert.deepEqual(r.data.me, { best: 900, rank: 2 });
assert.equal(r.data.top[0].hero, "volya"); assert.equal(r.data.top[1].hero, "teddy");

// Telegram Stars: invoice -> pre-checkout -> payment -> claim exactly once
r = await call("POST", "/invoice", { initData: sign(ali), product: "gold_m" });
assert.equal(r.status, 200); assert.match(r.data.link, /^https:\/\/t\.me\/\$invoice-111\|gold_m\|/);
const inv = tgCalls.find((c) => c.method === "createInvoiceLink").body;
assert.deepEqual([inv.currency, inv.prices[0].amount], ["XTR", 150]);
r = await call("POST", "/invoice", { initData: sign(ali), product: "free_money" });
assert.equal(r.status, 400);
const hook = async (update, secret = "s3cret") => (await worker.fetch(new Request("https://lb.example/tg-webhook", {
  method: "POST", headers: { "Content-Type": "application/json", "X-Telegram-Bot-Api-Secret-Token": secret }, body: JSON.stringify(update)
}), env)).status;
assert.equal(await hook({ message: { text: "/start" } }, "wrong"), 403, "webhook needs the secret");
assert.equal(await hook({ pre_checkout_query: { id: "q1", from: { id: 111 }, currency: "XTR", total_amount: 150, invoice_payload: inv.payload } }), 200);
assert.deepEqual(tgCalls.at(-1), { method: "answerPreCheckoutQuery", body: { pre_checkout_query_id: "q1", ok: true } });
await hook({ pre_checkout_query: { id: "q2", from: { id: 111 }, currency: "XTR", total_amount: 1, invoice_payload: inv.payload } });
assert.equal(tgCalls.at(-1).body.ok, false, "wrong price is refused");
const paid = { message: { from: { id: 111 }, chat: { id: 111 }, successful_payment: { currency: "XTR", total_amount: 150, invoice_payload: inv.payload, telegram_payment_charge_id: "ch_1" } } };
await hook(paid); await hook(paid);
r = await call("POST", "/claim", { initData: sign(ali) });
assert.deepEqual(r.data, { products: ["gold_m"] });
r = await call("POST", "/claim", { initData: sign(ali) });
assert.deepEqual(r.data, { products: [] }, "a purchase is delivered once");
await hook({ message: { chat: { id: 5 }, text: "/start ref_111_h_paws" } });
assert.equal(tgCalls.at(-1).body.reply_markup.inline_keyboard[0][0].web_app.url, "https://game.example/?startapp=ref_111_h_paws");

await wait(0);
console.log("server tests passed");
