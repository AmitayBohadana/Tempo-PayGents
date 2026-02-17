const params = new URLSearchParams(window.location.search);

const DEFAULT_USDC_BY_CHAIN = {
  1: "0xA0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", // Ethereum
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bDa02913", // Base
  11155111: "0x1c7d4b196cb0c7b01d743fbc6116a902379c7238", // Sepolia
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCf7e" // Base Sepolia
};

const EXPLORER_BY_CHAIN = {
  1: "https://etherscan.io/tx/",
  8453: "https://basescan.org/tx/",
  11155111: "https://sepolia.etherscan.io/tx/",
  84532: "https://sepolia.basescan.org/tx/"
};

const chainId = Number(params.get("chainId") || 8453);
const decimals = Number(params.get("decimals") || 6);
const symbol = String(params.get("symbol") || "USDC");
const to = String(params.get("to") || "").trim();
const amount = String(params.get("amount") || "").trim();
const token = String(params.get("token") || DEFAULT_USDC_BY_CHAIN[chainId] || "").trim();

const summaryAmountEl = document.getElementById("summary-amount");
const summaryChainEl = document.getElementById("summary-chain");
const summaryToEl = document.getElementById("summary-to");
const summaryTokenEl = document.getElementById("summary-token");
const statusEl = document.getElementById("status");
const metamaskLinkEl = document.getElementById("metamask-link");
const payInjectedBtn = document.getElementById("pay-injected-btn");
const copyPageBtn = document.getElementById("copy-page-btn");

function setStatus(message, kind = "") {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`.trim();
}

function isHexAddress(value) {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

function parseDecimalToUnits(value, tokenDecimals) {
  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error("Invalid amount format.");
  }

  const [whole, fractionRaw = ""] = value.split(".");
  if (fractionRaw.length > tokenDecimals) {
    throw new Error(`Amount has more than ${tokenDecimals} decimals.`);
  }
  const fraction = (fractionRaw + "0".repeat(tokenDecimals)).slice(0, tokenDecimals);
  const scale = 10n ** BigInt(tokenDecimals);
  return BigInt(whole) * scale + BigInt(fraction || "0");
}

function shortAddress(value) {
  if (typeof value !== "string" || value.length < 12) return value;
  return `${value.slice(0, 8)}...${value.slice(-6)}`;
}

function encodeTransferCall(recipient, amountBaseUnits) {
  const selector = "a9059cbb";
  const toArg = recipient.toLowerCase().replace(/^0x/, "").padStart(64, "0");
  const amountArg = amountBaseUnits.toString(16).padStart(64, "0");
  return `0x${selector}${toArg}${amountArg}`;
}

const hasValidInputs =
  Number.isFinite(chainId) &&
  chainId > 0 &&
  Number.isFinite(decimals) &&
  decimals >= 0 &&
  isHexAddress(token) &&
  isHexAddress(to) &&
  amount.length > 0;

let amountBaseUnits = 0n;
try {
  if (hasValidInputs) {
    amountBaseUnits = parseDecimalToUnits(amount, decimals);
  }
} catch (error) {
  setStatus(error instanceof Error ? error.message : "Invalid request.", "err");
}

if (summaryAmountEl) {
  summaryAmountEl.textContent = hasValidInputs ? `${amount} ${symbol}` : "Invalid query";
}
if (summaryChainEl) {
  summaryChainEl.textContent = String(chainId);
}
if (summaryToEl) {
  summaryToEl.textContent = to || "-";
}
if (summaryTokenEl) {
  summaryTokenEl.textContent = token || "-";
}

let metamaskLink = "#";
if (hasValidInputs && amountBaseUnits >= 0n) {
  metamaskLink = `https://link.metamask.io/send/${token}@${chainId}/transfer?address=${to}&uint256=${amountBaseUnits.toString()}`;
  setStatus("Ready. Open in MetaMask, or use Rabby/Injected Wallet button.", "");
} else {
  setStatus("Missing or invalid query params. Require: to, amount, chainId, token.", "err");
}

if (metamaskLinkEl) {
  metamaskLinkEl.href = metamaskLink;
  metamaskLinkEl.setAttribute("rel", "noopener");
  if (!hasValidInputs) metamaskLinkEl.style.pointerEvents = "none";
}

copyPageBtn?.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(window.location.href);
    setStatus("Page link copied.", "ok");
  } catch {
    setStatus("Clipboard copy failed on this browser.", "err");
  }
});

payInjectedBtn?.addEventListener("click", async () => {
  if (!hasValidInputs) {
    setStatus("Cannot submit: invalid payment parameters.", "err");
    return;
  }

  const provider = window.ethereum;
  if (!provider || typeof provider.request !== "function") {
    setStatus(
      "No injected wallet found. Open this URL inside Rabby app or use the MetaMask button.",
      "err"
    );
    return;
  }

  payInjectedBtn.disabled = true;
  try {
    setStatus("Requesting wallet connection...", "");
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const from = Array.isArray(accounts) ? accounts[0] : null;
    if (!from || !isHexAddress(from)) {
      throw new Error("Wallet did not return an account.");
    }

    const targetChainHex = `0x${chainId.toString(16)}`;
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: targetChainHex }]
      });
    } catch (switchError) {
      const code =
        typeof switchError === "object" &&
        switchError !== null &&
        "code" in switchError
          ? Number(switchError.code)
          : 0;
      if (code === 4902) {
        throw new Error(`Chain ${chainId} is not configured in wallet.`);
      }
      throw switchError;
    }

    setStatus("Awaiting wallet confirmation...", "");
    const txHash = await provider.request({
      method: "eth_sendTransaction",
      params: [
        {
          from,
          to: token,
          data: encodeTransferCall(to, amountBaseUnits)
        }
      ]
    });

    const explorerBase = EXPLORER_BY_CHAIN[chainId];
    if (typeof txHash === "string" && /^0x[a-fA-F0-9]{64}$/.test(txHash)) {
      if (explorerBase) {
        setStatus(`Submitted: ${explorerBase}${txHash}`, "ok");
      } else {
        setStatus(`Submitted tx: ${txHash}`, "ok");
      }
    } else {
      setStatus("Transaction submitted.", "ok");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Wallet submission failed.";
    setStatus(message, "err");
  } finally {
    payInjectedBtn.disabled = false;
  }
});
