import { createClient, http, publicActions, walletActions } from "https://esm.sh/viem@2.45.3";
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

const PASSKEY_CREDENTIAL_KEY = "hvaw_passkey_credential_id";
const PUSH_SUBSCRIBED_KEY = "hvaw_push_subscribed";
const PASSKEY_PUBLIC_KEY_PREFIX = "hvaw_passkey_public_key_";

let approval = null;
let countdownTimer = null;

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
    label: "Agent Wallet"
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

function renderApproval(data) {
  amountDisplay.innerHTML = `${data.amount}<span class="currency">USDC</span>`;
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

function bytesToBase64Url(bytes) {
  const binary = String.fromCharCode(...bytes);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function hexToBytes(hex) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const pairs = clean.match(/.{1,2}/g) || [];
  return Uint8Array.from(pairs.map((pair) => Number.parseInt(pair, 16)));
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function updateCountdown() {
  if (!approval) {
    countdownEl.textContent = "";
    return;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const remaining = Math.max(approval.deadline - nowSec, 0);
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const pad = (n) => String(n).padStart(2, "0");

  countdownEl.textContent = `Expires in ${minutes}:${pad(seconds)}`;

  if (remaining <= 0) {
    countdownBar.className = "countdown-bar expired";
    countdownEl.textContent = "Expired";
    approveBtn.disabled = true;
    rejectBtn.disabled = true;
    setStatus("This payment request has expired.", "error");
    if (countdownTimer) clearInterval(countdownTimer);
  } else if (remaining < 60) {
    countdownBar.className = "countdown-bar warning";
  }
}

async function loadApproval() {
  if (!token) {
    return;
  }

  try {
    const response = await fetch(`/api/approval/${token}`);
    const body = await response.json();

    if (!response.ok) {
      setStatus(body.message || "Failed to load payment details.", "error");
      return;
    }

    approval = body.approval;
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

  setStatus("Submitting on-chain payment…", "info");

  try {
    const client = createTempoClient(account);
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
  countdownBar.style.display = "none";
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
  countdownBar.style.display = "none";
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
  return Boolean(existing) || localStorage.getItem(PUSH_SUBSCRIBED_KEY) === "1";
}

function setNotificationCtaVisible(visible) {
  const display = visible ? "flex" : "none";
  if (notificationBanner) notificationBanner.style.display = display;
  if (landingNotifyBtn) landingNotifyBtn.style.display = visible ? "flex" : "none";
}

async function enableNotifications(registration) {
  if (!registration || !("PushManager" in window)) {
    alert("Push notifications are not supported in this browser.");
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
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription })
  });

  if (!subscribeResponse.ok) {
    throw new Error("Failed to save push subscription");
  }

  localStorage.setItem(PUSH_SUBSCRIBED_KEY, "1");
  setNotificationCtaVisible(false);
}

async function initializePushUi() {
  if (!("Notification" in window) || !("PushManager" in window)) {
    return;
  }

  const registration = await setupServiceWorker();
  const subscribed = await isAlreadySubscribed(registration);
  setNotificationCtaVisible(!subscribed);

  const clickHandler = async () => {
    notifyBtn.disabled = true;
    if (landingNotifyBtn) landingNotifyBtn.disabled = true;
    try {
      await enableNotifications(registration);
    } catch (error) {
      console.error(error);
      alert("Could not enable notifications. Please try again.");
    } finally {
      notifyBtn.disabled = false;
      if (landingNotifyBtn) landingNotifyBtn.disabled = false;
    }
  };

  notifyBtn?.addEventListener("click", () => void clickHandler());
  landingNotifyBtn?.addEventListener("click", () => void clickHandler());
}

function initializeMode() {
  const hasToken = Boolean(token);
  if (approvalPageEl) approvalPageEl.style.display = hasToken ? "block" : "none";
  if (landingPageEl) landingPageEl.style.display = hasToken ? "none" : "block";
}

initializeMode();
void initializePushUi();

approveBtn?.addEventListener("click", () => void approve());
fundBtn?.addEventListener("click", () => void fundWallet());
rejectBtn?.addEventListener("click", () => void reject());

if (token) {
  void loadApproval();
}

// Handle messages from service worker when app is already open
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener("message", (event) => {
    const { type, approvalUrl } = event.data || {};
    if ((type === "new-intent" || type === "navigate-approval") && approvalUrl) {
      // Navigate to the approval URL to load the new intent
      window.location.href = approvalUrl;
    }
  });
}
