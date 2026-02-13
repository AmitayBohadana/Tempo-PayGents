const params = new URLSearchParams(window.location.search);
const token = params.get("token");

const gridEl = document.getElementById("intent-grid");
const approveBtn = document.getElementById("approve-btn");
const rejectBtn = document.getElementById("reject-btn");
const statusEl = document.getElementById("status");
const countdownEl = document.getElementById("countdown");

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

async function approve() {
  if (!approval) {
    return;
  }

  approveBtn.disabled = true;
  rejectBtn.disabled = true;
  setStatus("Authorizing...");

  const ownerAuth = createDemoOwnerAuth(approval.digest);
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
