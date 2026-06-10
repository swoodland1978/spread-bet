/**
 * Quick IG login test — run with: node test-ig-login.mjs
 * Tests your credentials against the IG demo API.
 */

import { readFileSync } from "fs";
// Parse .env.local manually (no dotenv dependency needed)
const envFile = readFileSync(".env.local", "utf-8");
for (const line of envFile.split("\n")) {
  const match = line.match(/^([A-Z_]+)=(.+)$/);
  if (match) process.env[match[1]] = match[2].trim();
}

const { IG_API_KEY, IG_USERNAME, IG_PASSWORD, IG_ACCOUNT_ID } = process.env;

console.log("=== IG Login Test ===");
console.log("API Key:", IG_API_KEY ? `${IG_API_KEY.slice(0, 8)}...` : "MISSING");
console.log("Username:", IG_USERNAME || "MISSING");
console.log("Password:", IG_PASSWORD ? "***set***" : "MISSING");
console.log("Account ID:", IG_ACCOUNT_ID || "MISSING");
console.log("");

if (!IG_API_KEY || !IG_USERNAME || !IG_PASSWORD) {
  console.error("Missing credentials in .env.local");
  process.exit(1);
}

try {
  console.log("Attempting login to demo-api.ig.com...");
  const res = await fetch("https://demo-api.ig.com/gateway/deal/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json; charset=UTF-8",
      "X-IG-API-KEY": IG_API_KEY,
      "VERSION": "2",
    },
    body: JSON.stringify({
      identifier: IG_USERNAME,
      password: IG_PASSWORD,
    }),
  });

  const body = await res.text();

  if (res.ok) {
    const data = JSON.parse(body);
    const cst = res.headers.get("CST");
    const token = res.headers.get("X-SECURITY-TOKEN");
    console.log("LOGIN SUCCESSFUL");
    console.log("Account ID:", data.currentAccountId);
    console.log("CST:", cst ? "received" : "missing");
    console.log("Security Token:", token ? "received" : "missing");

    // Try fetching account balance
    const accRes = await fetch("https://demo-api.ig.com/gateway/deal/accounts", {
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json; charset=UTF-8",
        "X-IG-API-KEY": IG_API_KEY,
        "CST": cst,
        "X-SECURITY-TOKEN": token,
      },
    });
    if (accRes.ok) {
      const accData = await accRes.json();
      console.log("\nAccounts found:");
      for (const acc of accData.accounts || []) {
        const bal = acc.balance || {};
        console.log(`  ${acc.accountId} (${acc.accountName}) — Balance: £${bal.balance?.toFixed(2)} | P&L: £${bal.profitLoss?.toFixed(2)}`);
      }
    }
  } else {
    console.error(`LOGIN FAILED (HTTP ${res.status})`);
    console.error("Response:", body);
    console.log("\nCommon fixes:");
    console.log("- Make sure you're using your DEMO account credentials (not live)");
    console.log("- Try logging in at https://demo-dealing.ig.com to verify");
    console.log("- Your username might be your email address");
  }
} catch (err) {
  console.error("Network error:", err.message);
}
