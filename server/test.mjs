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
const env = { DB, BOT_TOKEN, ALLOWED_ORIGIN: "https://himn7980-bot.github.io" };

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

await wait(0);
console.log("server tests passed");
