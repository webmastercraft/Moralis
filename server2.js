const Web3 = require("web3");
const axios = require("axios");
const { exit } = require("process");
const express = require("express");
const cors = require("cors");
const Moralis = require("moralis/node");

const app = express();

app.use(cors());

let PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running at (http://localhost:${PORT})`);
});

app.get("/history", function (req, res) {
  const data = req.query;
  getHistory(data).then((data) => res.send(data));
});

const serverUrl = "https://8dyuriovbupo.usemoralis.com:2053/server";
const appId = "rLSZFQmw1hUwtAjRnjZnce5cxu1qcPJzy01TuyU1";
Moralis.start({ serverUrl, appId });

// const _zeroAddress = '0x0000000000000000000000000000000000000000';
const _transferTopic =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const chainCoins = {
  polygon: {
    name: "Wrapped Matic",
    decimals: 18,
    symbol: "WMATIC",
    address: "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270",
  },
  eth: {
    name: "Wrapped Ether",
    decimals: 18,
    symbol: "WETH",
    address: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  },
  bsc: {
    name: "Wrapped BNB",
    decimals: 18,
    symbol: "WBNB",
    address: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
  },
};

let testData = {
  wallet: "0x704111eDBee29D79a92c4F21e70A5396AEDCc44a",
  token: "0x510d776fea6469531f8be69e669e553c0de69621",
  blockheight: 20138207,
  chain: "polygon",
};

function sortBlockNumber_reverseChrono(a, b) {
  if (a.block_number > b.block_number) {
    return -1;
  }
  if (a.block_number < b.block_number) {
    return 1;
  }
  return 0;
}

async function getWalletCostBasis(data) {
  let returnData = [];

  //Get global data
  await Promise.all([
    getTokenBalances(data.chain, data.wallet.toLowerCase(), data.blockheight),
    getTokenTransfers(data.chain, data.wallet.toLowerCase(), data.blockheight),
    getTransactions(data.chain, data.wallet.toLowerCase(), data.blockheight),
  ]).then((result) => {
    global_balances = result[0];
    global_transfers = result[1];
    global_tx = result[2];
  });

  //Copy native transfers to ERC20 transfers
  native_xfers = global_tx.result.filter((xfer) => xfer.value > 0);
  for (let i = 0; i < native_xfers.length; i++) {
    const tx = native_xfers[i];
    global_transfers.result.push({
      address: chainCoins[data.chain].address, //token address = wmatic
      block_hash: tx.block_hash,
      block_number: tx.block_number,
      block_timestamp: tx.block_timestamp,
      from_address: tx.from_address,
      to_address: tx.to_address,
      transaction_hash: tx.hash,
      value: tx.value, //tx value
    });
  }
  global_transfers.result = global_transfers.result.sort(
    sortBlockNumber_reverseChrono
  );
  //Sort global_transfers reverse-chronological by block_number

  //Get token metadata
  var token_list = global_transfers.result.map((xfer) => xfer.address);
  token_list.push(chainCoins[data.chain].address); //add native token
  token_list = Array.from(new Set(token_list)); //de-dupe
  global_token_meta = await getTokenMetadata(data.chain, token_list);

  //If token specified in request, just do that token instead of the whole wallet
  if (data.token) {
    global_balances = global_balances.filter(
      (each) => each.token_address == data.token
    );
  }

  //Run cost basis for illiquid tokens
  //TODO: Make this loop asynchronous using Promise.allSettled
  for (let i = 0; i < global_balances.length; i++) {
    const price = await getTokenPrice(
      data.chain,
      global_balances[i].token_address,
      data.blockheight
    );
    if (price) {
      //Liquid token
      global_balances[i].usdPrice = price.usdPrice;
    } else {
      //Illiquid token
      global_balances[i].usdPrice = null;
      const tokenHistory = await getTokenCostBasis(
        data.chain,
        data.blockheight,
        data.wallet.toLowerCase(),
        global_balances[i].token_address,
        global_balances[i].balance / 10 ** global_balances[i].decimals,
        1
      );
      returnData.push(tokenHistory);
    }
  }

  return returnData;
}

//Test case
getWalletCostBasis(testData).then(console.log);

//getHistory(testData).then(console.log);

async function getTokenCostBasis(
  chain,
  block,
  wallet,
  token,
  token_balance_ending,
  hierarchy_level
) {
  console.log(
    "Cost basis for: Token:" +
      token +
      " Block:" +
      block +
      " token_balance_ending: " +
      token_balance_ending
  );
  let cost_basis = 0;

  let price = await getTokenPrice(chain, token, block);
  if (price) {
    cost_basis = token_balance_ending * price.usdPrice;
    console.log("Token: " + token + " Cost= " + cost_basis);
    return cost_basis;
  }

  //Retrieve transactions in token A
  var hist_xfers = global_transfers.result.filter(
    (xfer) => xfer.address == token && xfer.used == undefined
  );

  //Get cost basis for each transaction
  for (const transfer of hist_xfers) {
    transfer.used = true;
    if (transfer.from_address.toLowerCase() == wallet) {
      var sign = -1; //from my wallet. debit outflow
    } else if (transfer.to_address.toLowerCase() == wallet) {
      var sign = 1; //to my wallet. credit inflow
    } else {
      console.log(
        "Error: wallet address " +
          wallet +
          " not found in transaction " +
          transfer.transation_hash
      );
      return;
    }
    //Find offsetting coins from same transaction
    var offsetting_coins = global_transfers.result.filter(
      (xfer) =>
        xfer.transaction_hash == transfer.transaction_hash &&
        xfer.used == undefined
    );
    if (sign == 1) {
      //main transaction is an inflow, so look for offsetting outflows
      offsetting_coins = offsetting_coins.filter(
        (xfer) => xfer.from_address.toLowerCase() == wallet
      );
    } else if (sign == -1) {
      //main transaction is an outflow, so look for offsetting inflows
      offsetting_coins = offsetting_coins.filter(
        (xfer) => xfer.to_address.toLowerCase() == wallet
      );
    }

    //Get cost basis of each offsetting token
    for (const offsetting_coin of offsetting_coins) {
      offsetting_coin.used = true;
      const coin_meta = global_token_meta.filter(
        (t) => t.address == offsetting_coin.address
      )[0];
      const token_balance_ending =
        offsetting_coin.value / 10 ** coin_meta.decimals;
      cost_basis +=
        sign *
        (await getTokenCostBasis(
          chain,
          offsetting_coin.block_number,
          wallet,
          offsetting_coin.address,
          token_balance_ending,
          hierarchy_level + 1
        ));
    }
  }

  return cost_basis;
}

// Moralis functions
async function getTokenMetadata(_chain, _tokenAddresses) {
  const options = { chain: _chain, addresses: _tokenAddresses };
  return await Moralis.Web3API.token.getTokenMetadata(options);
}

async function getTransactions(_chain, _tokenAddress, _toBlock) {
  let options = {
    chain: _chain,
    address: _tokenAddress,
    order: "desc",
  };
  if (_toBlock) options.to_block = _toBlock;
  return await Moralis.Web3API.account.getTransactions(options);
}

async function getTokenPrice(_chain, _address, _toBlock) {
  const options = { address: _address, chain: _chain, to_block: _toBlock };
  try {
    return await Moralis.Web3API.token.getTokenPrice(options);
  } catch (e) {
    return null;
  }
}

async function getTokenBalances(_chain, _address, _toBlock) {
  let options = { chain: _chain, address: _address };
  if (_toBlock) options.to_block = _toBlock;
  try {
    return await Moralis.Web3API.account.getTokenBalances(options);
  } catch (e) {
    return null;
  }
}

async function getTokenTransfers(_chain, _address, _toBlock) {
  let options = { address: _address, chain: _chain };
  if (_toBlock) options.to_block = _toBlock;
  try {
    return await Moralis.Web3API.account.getTokenTransfers(options);
  } catch (e) {
    return null;
  }
}
