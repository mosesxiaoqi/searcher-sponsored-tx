import {
  FlashbotsBundleProvider, FlashbotsBundleRawTransaction,
  FlashbotsBundleResolution,
  FlashbotsBundleTransaction
} from "@flashbots/ethers-provider-bundle";
import { BigNumber, providers, Wallet } from "ethers";
import { Base } from "./engine/Base";
import { checkSimulation, gasPriceToGwei, printTransactions } from "./utils";
import { Approval721 } from "./engine/Approval721";

require('log-timestamp');

const BLOCKS_IN_FUTURE = 2;

// 将整数 10 转换为 BigNumber 类型，然后调用 pow 方法，将 10 的 9 次方转换为 BigNumber 类型。
// 这是因为以太坊中的 gasPrice 是以 Gwei 为单位的，而 Gwei 是 10 的 9 次方。
const GWEI = BigNumber.from(10).pow(9);
// .mul(31)：将 GWEI 乘以 31，得到 31 Gwei。
// PRIORITY_GAS_PRICE 表示交易的优先级费用
const PRIORITY_GAS_PRICE = GWEI.mul(31)

const PRIVATE_KEY_EXECUTOR = process.env.PRIVATE_KEY_EXECUTOR || ""
const PRIVATE_KEY_SPONSOR = process.env.PRIVATE_KEY_SPONSOR || ""
const FLASHBOTS_RELAY_SIGNING_KEY = process.env.FLASHBOTS_RELAY_SIGNING_KEY || "";
const RECIPIENT = process.env.RECIPIENT || ""

if (PRIVATE_KEY_EXECUTOR === "") {
  console.warn("Must provide PRIVATE_KEY_EXECUTOR environment variable, corresponding to Ethereum EOA with assets to be transferred")
  process.exit(1)
}
if (PRIVATE_KEY_SPONSOR === "") {
  console.warn("Must provide PRIVATE_KEY_SPONSOR environment variable, corresponding to an Ethereum EOA with ETH to pay miner")
  process.exit(1)
}
if (FLASHBOTS_RELAY_SIGNING_KEY === "") {
  console.warn("Must provide FLASHBOTS_RELAY_SIGNING_KEY environment variable. Please see https://github.com/flashbots/pm/blob/main/guides/flashbots-alpha.md")
  process.exit(1)
}
if (RECIPIENT === "") {
  console.warn("Must provide RECIPIENT environment variable, an address which will receive assets")
  process.exit(1)
}

async function main() {
  //用于对 Flashbots Bundle 进行签名，以通过 Flashbots Relay（中继服务）的身份验证
  const walletRelay = new Wallet(FLASHBOTS_RELAY_SIGNING_KEY)

  // ======= UNCOMMENT FOR GOERLI ==========
  //创建一个 InfuraProvider 实例，用于连接到以太坊 Goerli 测试网（链 ID 为 5
  const provider = new providers.InfuraProvider(5, process.env.INFURA_API_KEY || '');
  const flashbotsProvider = await FlashbotsBundleProvider.create(provider, walletRelay, 'https://relay-goerli.epheph.com/');
  // ======= UNCOMMENT FOR GOERLI ==========

  // ======= UNCOMMENT FOR MAINNET ==========
  // const ETHEREUM_RPC_URL = process.env.ETHEREUM_RPC_URL || "http://127.0.0.1:8545"
  // const provider = new providers.StaticJsonRpcProvider(ETHEREUM_RPC_URL);
  // const flashbotsProvider = await FlashbotsBundleProvider.create(provider, walletRelay);
  // ======= UNCOMMENT FOR MAINNET ==========

  const walletExecutor = new Wallet(PRIVATE_KEY_EXECUTOR);
  const walletSponsor = new Wallet(PRIVATE_KEY_SPONSOR);

  const block = await provider.getBlock("latest")

  // ======= UNCOMMENT FOR ERC20 TRANSFER ==========
  // const tokenAddress = "0x4da27a545c0c5B758a6BA100e3a049001de870f5";
  // const engine: Base = new TransferERC20(provider, walletExecutor.address, RECIPIENT, tokenAddress);
  // ======= UNCOMMENT FOR ERC20 TRANSFER ==========

  // ======= UNCOMMENT FOR 721 Approval ==========
    //对于 ERC-721 NFT，我们需要授权一个地址来管理我们的 NFT。这个地址可以是一个智能合约，也可以是一个 EOA。
    //RECIPIENT是被授权的地址，即接收 setApprovalForAll 权限的账户。
    //HASHMASKS_ADDRESS是我们要授权的 ERC-721 合约地址。
  const HASHMASKS_ADDRESS = "0xC2C747E0F7004F9E8817Db2ca4997657a7746928";
  const engine: Base = new Approval721(RECIPIENT, [HASHMASKS_ADDRESS]);
  // ======= UNCOMMENT FOR 721 Approval ==========

  //返回一个数组，其中包含的是对NFT合约进行setApprovalForAll（授权）的交易对象
  const sponsoredTransactions = await engine.getSponsoredTransactions();

  // 并行执行一组 Promise，并在所有 Promise 都已解决后返回一个解析后的 Promise 数组。
  // 并行执行了 sponsoredTransactions.map 迭代生成的多个 provider.estimateGas 调用
  const gasEstimates = await Promise.all(sponsoredTransactions.map(tx =>
    provider.estimateGas({
      ...tx,
      from: tx.from === undefined ? walletExecutor.address : tx.from
    }))
  )

  //reduce是将数组中的元素通过某种规则合并为一个值
  // (acc, cur) => acc.add(cur)是reduce的callback参数，acc是累加器，cur是当前值
  const gasEstimateTotal = gasEstimates.reduce((acc, cur) => acc.add(cur), BigNumber.from(0))

  // gas 价格 = 基础费用 + 优先费用
  const gasPrice = PRIORITY_GAS_PRICE.add(block.baseFeePerGas || 0);
  const bundleTransactions: Array<FlashbotsBundleTransaction | FlashbotsBundleRawTransaction> = [
    {
      transaction: {
        to: walletExecutor.address,
        gasPrice: gasPrice,
        value: gasEstimateTotal.mul(gasPrice),
        gasLimit: 21000,
      },
      signer: walletSponsor
    },
    ...sponsoredTransactions.map((transaction, txNumber) => {
      return {
        transaction: {
          ...transaction,
          gasPrice: gasPrice,
          gasLimit: gasEstimates[txNumber],
        },
        signer: walletExecutor,
      }
    })
  ]
  const signedBundle = await flashbotsProvider.signBundle(bundleTransactions)
  await printTransactions(bundleTransactions, signedBundle);
  const simulatedGasPrice = await checkSimulation(flashbotsProvider, signedBundle);

  console.log(await engine.description())

  console.log(`Executor Account: ${walletExecutor.address}`)
  console.log(`Sponsor Account: ${walletSponsor.address}`)
  console.log(`Simulated Gas Price: ${gasPriceToGwei(simulatedGasPrice)} gwei`)
  console.log(`Gas Price: ${gasPriceToGwei(gasPrice)} gwei`)
  console.log(`Gas Used: ${gasEstimateTotal.toString()}`)

  // on 监听区块事件
  provider.on('block', async (blockNumber) => {
    //新区块模拟交易
    const simulatedGasPrice = await checkSimulation(flashbotsProvider, signedBundle);
    //目标区块是当前区块加上 2
    const targetBlockNumber = blockNumber + BLOCKS_IN_FUTURE;
    console.log(`Current Block Number: ${blockNumber},   Target Block Number:${targetBlockNumber},   gasPrice: ${gasPriceToGwei(simulatedGasPrice)} gwei`)
    //发送交易
    const bundleResponse = await flashbotsProvider.sendBundle(bundleTransactions, targetBlockNumber);
    if ('error' in bundleResponse) {
      throw new Error(bundleResponse.error.message)
    }
    //等待交易完成
    const bundleResolution = await bundleResponse.wait()
    // 交易包成功被包含在目标区块中
    if (bundleResolution === FlashbotsBundleResolution.BundleIncluded) {
      console.log(`Congrats, included in ${targetBlockNumber}`)
      process.exit(0)
    // 目标区块已过，但交易未被包含
    } else if (bundleResolution === FlashbotsBundleResolution.BlockPassedWithoutInclusion) {
      console.log(`Not included in ${targetBlockNumber}`)
    // 账户 nonce 值过高，表示可能有其他交易已经执行
    } else if (bundleResolution === FlashbotsBundleResolution.AccountNonceTooHigh) {
      console.log("Nonce too high, bailing")
      process.exit(1)
    }
  })
}

main()
