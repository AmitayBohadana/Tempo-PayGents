const params = new URLSearchParams(window.location.search);
const token = params.get("token");

const gridEl = document.getElementById("intent-grid");
const approveBtn = document.getElementById("approve-btn");
const rejectBtn = document.getElementById("reject-btn");
const statusEl = document.getElementById("status");
const countdownEl = document.getElementById("countdown");

const PASSKEY_CREDENTIAL_KEY = "hvaw_passkey_credential_id";
const PASSKEY_USER_KEY = "hvaw_passkey_user_id";

let approval = null;
let countdownTimer = null;

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#b91c1c" : "#0f766e";
}

function renderField(label, value) {
  const field = document.createElement("div");
  field.className = "field";

  const labelEl = document.createElement("div");
  labelEl.className = "label";
  labelEl.textContent = label;

  const valueEl = document.createElement("div");
  valueEl.className = "value";
  valueEl.textContent = value;

  field.append(labelEl, valueEl);
  return field;
}

function renderApproval(data) {
  gridEl.innerHTML = "";
  gridEl.append(
    renderField("Intent ID", data.intentIdHuman),
    renderField("Item", data.itemName || "N/A"),
    renderField("Store", data.merchantName || "N/A"),
    renderField("Amount", data.amount),
    renderField("Token", data.token),
    renderField("Recipient", data.to),
    renderField("Memo", data.memo),
    renderField("Digest", data.digest)
  );
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
  if (existing) {
    return existing;
  }

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
  countdownEl.textContent = `Expires in ${minutes}m ${seconds}s`;

  if (remaining === 0) {
    approveBtn.disabled = true;
    rejectBtn.disabled = true;
    setStatus("Intent expired.", true);
    if (countdownTimer) {
      clearInterval(countdownTimer);
    }
  }
}

async function loadApproval() {
  if (!token) {
    setStatus("Missing approval token.", true);
    approveBtn.disabled = true;
    rejectBtn.disabled = true;
    return;
  }

  const response = await fetch(`/api/approval/${token}`);
  const body = await response.json();

  if (!response.ok) {
    setStatus(body.message || "Failed to load approval intent.", true);
    approveBtn.disabled = true;
    rejectBtn.disabled = true;
    return;
  }

  approval = body.approval;
  renderApproval(approval);
  updateCountdown();
  countdownTimer = setInterval(updateCountdown, 1000);
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
    payload.authenticatorData = bytesToBase64Url(
      new Uint8Array(response.authenticatorData)
    );
  }
  if ("signature" in response && response.signature) {
    payload.signature = bytesToBase64Url(new Uint8Array(response.signature));
  }
  if ("userHandle" in response && response.userHandle) {
    payload.userHandle = bytesToBase64Url(new Uint8Array(response.userHandle));
  }
  if ("attestationObject" in response && response.attestationObject) {
    payload.attestationObject = bytesToBase64Url(
      new Uint8Array(response.attestationObject)
    );
  }

  return btoa(JSON.stringify(payload));
}

async function createWebAuthnOwnerAuth(digest) {
  const search = new URLSearchParams(window.location.search);
  const demoMode = search.get("demo") === "1";

  if (!window.PublicKeyCredential) {
    if (demoMode) {
      return createDemoOwnerAuth(digest);
    }
    throw new Error("This browser does not support passkeys/WebAuthn.");
  }

  if (!window.isSecureContext) {
    if (demoMode) {
      return createDemoOwnerAuth(digest);
    }
    throw new Error(
      "Passkeys require HTTPS (or localhost). Open this page via HTTPS tunnel."
    );
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
          allowCredentials: [
            {
              id: base64UrlToBytes(existingCredentialId),
              type: "public-key"
            }
          ]
        }
      });

      if (assertion && assertion.type === "public-key") {
        const credential = /** @type {PublicKeyCredential} */ (assertion);
        const response = /** @type {AuthenticatorAssertionResponse} */ (
          credential.response
        );
        return buildWebAuthnArtifact(
          "webauthn-get",
          digest,
          existingCredentialId,
          response
        );
      }
    } catch {
      // Continue to registration flow when assertion is unavailable.
    }
  }

  const userId = base64UrlToBytes(getOrCreateUserId());
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "Human-Verified Agent Wallet (Demo)" },
      user: {
        id: userId,
        name: "owner@localhost",
        displayName: "Owner"
      },
      pubKeyCredParams: [
        { type: "public-key", alg: -7 },
        { type: "public-key", alg: -257 }
      ],
      timeout: 60000,
      authenticatorSelection: {
        userVerification: "required",
        residentKey: "preferred"
      },
      attestation: "none"
    }
  });

  if (!credential || credential.type !== "public-key") {
    throw new Error("WebAuthn credential creation failed");
  }

  const publicCredential = /** @type {PublicKeyCredential} */ (credential);
  const credentialId = bytesToBase64Url(new Uint8Array(publicCredential.rawId));
  localStorage.setItem(PASSKEY_CREDENTIAL_KEY, credentialId);

  const response = /** @type {AuthenticatorAttestationResponse} */ (
    publicCredential.response
  );
  return buildWebAuthnArtifact("webauthn-create", digest, credentialId, response);
}

async function approve() {
  if (!approval) {
    return;
  }

  approveBtn.disabled = true;
  rejectBtn.disabled = true;
  setStatus("Waiting for passkey/device auth...");

  let ownerAuth;
  try {
    ownerAuth = await createWebAuthnOwnerAuth(approval.digest);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Passkey flow failed";
    setStatus(message, true);
    approveBtn.disabled = false;
    rejectBtn.disabled = false;
    return;
  }

  setStatus("Authorizing payment intent...");
  const response = await fetch(`/api/approval/${token}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ownerAuth,
      digest: approval.digest
    })
  });

  const body = await response.json();
  if (!response.ok) {
    setStatus(body.message || "Approval failed.", true);
    approveBtn.disabled = false;
    rejectBtn.disabled = false;
    return;
  }

  const txHash = body.intent.txHash;
  if (txHash) {
    setStatus(`Approved and submitted. Tx hash: ${txHash}`);
  } else {
    setStatus(`Approved. Current status: ${body.intent.status}`);
  }
}

async function reject() {
  if (!approval) {
    return;
  }

  approveBtn.disabled = true;
  rejectBtn.disabled = true;
  setStatus("Rejecting...");

  const response = await fetch(`/api/approval/${token}/reject`, {
    method: "POST"
  });
  const body = await response.json();

  if (!response.ok) {
    setStatus(body.message || "Reject failed.", true);
    approveBtn.disabled = false;
    rejectBtn.disabled = false;
    return;
  }

  setStatus(`Rejected. Current status: ${body.intent.status}`);
}

approveBtn.addEventListener("click", () => {
  void approve();
});

rejectBtn.addEventListener("click", () => {
  void reject();
});

void loadApproval();
