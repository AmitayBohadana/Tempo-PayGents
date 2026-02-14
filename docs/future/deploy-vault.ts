import { readFile } from "node:fs/promises";
import path from "node:path";
import solc from "solc";
import {
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  getAddress,
  isHexString,
  keccak256,
  solidityPacked
} from "ethers";

interface VaultArtifact {
  abi: unknown[];
  bytecode: string;
}

async function main() {
  const rpcUrl = requiredEnv("EVM_RPC_URL");
  const deployerPrivateKey = requiredEnv("EVM_DEPLOYER_PRIVATE_KEY");
  const maxAmountBaseUnits = requiredEnv("MAX_AMOUNT_BASE_UNITS");
  const expectedChainId = Number(process.env.EVM_CHAIN_ID ?? process.env.CHAIN_ID ?? 42431);

  const ownerRef = resolveOwnerRef();
  const artifact = await compileVault();

  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  if (Number(network.chainId) !== expectedChainId) {
    throw new Error(
      `CHAIN_ID_MISMATCH expected=${expectedChainId} actual=${network.chainId.toString()}`
    );
  }

  const deployer = new Wallet(deployerPrivateKey, provider);
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, deployer);
  const contract = await factory.deploy(ownerRef, maxAmountBaseUnits);
  const receipt = await contract.deploymentTransaction()?.wait(1);

  console.log(
    JSON.stringify(
      {
        chainId: Number(network.chainId),
        deployer: deployer.address,
        ownerRef,
        maxAmountBaseUnits,
        vaultAddress: await contract.getAddress(),
        deployTxHash: contract.deploymentTransaction()?.hash ?? null,
        deployBlockNumber: receipt?.blockNumber ?? null
      },
      null,
      2
    )
  );
}

async function compileVault(): Promise<VaultArtifact> {
  const contractPath = path.join(process.cwd(), "contracts", "AgentGuardVault.sol");
  const source = await readFile(contractPath, "utf-8");

  const input = {
    language: "Solidity",
    sources: {
      "AgentGuardVault.sol": { content: source }
    },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: {
        "*": {
          "*": ["abi", "evm.bytecode.object"]
        }
      }
    }
  };

  const output = JSON.parse(solc.compile(JSON.stringify(input))) as {
    contracts?: Record<string, Record<string, { abi: unknown[]; evm?: { bytecode?: { object?: string } } }>>;
    errors?: Array<{ severity: string; formattedMessage: string }>;
  };

  const errors = output.errors?.filter((issue) => issue.severity === "error") ?? [];
  if (errors.length > 0) {
    throw new Error(errors.map((issue) => issue.formattedMessage).join("\n"));
  }

  const compiled = output.contracts?.["AgentGuardVault.sol"]?.["AgentGuardVault"];
  const bytecode = compiled?.evm?.bytecode?.object ?? "";
  if (!compiled?.abi || !bytecode) {
    throw new Error("Failed to compile AgentGuardVault");
  }

  return { abi: compiled.abi, bytecode: `0x${bytecode}` };
}

function resolveOwnerRef(): string {
  const explicitOwnerRef = process.env.OWNER_REF;
  if (explicitOwnerRef) {
    if (!isHexString(explicitOwnerRef, 32)) {
      throw new Error("OWNER_REF must be a 32-byte hex string");
    }
    return explicitOwnerRef.toLowerCase();
  }

  const ownerSignerPrivateKey = process.env.OWNER_SIGNER_PRIVATE_KEY;
  if (ownerSignerPrivateKey) {
    const ownerSigner = new Wallet(ownerSignerPrivateKey);
    return keccak256(solidityPacked(["address"], [ownerSigner.address]));
  }

  const relaySignerAddress = process.env.RELAY_SIGNER_ADDRESS;
  if (relaySignerAddress) {
    return keccak256(solidityPacked(["address"], [getAddress(relaySignerAddress)]));
  }

  throw new Error(
    "Provide OWNER_REF, OWNER_SIGNER_PRIVATE_KEY, or RELAY_SIGNER_ADDRESS before deployment"
  );
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
