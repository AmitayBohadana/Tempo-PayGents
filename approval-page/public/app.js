import {
  createClient,
  http,
  publicActions,
  walletActions,
  formatUnits
} from "https://esm.sh/viem@2.45.3";
import { tempoModerato } from "https://esm.sh/viem@2.45.3/chains";
import {
  Account,
  WebAuthnP256,
  tempoActions,
  withFeePayer
} from "https://esm.sh/viem@2.45.3/tempo";

const params = new URLSearchParams(window.location.search);
const token = params.get("token");

const approvalPageEl = document.getElementById("approval-page");
const landingPageEl = document.getElementById("landing-page");

const notificationBanner = document.getElementById("notification-banner");
const notifyBtn = document.getElementById("notify-btn");
const landingNotifyBtn = document.getElementById("landing-notify-btn");

// Agent pairing UI
const generatePairingCodeBtn = document.getElementById("generate-pairing-code-btn");
const pairingPanelEl = document.getElementById("pairing-panel");
const pairingCodeEl = document.getElementById("pairing-code");
const pairingCountdownEl = document.getElementById("pairing-countdown");
const pairingStatusEl = document.getElementById("pairing-status");

// Approval page UI
const amountDisplay = document.getElementById("amount-display");
const itemNameEl = document.getElementById("item-name");
const merchantNameEl = document.getElementById("merchant-name");
const detailTo = document.getElementById("detail-to");
const detailToken = document.getElementById("detail-token");
const detailMemo = document.getElementById("detail-memo");
const detailIntent = document.getElementById("detail-intent");
const approveBtn = document.getElementById("approve-btn");
const fundBtn = document.getElementById("fund-btn");
const rejectBtn = document.getElementById("reject-btn");
const statusEl = document.getElementById("status");
const countdownEl = document.getElementById("countdown");
const countdownBar = document.getElementById("countdown-bar");
const countdownProgress = document.getElementById("countdown-progress");
const countdownProgressInner = document.getElementById("countdown-progress-inner");

// Home page UI
const walletCardEl = document.getElementById("wallet-card");
const noWalletCardEl = document.getElementById("no-wallet-card");
const walletAddressBoxEl = document.getElementById("wallet-address-box");
const walletAddressEl = document.getElementById("wallet-address");
const walletCopyEl = document.getElementById("wallet-copy");
const tempoBalanceEl = document.getElementById("tempo-balance");
const alphaUsdBalanceEl = document.getElementById("alphausd-balance");
const landingFundBtn = document.getElementById("landing-fund-btn");

const agentsListEl = document.getElementById("agents-list");
const agentsEmptyEl = document.getElementById("agents-empty");
const agentsCountEl = document.getElementById("agents-count");

const activityListEl = document.getElementById("activity-list");
const activityEmptyEl = document.getElementById("activity-empty");

const PASSKEY_CREDENTIAL_KEY = "hvaw_passkey_credential_id";
const PASSKEY_PUBLIC_KEY_PREFIX = "hvaw_passkey_public_key_";
const AGENT_API_KEY_STORAGE_KEY = "paygents_agent_api_key"; // legacy
const PAIRED_BOTS_STORAGE_KEY = "paygents_paired_bots";
const ACTIVE_BOT_ID_STORAGE_KEY = "paygents_active_bot_id";
const PAIRING_TOKEN_STORAGE_KEY = "paygents_pairing_token";

const ALPHAUSD_ADDRESS = "0x20c0000000000000000000000000000000000001";
const ERC20_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  }
];

let approval = null;
let countdownTimer = null;
let countdownInitialRemaining = null;


function loadPairedBots() {
  try {
    const raw = localStorage.getItem(PAIRED_BOTS_STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((b) => b && typeof b === "object") : [];
  } catch {
    return [];
  }
}

function savePairedBots(bots) {
  localStorage.setItem(
    PAIRED_BOTS_STORAGE_KEY,
    JSON.stringify(Array.isArray(bots) ? bots : [])
  );
}

function getActiveBotId() {
  const v = localStorage.getItem(ACTIVE_BOT_ID_STORAGE_KEY);
  return typeof v === "string" ? v : "";
}

function setActiveBotId(botId) {
  localStorage.setItem(ACTIVE_BOT_ID_STORAGE_KEY, String(botId || ""));
}

function getActiveBot() {
  const bots = loadPairedBots();
  const activeId = getActiveBotId();
  if (activeId) {
    const found = bots.find((b) => String(b.botId) === String(activeId));
    if (found) return found;
  }
  return bots[0] || null;
}

function getAgentApiKey() {
  // Prefer paired bots; fall back to legacy single-key storage.
  const active = getActiveBot();
  if (active && active.apiKey) return String(active.apiKey).trim();
  const value = localStorage.getItem(AGENT_API_KEY_STORAGE_KEY);
  return typeof value === "string" ? value.trim() : "";
}

function addPairedBot({ botId, apiKey, botName }) {
  const bots = loadPairedBots();
  const now = new Date().toISOString();
  const normalized = { botId: String(botId), apiKey: String(apiKey), botName: botName || null, pairedAt: now };
  const existingIndex = bots.findIndex((b) => String(b.botId) === normalized.botId);
  if (existingIndex >= 0) bots[existingIndex] = { ...bots[existingIndex], ...normalized };
  else bots.push(normalized);
  savePairedBots(bots);
  setActiveBotId(normalized.botId);
}

function removePairedBot(botId) {
  const bots = loadPairedBots().filter((b) => String(b.botId) !== String(botId));
  savePairedBots(bots);
  const active = getActiveBotId();
  if (String(active) === String(botId)) {
    setActiveBotId(bots[0]?.botId || "");
  }
}

function maskApiKey(value) {
  const key = String(value || "").trim();
  if (!key) return "—";
  if (key.length <= 10) return key;
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

function getStoredPublicKey(credentialId) {
  return localStorage.getItem(`${PASSKEY_PUBLIC_KEY_PREFIX}${credentialId}`);
}

function setStoredPublicKey(credentialId, publicKey) {
  localStorage.setItem(`${PASSKEY_PUBLIC_KEY_PREFIX}${credentialId}`, publicKey);
  localStorage.setItem(PASSKEY_CREDENTIAL_KEY, credentialId);
}

async function getOrCreatePasskeyAccount() {
  if (!window.isSecureContext) {
    throw new Error(
      "Passkeys require HTTPS (or localhost on same device). Open this page via HTTPS and not in an in-app browser."
    );
  }

  if (!window.PublicKeyCredential) {
    throw new Error(
      "Passkeys/WebAuthn API is unavailable. Try Safari/Chrome directly (not Telegram/Discord in-app browser)."
    );
  }

  const existingCredentialId = localStorage.getItem(PASSKEY_CREDENTIAL_KEY);
  if (existingCredentialId) {
    const publicKey = getStoredPublicKey(existingCredentialId);
    if (publicKey) {
      return Account.fromWebAuthnP256({ id: existingCredentialId, publicKey });
    }
  }

  const credential = await WebAuthnP256.createCredential({
    label: "PayGents"
  });
  setStoredPublicKey(credential.id, credential.publicKey);
  return Account.fromWebAuthnP256({ id: credential.id, publicKey: credential.publicKey });
}

function createTempoClient(account) {
  return createClient({
    account,
    chain: tempoModerato,
    transport: withFeePayer(http("/api/rpc"), http("/api/sponsor"))
  })
    .extend(publicActions)
    .extend(walletActions)
    .extend(tempoActions());
}

const TEMPO_EXPLORER = "https://explore.moderato.tempo.xyz/tx/";

function setStatus(message, type = "info") {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = `status-msg ${type}`;
  statusEl.style.display = "inline-block";
}

function setStatusWithTx(message, txHash, type = "success") {
  if (!statusEl) return;
  const explorerUrl = `${TEMPO_EXPLORER}${txHash}`;
  statusEl.innerHTML = `${message} <a href="${explorerUrl}" target="_blank" rel="noopener" style="color: #4da6ff; text-decoration: underline;">Tx: ${txHash.slice(0, 10)}…</a>`;
  statusEl.className = `status-msg ${type}`;
  statusEl.style.display = "inline-block";
}

function truncateAddress(address) {
  if (!address) return "";
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

async function copyWithPulse(el, text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Some iOS contexts can block clipboard; silently ignore.
    return false;
  }

  if (el) {
    el.classList.add("copied");
    setTimeout(() => el.classList.remove("copied"), 550);
  }
  return true;
}

function tokenLabel(tokenAddress) {
  if (!tokenAddress) return "Token";
  if (String(tokenAddress).toLowerCase() === ALPHAUSD_ADDRESS.toLowerCase()) return "alphaUSD";
  return truncateAddress(tokenAddress);
}

function escapeHtml(value) {
  const map = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  };
  return String(value).replace(/[&<>"']/g, (ch) => map[ch] || ch);
}


function renderPairedAgents() {
  // Migrate legacy single-key storage into the bots list (best-effort).
  const legacy = localStorage.getItem(AGENT_API_KEY_STORAGE_KEY);
  const existingBots = loadPairedBots();
  if (legacy && existingBots.length === 0) {
    const apiKey = String(legacy).trim();
    if (apiKey) {
      existingBots.push({ botId: "legacy", apiKey, pairedAt: new Date().toISOString() });
      savePairedBots(existingBots);
      setActiveBotId("legacy");
    }
  }

  const bots = loadPairedBots();
  const active = getActiveBot();

  if (agentsCountEl) agentsCountEl.textContent = String(bots.length);

  if (agentsListEl) {
    agentsListEl.innerHTML = bots
      .map((bot) => {
        const isActive = active && String(active.botId) === String(bot.botId);
        const label = bot.botName ? escapeHtml(bot.botName) : `Bot ${escapeHtml(String(bot.botId).slice(0, 8))}`;
        const sub = `apiKey: ${maskApiKey(bot.apiKey)}`;
        const primary = isActive
          ? '<span class="badge executed">ACTIVE</span>'
          : '<button class="inline-btn" data-action="set-active" data-bot-id="' +
            escapeHtml(bot.botId) +
            '">Use</button>';
        return `
          <div class="row">
            <div class="left">
              <span class="agent-dot" aria-hidden="true"></span>
              <div class="meta">
                <div class="name">${label}</div>
                <div class="sub">${escapeHtml(sub)}</div>
              </div>
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
              ${primary}
              <button class="inline-btn" data-action="remove" data-bot-id="${escapeHtml(bot.botId)}" style="border-color: rgba(255,77,109,0.28); background: rgba(255,77,109,0.10);">Remove</button>
            </div>
          </div>
        `;
      })
      .join("");

    agentsListEl.querySelectorAll('[data-action="set-active"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const botId = btn.getAttribute("data-bot-id");
        if (!botId) return;
        setActiveBotId(botId);
        renderPairedAgents();
        void loadRecentActivity();

        // Best-effort: re-save push subscription under the new bot apiKey.
        const apiKey = getAgentApiKey();
        if (apiKey && "serviceWorker" in navigator && "PushManager" in window) {
          void navigator.serviceWorker.ready
            .then(async (registration) => {
              const existing = await registration.pushManager.getSubscription();
              if (!existing) return;
              await fetch("/api/push/subscribe", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${apiKey}`
                },
                body: JSON.stringify({ subscription: existing })
              });
            })
            .catch(() => {});
        }
      });
    });

    agentsListEl.querySelectorAll('[data-action="remove"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const botId = btn.getAttribute("data-bot-id");
        if (!botId) return;
        if (!confirm("Remove this bot from this device?")) return;
        removePairedBot(botId);
        renderPairedAgents();
        void loadRecentActivity();
        setNotificationCtaVisible(true);
      });
    });
  }

  if (agentsEmptyEl) {
    agentsEmptyEl.style.display = bots.length ? "none" : "block";
  }
}

function renderApproval(data) {
  const label = tokenLabel(data.token);
  const displayAmount = Number(data.amount) % 1 === 0 ? data.amount : Number(data.amount).toFixed(3);
  amountDisplay.innerHTML = `${displayAmount}<span class="currency">${label}</span>`;
  itemNameEl.textContent = data.itemName || "";
  merchantNameEl.textContent = data.merchantName ? `from ${data.merchantName}` : "";

  detailTo.textContent = data.to;
  detailTo.title = data.to;
  detailToken.textContent = data.token;
  detailToken.title = data.token;
  detailMemo.textContent = data.memo;
  detailIntent.textContent = data.intentIdHuman;
  detailIntent.title = data.intentId;

  approveBtn.disabled = false;
  rejectBtn.disabled = false;
}

function updateCountdown() {
  if (!approval) {
    if (countdownEl) countdownEl.textContent = "";
    return;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const remaining = Math.max(approval.deadline - nowSec, 0);
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const pad = (n) => String(n).padStart(2, "0");

  if (countdownEl) countdownEl.textContent = remaining > 0 ? `Expires in ${minutes}:${pad(seconds)}` : "Expired";

  if (countdownInitialRemaining === null) {
    countdownInitialRemaining = remaining;
  }

  const base = Math.max(countdownInitialRemaining ?? remaining, 1);
  const pct = Math.max(Math.min((remaining / base) * 100, 100), 0);
  if (countdownProgressInner) countdownProgressInner.style.width = `${pct}%`;

  if (remaining <= 0) {
    if (countdownProgress) countdownProgress.className = "progress expired";
    approveBtn.disabled = true;
    rejectBtn.disabled = true;
    setStatus("This payment request has expired.", "error");
    if (countdownTimer) clearInterval(countdownTimer);
  } else if (remaining < 60) {
    if (countdownProgress) countdownProgress.className = "progress warning";
  } else {
    if (countdownProgress) countdownProgress.className = "progress";
  }
}

async function loadApproval() {
  if (!token) return;

  try {
    const response = await fetch(`/api/approval/${token}`);
    const body = await response.json();

    if (!response.ok) {
      setStatus(body.message || "Failed to load payment details.", "error");
      return;
    }

    approval = body.approval;
    countdownInitialRemaining = null;
    renderApproval(approval);
    updateCountdown();
    countdownTimer = setInterval(updateCountdown, 1000);
  } catch {
    setStatus("Failed to connect to server.", "error");
  }
}

async function approve() {
  if (!approval) return;

  approveBtn.disabled = true;
  rejectBtn.disabled = true;
  if (fundBtn) fundBtn.style.display = "none";

  setStatus("Authenticating passkey…", "info");

  let account;
  try {
    account = await getOrCreatePasskeyAccount();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Passkey flow failed";
    setStatus(message, "error");
    approveBtn.disabled = false;
    rejectBtn.disabled = false;
    if (fundBtn) fundBtn.style.display = "inline-flex";
    return;
  }

  setStatus("Preparing wallet…", "info");

  try {
    const client = createTempoClient(account);

    // Auto-fund if wallet has no alphaUSD balance (faucet for demo/testnet)
    try {
      const tokenBalance = await client.readContract({
        address: approval.token,
        abi: [{type:"function",name:"balanceOf",stateMutability:"view",inputs:[{name:"account",type:"address"}],outputs:[{name:"",type:"uint256"}]}],
        functionName: "balanceOf",
        args: [account.address]
      });
      if (BigInt(tokenBalance) < BigInt(approval.amountBaseUnits)) {
        setStatus("Funding wallet…", "info");
        const fundResp = await fetch("/api/rpc", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tempo_fundAddress", params: [account.address] })
        });
        const fundBody = await fundResp.json();
        if (!fundResp.ok || fundBody.error) {
          console.warn("Auto-fund failed:", fundBody?.error?.message);
        }
        // Brief pause for funding to settle
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch (fundErr) {
      console.warn("Balance check / auto-fund skipped:", fundErr);
    }

    setStatus("Submitting on-chain payment…", "info");

    const { receipt } = await client.token.transferSync({
      token: approval.token,
      to: approval.to,
      amount: BigInt(approval.amountBaseUnits),
      memo: approval.memoHash,
      nonceKey: BigInt(approval.nonce),
      validBefore: approval.deadline,
      feePayer: true
    });

    const txHash = receipt.transactionHash;
    const confirmResponse = await fetch(`/api/approval/${token}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ txHash })
    });
    const confirmBody = await confirmResponse.json();
    if (!confirmResponse.ok) {
      const msg =
        confirmBody?.message ||
        "Payment executed on-chain, but backend confirmation failed.";
      setStatusWithTx(msg, txHash, "success");
    } else {
      setStatusWithTx("✅ Payment executed!", txHash, "success");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Transaction failed";
    setStatus(message, "error");
    approveBtn.disabled = false;
    rejectBtn.disabled = false;
    if (fundBtn) fundBtn.style.display = "inline-flex";
    return;
  }

  if (countdownTimer) clearInterval(countdownTimer);
  if (countdownBar) countdownBar.style.display = "none";
}

async function fundWallet() {
  approveBtn.disabled = true;
  rejectBtn.disabled = true;
  if (fundBtn) fundBtn.disabled = true;

  setStatus("Creating passkey wallet…", "info");

  let account;
  try {
    account = await getOrCreatePasskeyAccount();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Passkey flow failed";
    setStatus(message, "error");
    approveBtn.disabled = false;
    rejectBtn.disabled = false;
    if (fundBtn) fundBtn.disabled = false;
    return;
  }

  setStatus(`Funding ${account.address.slice(0, 10)}…`, "info");

  try {
    const response = await fetch("/api/rpc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tempo_fundAddress",
        params: [account.address]
      })
    });

    const body = await response.json();
    if (!response.ok || body.error) {
      throw new Error(body?.error?.message || "Faucet request failed");
    }

    setStatus("✅ Funded. You can try approving again.", "success");
    approveBtn.disabled = false;
    rejectBtn.disabled = false;
    if (fundBtn) fundBtn.style.display = "none";
  } catch (error) {
    const message = error instanceof Error ? error.message : "Faucet failed";
    setStatus(message, "error");
    approveBtn.disabled = false;
    rejectBtn.disabled = false;
    if (fundBtn) fundBtn.disabled = false;
  }
}

async function reject() {
  if (!approval) return;

  approveBtn.disabled = true;
  rejectBtn.disabled = true;
  setStatus("Rejecting…", "info");

  const response = await fetch(`/api/approval/${token}/reject`, { method: "POST" });
  const body = await response.json();

  if (!response.ok) {
    setStatus(body.message || "Reject failed.", "error");
    approveBtn.disabled = false;
    rejectBtn.disabled = false;
    return;
  }

  setStatus("Payment rejected.", "error");
  if (countdownTimer) clearInterval(countdownTimer);
  if (countdownBar) countdownBar.style.display = "none";
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

async function setupServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js");
  } catch {
    return null;
  }
}

async function isAlreadySubscribed(registration) {
  if (!registration || !("PushManager" in window)) return false;
  const existing = await registration.pushManager.getSubscription();
  return Boolean(existing);
}

function setNotificationCtaVisible(visible) {
  const notifyCard = document.getElementById("notify-card");
  if (notifyCard) notifyCard.style.display = visible ? "block" : "none";
  if (landingNotifyBtn) landingNotifyBtn.style.display = visible ? "flex" : "none";
}

async function enableNotifications(registration) {
  if (!registration || !("PushManager" in window)) {
    alert("Push notifications are not supported in this browser.");
    return;
  }

  const apiKey = getAgentApiKey();
  if (!apiKey) {
    alert("Pair a bot first (Connected Agents section).");
    return;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return;
  }

  const vapidResponse = await fetch("/api/push/vapid-public-key");
  const vapidBody = await vapidResponse.json();
  if (!vapidResponse.ok || !vapidBody.publicKey) {
    throw new Error("Failed to load VAPID public key");
  }

  const existingSubscription = await registration.pushManager.getSubscription();
  const subscription =
    existingSubscription ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidBody.publicKey)
    }));

  const subscribeResponse = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({ subscription })
  });

  if (!subscribeResponse.ok) {
    throw new Error("Failed to save push subscription");
  }

  setNotificationCtaVisible(false);
}

async function initializePushUi() {
  if (!("Notification" in window) || !("PushManager" in window)) {
    return;
  }

  const registration = await setupServiceWorker();
  const subscribed = await isAlreadySubscribed(registration);
  setNotificationCtaVisible(!subscribed);

  // If we're already subscribed at the browser level and the user has connected an agent,
  // best-effort re-save the subscription to the backend (to survive backend restarts/upgrades).
  try {
    const apiKey = getAgentApiKey();
    const existing = registration ? await registration.pushManager.getSubscription() : null;
    if (apiKey && existing) {
      await fetch("/api/push/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({ subscription: existing })
      });
    }
  } catch {
    // Ignore; user can always click "Enable Notifications" again.
  }

  const clickHandler = async () => {
    if (notifyBtn) notifyBtn.disabled = true;
    if (landingNotifyBtn) landingNotifyBtn.disabled = true;
    try {
      await enableNotifications(registration);
    } catch (error) {
      console.error(error);
      alert("Could not enable notifications. Please try again.");
    } finally {
      if (notifyBtn) notifyBtn.disabled = false;
      if (landingNotifyBtn) landingNotifyBtn.disabled = false;
    }
  };

  notifyBtn?.addEventListener("click", () => void clickHandler());
  landingNotifyBtn?.addEventListener("click", () => void clickHandler());
}


let pairingPollTimer = null;
let pairingCountdownTimer = null;

function setPairingPanelVisible(visible) {
  if (!pairingPanelEl) return;
  pairingPanelEl.style.display = visible ? "block" : "none";
}

function setPairingStatus(text, type = "info") {
  if (!pairingStatusEl) return;
  pairingStatusEl.textContent = text;
  pairingStatusEl.className = `status-msg ${type}`;
  pairingStatusEl.style.display = "inline-block";
}

function stopPairingTimers() {
  if (pairingPollTimer) clearInterval(pairingPollTimer);
  if (pairingCountdownTimer) clearInterval(pairingCountdownTimer);
  pairingPollTimer = null;
  pairingCountdownTimer = null;
}

function renderPairingCountdown(expiresAtIso) {
  if (!pairingCountdownEl) return;
  const expiresAtMs = Date.parse(expiresAtIso);

  const tick = () => {
    const remainingMs = Math.max(expiresAtMs - Date.now(), 0);
    const remainingSec = Math.floor(remainingMs / 1000);
    const m = Math.floor(remainingSec / 60);
    const sec = remainingSec % 60;
    const pad = (n) => String(n).padStart(2, "0");
    pairingCountdownEl.textContent =
      remainingSec > 0 ? `Expires in ${m}:${pad(sec)}` : "Expired";
  };

  tick();
  pairingCountdownTimer = setInterval(tick, 1000);
}

async function startPairingFlow() {
  if (!generatePairingCodeBtn) return;

  generatePairingCodeBtn.disabled = true;
  stopPairingTimers();

  try {
    const response = await fetch("/api/pair/request", { method: "POST" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body?.message || "Failed to generate pairing code.");
    }

    const code = String(body.code || "").padStart(4, "0");
    const pairingToken = String(body.pairingToken || "");
    const expiresAt = String(body.expiresAt || "");

    if (!/^\d{4}$/.test(code) || !pairingToken || !expiresAt) {
      throw new Error("Invalid pairing response from server.");
    }

    localStorage.setItem(PAIRING_TOKEN_STORAGE_KEY, pairingToken);

    if (pairingCodeEl) pairingCodeEl.textContent = code;
    setPairingPanelVisible(true);
    setPairingStatus("Waiting for your bot to connect…", "info");
    renderPairingCountdown(expiresAt);

    const poll = async () => {
      const statusResp = await fetch(
        `/api/pair/status?token=${encodeURIComponent(pairingToken)}`
      );
      const statusBody = await statusResp.json().catch(() => ({}));

      if (!statusResp.ok) {
        throw new Error(statusBody?.message || "Pairing status failed");
      }

      if (statusBody.status === "paired" && statusBody.apiKey && statusBody.botId) {
        stopPairingTimers();
        setPairingStatus("✅ Paired! Bot connected to this device.", "success");
        addPairedBot({ botId: statusBody.botId, apiKey: statusBody.apiKey, botName: statusBody.botName });
        renderPairedAgents();
        void loadRecentActivity();

        // Re-save push subscription under the new API key immediately.
        const apiKey = getAgentApiKey();
        if (apiKey && "serviceWorker" in navigator && "PushManager" in window) {
          void navigator.serviceWorker.ready
            .then(async (registration) => {
              const existing = await registration.pushManager.getSubscription();
              if (!existing) return;
              await fetch("/api/push/subscribe", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${apiKey}`
                },
                body: JSON.stringify({ subscription: existing })
              });
            })
            .catch(() => {});
        }

        generatePairingCodeBtn.disabled = false;
        return;
      }

      if (statusBody.status === "expired") {
        stopPairingTimers();
        setPairingStatus("Pairing code expired. Generate a new one.", "error");
        generatePairingCodeBtn.disabled = false;
        return;
      }

      // pending
    };

    await poll();
    pairingPollTimer = setInterval(() => {
      poll().catch(() => {});
    }, 3000);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Pairing failed.";
    alert(msg);
    setPairingPanelVisible(false);
    generatePairingCodeBtn.disabled = false;
  }
}

function initializeAgentPairingUi() {
  generatePairingCodeBtn?.addEventListener("click", () => void startPairingFlow());
}

function initializeMode() {
  const hasToken = Boolean(token);
  if (approvalPageEl) approvalPageEl.style.display = hasToken ? "block" : "none";
  if (landingPageEl) landingPageEl.style.display = hasToken ? "none" : "block";
}

async function refreshHomeBalances(account) {
  const address = account.address;
  const client = createTempoClient(account);

  if (tempoBalanceEl) tempoBalanceEl.textContent = "…";
  if (alphaUsdBalanceEl) alphaUsdBalanceEl.textContent = "…";

  try {
    const native = await client.getBalance({ address });
    const raw = typeof native === "bigint" ? native : BigInt(native);
    const tempo = formatUnits(raw, 18);
    const display = parseFloat(tempo);
    if (tempoBalanceEl) tempoBalanceEl.textContent = Number.isFinite(display) ? display.toFixed(3) : "0.000";
  } catch (err) {
    console.error("TEMPO balance error:", err);
    if (tempoBalanceEl) tempoBalanceEl.textContent = "—";
  }

  try {
    const alphaRaw = await client.readContract({
      address: ALPHAUSD_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address]
    });

    const alpha = formatUnits(BigInt(alphaRaw), 6);
    if (alphaUsdBalanceEl) alphaUsdBalanceEl.textContent = `${Number(alpha).toFixed(3)}`;
  } catch {
    if (alphaUsdBalanceEl) alphaUsdBalanceEl.textContent = "—";
  }
}

function badgeClassFromStatus(status) {
  const s = String(status || "").toUpperCase();
  if (s.includes("PENDING")) return "pending";
  if (s.includes("EXECUT")) return "executed";
  if (s.includes("REJECT")) return "rejected";
  if (s.includes("EXPIRE")) return "expired";
  return "expired";
}

function humanStatus(status) {
  const s = String(status || "").toUpperCase();
  if (s.includes("PENDING")) return "PENDING";
  if (s.includes("EXECUT")) return "EXECUTED";
  if (s.includes("REJECT")) return "REJECTED";
  if (s.includes("EXPIRE")) return "EXPIRED";
  return s || "UNKNOWN";
}

async function loadRecentActivity() {
  if (!activityListEl) return;

  activityListEl.innerHTML = "";
  if (activityEmptyEl) {
    activityEmptyEl.style.display = "none";
    activityEmptyEl.textContent = "Loading recent intents…";
    activityEmptyEl.style.display = "block";
  }

  try {
    const apiKey = getAgentApiKey();
    const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined;
    const response = await fetch("/api/intents", headers ? { headers } : undefined);
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      // In some deployments this may be protected by an API key. Keep UX smooth.
      if (activityEmptyEl) {
        activityEmptyEl.textContent =
          response.status === 401 || response.status === 403
            ? "Connect an agent to view activity."
            : "Could not load recent activity.";
      }
      return;
    }

    const intents = Array.isArray(body.intents) ? body.intents : [];
    const items = intents.slice(0, 5);

    if (items.length === 0) {
      if (activityEmptyEl) {
        activityEmptyEl.textContent = "No recent intents.";
      }
      return;
    }

    if (activityEmptyEl) activityEmptyEl.style.display = "none";

    activityListEl.innerHTML = items
      .map((intent) => {
        const id = escapeHtml(intent.intentIdHuman || intent.intentId || "Intent");
        const merchant = escapeHtml(intent.merchantName || intent.merchant || "");
        const amount = escapeHtml(intent.amount || intent.amountHuman || "");
        const status = humanStatus(intent.status);
        const cls = badgeClassFromStatus(intent.status);

        const sub = merchant ? `${merchant}${amount ? ` · ${amount}` : ""}` : amount;

        return `
          <div class="row">
            <div class="left">
              <div class="meta">
                <div class="name">${id}</div>
                <div class="sub">${sub || "—"}</div>
              </div>
            </div>
            <span class="badge ${cls}">${status}</span>
          </div>
        `;
      })
      .join("");
  } catch {
    if (activityEmptyEl) {
      activityEmptyEl.textContent = "Could not load recent activity.";
    }
  }
}

async function initializeWalletInfo() {
  if (!window.isSecureContext || !window.PublicKeyCredential) return;

  const existingCredentialId = localStorage.getItem(PASSKEY_CREDENTIAL_KEY);
  if (!existingCredentialId) {
    if (walletCardEl) walletCardEl.style.display = "none";
    if (noWalletCardEl) noWalletCardEl.style.display = "block";
    return;
  }

  const publicKey = getStoredPublicKey(existingCredentialId);
  if (!publicKey) {
    if (walletCardEl) walletCardEl.style.display = "none";
    if (noWalletCardEl) noWalletCardEl.style.display = "block";
    return;
  }

  try {
    const account = Account.fromWebAuthnP256({ id: existingCredentialId, publicKey });
    const address = account.address;

    if (noWalletCardEl) noWalletCardEl.style.display = "none";
    if (walletCardEl) walletCardEl.style.display = "block";

    if (walletAddressEl) {
      walletAddressEl.textContent = truncateAddress(address);
      walletAddressEl.title = address;
    }

    if (walletAddressBoxEl) {
      walletAddressBoxEl.addEventListener("click", async () => {
        const ok = await copyWithPulse(walletAddressBoxEl, address);
        if (!ok) return;
        if (walletCopyEl) {
          const prev = walletCopyEl.textContent;
          walletCopyEl.textContent = "Copied";
          setTimeout(() => {
            walletCopyEl.textContent = prev || "Copy";
          }, 1000);
        }
      });
    }

    // Balances + faucet
    await refreshHomeBalances(account);

    if (landingFundBtn) {
      landingFundBtn.style.display = "inline-flex";
      landingFundBtn.addEventListener("click", async () => {
        landingFundBtn.disabled = true;
        const prev = landingFundBtn.textContent;
        landingFundBtn.textContent = "Funding…";

        try {
          const response = await fetch("/api/rpc", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "tempo_fundAddress",
              params: [address]
            })
          });

          const body = await response.json();
          if (!response.ok || body.error) throw new Error(body?.error?.message || "Faucet failed");

          landingFundBtn.textContent = "✅ Funded";
          await refreshHomeBalances(account);
        } catch {
          landingFundBtn.textContent = "Failed — try again";
        } finally {
          setTimeout(() => {
            landingFundBtn.textContent = prev || "Fund Wallet";
            landingFundBtn.disabled = false;
          }, 1400);
        }
      });
    }
  } catch {
    if (walletCardEl) walletCardEl.style.display = "none";
    if (noWalletCardEl) noWalletCardEl.style.display = "block";
  }
}

initializeMode();
initializeAgentPairingUi();
renderPairedAgents();
void initializePushUi();

if (!token) {
  void initializeWalletInfo();
  void loadRecentActivity();
}

approveBtn?.addEventListener("click", () => void approve());
fundBtn?.addEventListener("click", () => void fundWallet());
rejectBtn?.addEventListener("click", () => void reject());

if (token) {
  void loadApproval();
}

// Learn more modal
const learnMoreBtn = document.getElementById("learn-more-btn");
const learnMoreModal = document.getElementById("learn-more-modal");
const closeModalBtn = document.getElementById("close-modal-btn");
const closeModalBtnBottom = document.getElementById("close-modal-btn-bottom");

function openModal() {
  if (learnMoreModal) learnMoreModal.style.display = "block";
}
function closeModal() {
  if (learnMoreModal) learnMoreModal.style.display = "none";
}

learnMoreBtn?.addEventListener("click", openModal);
closeModalBtn?.addEventListener("click", closeModal);
closeModalBtnBottom?.addEventListener("click", closeModal);
learnMoreModal?.addEventListener("click", (e) => {
  if (e.target === learnMoreModal) closeModal();
});

// Handle messages from service worker when app is already open
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    const { type, approvalUrl } = event.data || {};
    if ((type === "new-intent" || type === "navigate-approval") && approvalUrl) {
      window.location.href = approvalUrl;
    }
  });
}
