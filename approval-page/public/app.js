const params = new URLSearchParams(window.location.search);
const token = params.get("token");

const amountDisplay = document.getElementById("amount-display");
const itemNameEl = document.getElementById("item-name");
const merchantNameEl = document.getElementById("merchant-name");
const detailTo = document.getElementById("detail-to");
const detailToken = document.getElementById("detail-token");
const detailMemo = document.getElementById("detail-memo");
const detailIntent = document.getElementById("detail-intent");
const approveBtn = document.getElementById("approve-btn");
const rejectBtn = document.getElementById("reject-btn");
const statusEl = document.getElementById("status");
const countdownEl = document.getElementById("countdown");
const countdownBar = document.getElementById("countdown-bar");

const PASSKEY_CREDENTIAL_KEY = "hvaw_passkey_credential_id";
const PASSKEY_USER_KEY = "hvaw_passkey_user_id";

let approval = null;
let countdownTimer = null;

function setStatus(message, type = "info") {
  statusEl.textContent = message;
  statusEl.className = `status-msg ${type}`;
  statusEl.style.display = "inline-block";
}

function truncateAddress(addr) {
  if (!addr || addr.length < 12) return addr;
  return addr.slice(0, 6) + "…" + addr.slice(-4);
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

function getOrCreateUserId() {
  const existing = localStorage.getItem(PASSKEY_USER_KEY);
  if (existing) return existing;
  const generated = bytesToBase64Url(randomBytes(16));
  localStorage.setItem(PASSKEY_USER_KEY, generated);
  return generated;
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
    setStatus("Missing approval token.", "error");
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
  } catch (err) {
    setStatus("Failed to connect to server.", "error");
  }
}

function createDemoOwnerAuth(digest) {
  const artifact = {
    digest,
    approvedAt: new Date().toISOString(),
    method: "demo-owner-auth"
  };
  return btoa(JSON.stringify(artifact));
}

function buildWebAuthnArtifact(method, digest, credentialId, response) {
  const payload = {
    method,
    digest,
    approvedAt: new Date().toISOString(),
    credentialId,
    clientDataJSON: bytesToBase64Url(new Uint8Array(response.clientDataJSON))
  };

  if ("authenticatorData" in response && response.authenticatorData) {
    payload.authenticatorData = bytesToBase64Url(new Uint8Array(response.authenticatorData));
  }
  if ("signature" in response && response.signature) {
    payload.signature = bytesToBase64Url(new Uint8Array(response.signature));
  }
  if ("userHandle" in response && response.userHandle) {
    payload.userHandle = bytesToBase64Url(new Uint8Array(response.userHandle));
  }
  if ("attestationObject" in response && response.attestationObject) {
    payload.attestationObject = bytesToBase64Url(new Uint8Array(response.attestationObject));
  }

  return btoa(JSON.stringify(payload));
}

async function createWebAuthnOwnerAuth(digest) {
  const search = new URLSearchParams(window.location.search);
  const demoMode = search.get("demo") === "1";

  if (!window.isSecureContext) {
    if (demoMode) return createDemoOwnerAuth(digest);
    throw new Error("Passkeys require HTTPS (or localhost on same device). Open this page via HTTPS and not in an in-app browser.");
  }

  if (!window.PublicKeyCredential) {
    if (demoMode) return createDemoOwnerAuth(digest);
    throw new Error("Passkeys/WebAuthn API is unavailable. Try Safari/Chrome directly (not Telegram/Discord in-app browser).");
  }

  const challenge = hexToBytes(digest);
  const existingCredentialId = localStorage.getItem(PASSKEY_CREDENTIAL_KEY);

  if (existingCredentialId) {
    try {
      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          userVerification: "required",
          timeout: 60000,
          allowCredentials: [{ id: base64UrlToBytes(existingCredentialId), type: "public-key" }]
        }
      });

      if (assertion && assertion.type === "public-key") {
        const credential = /** @type {PublicKeyCredential} */ (assertion);
        const response = /** @type {AuthenticatorAssertionResponse} */ (credential.response);
        return buildWebAuthnArtifact("webauthn-get", digest, existingCredentialId, response);
      }
    } catch {
      // Fall through to registration
    }
  }

  const userId = base64UrlToBytes(getOrCreateUserId());
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "Agent Wallet" },
      user: { id: userId, name: "owner@wallet", displayName: "Owner" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      timeout: 60000,
      authenticatorSelection: { userVerification: "required", residentKey: "preferred" },
      attestation: "none"
    }
  });

  if (!credential || credential.type !== "public-key") {
    throw new Error("WebAuthn credential creation failed");
  }

  const publicCredential = /** @type {PublicKeyCredential} */ (credential);
  const credentialId = bytesToBase64Url(new Uint8Array(publicCredential.rawId));
  localStorage.setItem(PASSKEY_CREDENTIAL_KEY, credentialId);

  const response = /** @type {AuthenticatorAttestationResponse} */ (publicCredential.response);
  return buildWebAuthnArtifact("webauthn-create", digest, credentialId, response);
}

async function approve() {
  if (!approval) return;

  approveBtn.disabled = true;
  rejectBtn.disabled = true;
  setStatus("Waiting for passkey authentication…", "info");

  let ownerAuth;
  try {
    ownerAuth = await createWebAuthnOwnerAuth(approval.digest);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Passkey flow failed";
    setStatus(message, "error");
    approveBtn.disabled = false;
    rejectBtn.disabled = false;
    return;
  }

  setStatus("Submitting payment…", "info");

  const response = await fetch(`/api/approval/${token}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ownerAuth, digest: approval.digest })
  });

  const body = await response.json();
  if (!response.ok) {
    setStatus(body.message || "Approval failed.", "error");
    approveBtn.disabled = false;
    rejectBtn.disabled = false;
    return;
  }

  const txHash = body.intent.txHash;
  if (txHash) {
    setStatus(`✅ Payment executed! Tx: ${txHash.slice(0, 10)}…`, "success");
  } else {
    setStatus(`✅ Approved! Status: ${body.intent.status}`, "success");
  }

  if (countdownTimer) clearInterval(countdownTimer);
  countdownBar.style.display = "none";
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

approveBtn.addEventListener("click", () => void approve());
rejectBtn.addEventListener("click", () => void reject());

void loadApproval();
