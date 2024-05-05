import { MarketCache, PoolCache, COIN_ADDRESS } from './cache';
import { Listeners } from './listeners';
import { Connection, KeyedAccountInfo, Keypair, PublicKey } from '@solana/web3.js';
import { LIQUIDITY_STATE_LAYOUT_V4, MARKET_STATE_LAYOUT_V3, Token, TokenAmount } from '@raydium-io/raydium-sdk';
import { AccountLayout, getAssociatedTokenAddressSync } from '@solana/spl-token';
import WebSocket from 'ws';
import { Bot, BotConfig } from './bot';
import { DefaultTransactionExecutor, TransactionExecutor } from './transactions';
import {
  getToken,
  getWallet,
  logger,
  COMMITMENT_LEVEL,
  RPC_ENDPOINT,
  RPC_WEBSOCKET_ENDPOINT,
  PRE_LOAD_EXISTING_MARKETS,
  LOG_LEVEL,
  CHECK_IF_MUTABLE,
  CHECK_IF_MINT_IS_RENOUNCED,
  CHECK_IF_FREEZABLE,
  CHECK_IF_BURNED,
  QUOTE_MINT,
  MAX_POOL_SIZE,
  MIN_POOL_SIZE,
  QUOTE_AMOUNT,
  PRIVATE_KEY,
  USE_SNIPE_LIST,
  ONE_TOKEN_AT_A_TIME,
  AUTO_SELL_DELAY,
  MAX_SELL_RETRIES,
  AUTO_SELL,
  MAX_BUY_RETRIES,
  AUTO_BUY_DELAY,
  COMPUTE_UNIT_LIMIT,
  COMPUTE_UNIT_PRICE,
  CACHE_NEW_MARKETS,
  TAKE_PROFIT,
  STOP_LOSS,
  BUY_SLIPPAGE,
  SELL_SLIPPAGE,
  PRICE_CHECK_DURATION,
  PRICE_CHECK_INTERVAL,
  SNIPE_LIST_REFRESH_INTERVAL,
  TRANSACTION_EXECUTOR,
  CUSTOM_FEE,
  FILTER_CHECK_INTERVAL,
  FILTER_CHECK_DURATION,
  CONSECUTIVE_FILTER_MATCHES,
} from './helpers';

import { version } from './package.json';
import { fetchTransaction } from './listeners/transaction-v2';
import { WarpTransactionExecutor } from './transactions/warp-transaction-executor';
import { JitoTransactionExecutor } from './transactions/jito-rpc-transaction-executor';

const connection = new Connection(RPC_ENDPOINT, {
  wsEndpoint: RPC_WEBSOCKET_ENDPOINT,
  commitment: COMMITMENT_LEVEL,
});

const walletAddresses = COIN_ADDRESS
const seenSignatures = new Set();
const SOL_ADDRESS = 'So11111111111111111111111111111111111111112';
const USDC_ADDRESS = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

function printDetails(wallet: Keypair, quoteToken: Token, bot: Bot) {
  logger.info(`  
                                        ..   :-===++++-     
                                .-==+++++++- =+++++++++-    
            ..:::--===+=.=:     .+++++++++++:=+++++++++:    
    .==+++++++++++++++=:+++:    .+++++++++++.=++++++++-.    
    .-+++++++++++++++=:=++++-   .+++++++++=:.=+++++-::-.    
     -:+++++++++++++=:+++++++-  .++++++++-:- =+++++=-:      
      -:++++++=++++=:++++=++++= .++++++++++- =+++++:        
       -:++++-:=++=:++++=:-+++++:+++++====--:::::::.        
        ::=+-:::==:=+++=::-:--::::::::::---------::.        
         ::-:  .::::::::.  --------:::..                    
          :-    .:.-:::.                                    

          WARP DRIVE ACTIVATED 🚀🐟
          Made with ❤️ by humans.
          Version: ${version}                                          
  `);

  const botConfig = bot.config;

  logger.info('------- CONFIGURATION START -------');
  logger.info(`Wallet: ${wallet.publicKey.toString()}`);

  logger.info('- Bot -');

  logger.info(
    `Using ${TRANSACTION_EXECUTOR} executer: ${bot.isWarp || bot.isJito || (TRANSACTION_EXECUTOR === 'default' ? true : false)}`,
  );
  if (bot.isWarp || bot.isJito) {
    logger.info(`${TRANSACTION_EXECUTOR} fee: ${CUSTOM_FEE}`);
  } else {
    logger.info(`Compute Unit limit: ${botConfig.unitLimit}`);
    logger.info(`Compute Unit price (micro lamports): ${botConfig.unitPrice}`);
  }

  logger.info(`Single token at the time: ${botConfig.oneTokenAtATime}`);
  logger.info(`Pre load existing markets: ${PRE_LOAD_EXISTING_MARKETS}`);
  logger.info(`Cache new markets: ${CACHE_NEW_MARKETS}`);
  logger.info(`Log level: ${LOG_LEVEL}`);

  logger.info('- Buy -');
  logger.info(`Buy amount: ${botConfig.quoteAmount.toFixed()} ${botConfig.quoteToken.name}`);
  logger.info(`Auto buy delay: ${botConfig.autoBuyDelay} ms`);
  logger.info(`Max buy retries: ${botConfig.maxBuyRetries}`);
  logger.info(`Buy amount (${quoteToken.symbol}): ${botConfig.quoteAmount.toFixed()}`);
  logger.info(`Buy slippage: ${botConfig.buySlippage}%`);

  logger.info('- Sell -');
  logger.info(`Auto sell: ${AUTO_SELL}`);
  logger.info(`Auto sell delay: ${botConfig.autoSellDelay} ms`);
  logger.info(`Max sell retries: ${botConfig.maxSellRetries}`);
  logger.info(`Sell slippage: ${botConfig.sellSlippage}%`);
  logger.info(`Price check interval: ${botConfig.priceCheckInterval} ms`);
  logger.info(`Price check duration: ${botConfig.priceCheckDuration} ms`);
  logger.info(`Take profit: ${botConfig.takeProfit}%`);
  logger.info(`Stop loss: ${botConfig.stopLoss}%`);

  logger.info('- Snipe list -');
  logger.info(`Snipe list: ${botConfig.useSnipeList}`);
  logger.info(`Snipe list refresh interval: ${SNIPE_LIST_REFRESH_INTERVAL} ms`);

  if (botConfig.useSnipeList) {
    logger.info('- Filters -');
    logger.info(`Filters are disabled when snipe list is on`);
  } else {
    logger.info('- Filters -');
    logger.info(`Filter check interval: ${botConfig.filterCheckInterval} ms`);
    logger.info(`Filter check duration: ${botConfig.filterCheckDuration} ms`);
    logger.info(`Consecutive filter matches: ${botConfig.consecutiveMatchCount}`);
    logger.info(`Check renounced: ${botConfig.checkRenounced}`);
    logger.info(`Check freezable: ${botConfig.checkFreezable}`);
    logger.info(`Check burned: ${botConfig.checkBurned}`);
    logger.info(`Min pool size: ${botConfig.minPoolSize.toFixed()}`);
    logger.info(`Max pool size: ${botConfig.maxPoolSize.toFixed()}`);
  }

  logger.info('------- CONFIGURATION END -------');

  logger.info('Bot is running! Press CTRL + C to stop it.');
}

const runListener = async () => {
  logger.level = LOG_LEVEL;
  logger.info('Bot is starting...');

  const marketCache = new MarketCache(connection);
  const poolCache = new PoolCache();
  let txExecutor: TransactionExecutor;

  switch (TRANSACTION_EXECUTOR) {
    case 'warp': {
      txExecutor = new WarpTransactionExecutor(CUSTOM_FEE);
      break;
    }
    case 'jito': {
      txExecutor = new JitoTransactionExecutor(CUSTOM_FEE, connection);
      break;
    }
    default: {
      txExecutor = new DefaultTransactionExecutor(connection);
      break;
    }
  }

  const wallet = getWallet(PRIVATE_KEY.trim());
  const quoteToken = getToken(QUOTE_MINT);
  const botConfig = <BotConfig>{
    wallet,
    quoteAta: getAssociatedTokenAddressSync(quoteToken.mint, wallet.publicKey),
    checkRenounced: CHECK_IF_MINT_IS_RENOUNCED,
    checkFreezable: CHECK_IF_FREEZABLE,
    checkBurned: CHECK_IF_BURNED,
    minPoolSize: new TokenAmount(quoteToken, MIN_POOL_SIZE, false),
    maxPoolSize: new TokenAmount(quoteToken, MAX_POOL_SIZE, false),
    quoteToken,
    quoteAmount: new TokenAmount(quoteToken, QUOTE_AMOUNT, false),
    oneTokenAtATime: ONE_TOKEN_AT_A_TIME,
    useSnipeList: USE_SNIPE_LIST,
    autoSell: AUTO_SELL,
    autoSellDelay: AUTO_SELL_DELAY,
    maxSellRetries: MAX_SELL_RETRIES,
    autoBuyDelay: AUTO_BUY_DELAY,
    maxBuyRetries: MAX_BUY_RETRIES,
    unitLimit: COMPUTE_UNIT_LIMIT,
    unitPrice: COMPUTE_UNIT_PRICE,
    takeProfit: TAKE_PROFIT,
    stopLoss: STOP_LOSS,
    buySlippage: BUY_SLIPPAGE,
    sellSlippage: SELL_SLIPPAGE,
    priceCheckInterval: PRICE_CHECK_INTERVAL,
    priceCheckDuration: PRICE_CHECK_DURATION,
    filterCheckInterval: FILTER_CHECK_INTERVAL,
    filterCheckDuration: FILTER_CHECK_DURATION,
    consecutiveMatchCount: CONSECUTIVE_FILTER_MATCHES,
  };

  const bot = new Bot(connection, marketCache, poolCache, txExecutor, botConfig);
  const valid = await bot.validate();

  if (!valid) {
    logger.info('Bot is exiting...');
    process.exit(1);
  }

  if (PRE_LOAD_EXISTING_MARKETS) {
    await marketCache.init({ quoteToken });
  }

  const runTimestamp = Math.floor(new Date().getTime() / 1000);
  const listeners = new Listeners(connection);
  await listeners.start({
    walletPublicKey: wallet.publicKey,
    quoteToken,
    autoSell: AUTO_SELL,
    cacheNewMarkets: CACHE_NEW_MARKETS,
  });

  // listeners.on('market', (updatedAccountInfo: KeyedAccountInfo) => {
  //   const marketState = MARKET_STATE_LAYOUT_V3.decode(updatedAccountInfo.accountInfo.data);
  //   marketCache.save(updatedAccountInfo.accountId.toString(), marketState);
  // });

  // listeners.on('pool', async (updatedAccountInfo: KeyedAccountInfo) => {
  //   const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(updatedAccountInfo.accountInfo.data);
  //   const poolOpenTime = parseInt(poolState.poolOpenTime.toString());
  //   const exists = await poolCache.get(poolState.baseMint.toString());

  //   if (!exists && poolOpenTime > runTimestamp) {
  //     poolCache.save(updatedAccountInfo.accountId.toString(), poolState);
  //     await bot.buy(updatedAccountInfo.accountId, poolState);
  //   }
  // });
  wsCoin(bot, poolCache);

  listeners.on('wallet', async (updatedAccountInfo: KeyedAccountInfo) => {
    const accountData = AccountLayout.decode(updatedAccountInfo.accountInfo.data);

    if (accountData.mint.equals(quoteToken.mint)) {
      return;
    }

    await bot.sell(updatedAccountInfo.accountId, accountData);
  });

  printDetails(wallet, quoteToken, bot);
};

async function wsCoin(bot: Bot, poolCache: PoolCache): Promise<void> {
  let count = 0;
  const uri = "wss://api.mainnet-beta.solana.com";
  const ws = new WebSocket(uri);

  ws.on('open', async () => {
    for (const address of walletAddresses) {
      const subscriptionRequest = {
        jsonrpc: "2.0",
        id: 1,
        method: "logsSubscribe",
        params: [
          { "mentions": [address] },
          { "commitment": "finalized" }
        ]
      };
      ws.send(JSON.stringify(subscriptionRequest));
    }

    // 定期发送心跳包，维持连接
    setInterval(() => {
      ws.send(JSON.stringify({ method: "ping" }));
    }, 30000); // 每30秒发送一次心跳包
  });


  ws.on('message', async (data: string) => {
    const response = JSON.parse(data);

    if (response.result) {
      console.log("Subscription successful. Subscription ID: ", response.result);
    } else if (response.params && response.params.result && response.params.result.value && response.params.result.value.err == null) {
      const signature = response.params.result.value.signature;
      count++;
      // 获取当前日期和时间
      const currentDate = new Date();
      // 格式化日期为 "年-月-日" 的形式
      const formattedDate = `${currentDate.getFullYear()}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}-${currentDate.getDate().toString().padStart(2, '0')}`;
      // 格式化时间为 "时:分:秒" 的形式
      const formattedTime = `${currentDate.getHours().toString().padStart(2, '0')}:${currentDate.getMinutes().toString().padStart(2, '0')}:${currentDate.getSeconds().toString().padStart(2, '0')}`;
      console.log(`============================================================================================${count}-New update received on ${formattedDate} ${formattedTime} ============================================================================================`);
      console.log(`Transaction signature: https://solscan.io/tx/${signature}`);
      await processCoinSwapActivity(signature, bot, poolCache)
      console.log(`============================================================================================${count}-New update received on ${formattedDate} ${formattedTime} ============================================================================================`);

    } else {
      // Unexpected response
      console.log("Unexpected response: ", response);
    }
  });


  ws.on('error', (err: Error) => {
    console.error('WebSocket error:', err);
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
    // 连接关闭时重新运行程序
    runListener();
  });
}

async function processCoinSwapActivity(signature: string, bot: Bot, poolCache: PoolCache) {
  let item_activity = await getCoinSwapInfo(signature);

  if (item_activity && Object.keys(item_activity).length !== 0) {
    let ammId = item_activity.data.amm_id;

    if (item_activity.data.token_1 === SOL_ADDRESS || item_activity.data.token_1 === USDC_ADDRESS) {
      const pool_info = await connection.getAccountInfoAndContext(new PublicKey(ammId))
      const poolState = LIQUIDITY_STATE_LAYOUT_V4.decode(pool_info.value!.data);

      if (!seenSignatures.has(ammId)) {
        seenSignatures.add(ammId);

        if (poolState.baseMint.toString() === SOL_ADDRESS || poolState.baseMint.toString() === USDC_ADDRESS) {
          let baseMint = poolState.quoteMint.toString();
          let quoteMint = poolState.baseMint.toString();
          let baseVault = poolState.quoteVault.toString();
          let quoteVault = poolState.baseVault.toString();
          console.log(`baseMint: ${baseMint}, quoteMint: ${quoteMint}, baseVault: ${baseVault}, quoteVault: ${quoteVault}`);
          poolState.quoteMint = new PublicKey(quoteMint);
          poolState.baseMint = new PublicKey(baseMint);
          poolState.quoteVault = new PublicKey(quoteVault);
          poolState.baseVault = new PublicKey(baseVault);
        }

        const exists = await poolCache.get(poolState.baseMint.toString());
        if (!exists) {
          {
            poolCache.save(poolState.baseMint.toString(), poolState);
            await bot.buy(new PublicKey(ammId), poolState);
          }
        }
      }
    }
  }

  async function getCoinSwapInfo(signature: string) {
    const coin_swap_info = await fetchTransaction(signature);
    console.log('区块：', coin_swap_info.data.block_id);
    if (coin_swap_info.success && coin_swap_info.data) {
      if (coin_swap_info.data.tokens_involved.length > 0) {
        let parsed_instructions = coin_swap_info.data.parsed_instructions || []
        let inner_instructions = coin_swap_info.data.inner_instructions || []
        let item_activity: any = {}
        let item_parsed_instructions: any = {}


        let activityTypes = ["token_swap", "defi_token_swap"];
        parsed_instructions.filter((item: any) => {

          let item_filter_inner_instructions = item.inner_instructions
          if (item_filter_inner_instructions && item_filter_inner_instructions.length !== 0) {
            item_filter_inner_instructions.filter((item_filter: any) => {
              return item_filter.activities.find((activity: any) => {
                if (activity.name === "RaydiumTokenSwap" && activityTypes.includes(activity.activity_type)) {
                  item_activity = activity
                  item_parsed_instructions = item_filter
                  return true;
                }
              });
            })
          }

          if (item.activities && item.activities.length > 0) {
            return item.activities.find((activity: any) => {
              if (activity.name === "RaydiumTokenSwap" && activityTypes.includes(activity.activity_type)) {
                item_activity = activity
                item_parsed_instructions = item
                return true;
              }
            });
          }
          return false;
        });


        inner_instructions.filter((item: any) => {
          if (item.activities && item.activities.length > 0) {
            return item.activities.find((activity: any) => {
              if (activity.name === "RaydiumTokenSwap" && activityTypes.includes(activity.activity_type)) {
                item_activity = activity
                item_parsed_instructions = item
                return true;
              }
              return false;
            });
          }
          return false;
        });

        return item_activity;
      }
    }
    return null;
  }
}

runListener();