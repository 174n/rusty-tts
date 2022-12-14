require('dotenv').config();
const fetch = require('node-fetch');
const RustPlus = require('@liamcottle/rustplus.js');
const fs = require('fs');
const path = require('path');
const Fuse = require('fuse.js');
const logger = require('../logger');
const fastify = require('fastify')({ logger: logger.config });
const { __ } = require('../i18n');

let items, fuse, itemsMap, rustInfo, rustMap;
const getAlpha = () => Array.from({ length: 26 }).map((_, i) => String.fromCharCode("A".charCodeAt() + i));
const gridX = [...getAlpha(), ...getAlpha().map(a => 'A' + a)];

const getGridPos = (x, y) => {
  if (!rustMap || !rustInfo)
    return 'A0';

  x = x * ((rustMap.width) / rustInfo.mapSize);
  y = rustMap.height - (y * ((rustMap.height) / rustInfo.mapSize));
  const gridSize = rustMap.width / 31;
  return gridX[Math.trunc(x / gridSize)] + Math.trunc(y / gridSize).toString();
}

const rustplus = new RustPlus(process.env.RUST_SERVER_IP, process.env.RUST_SERVER_PORT, process.env.RUST_USER_ID, process.env.RUST_USER_TOKEN);

const fetchShops = async () => {
  let map;
  try {
    map = await rustplus.sendRequestAsync({ getMapMarkers: {} });
  } catch (err) {
    logger.error(err);
    process.exit();
  }
  return map.mapMarkers.markers.filter(m => m.sellOrders);
}

rustplus.on('connected', () => {
  logger.log(__('rust.connected'));
  rustplus.sendTeamMessage(__('rust.hello'));
  rustplus.getInfo(info => {
    rustInfo = info.response.info;
  });
  rustplus.getMap(map => {
    fs.writeFileSync(path.join(__dirname, '..', 'cache', 'map.jpg'), Buffer.from(map.response.map.jpgImage, "base64"));
    rustMap = {};
    Object.keys(map.response.map).forEach(k => {
      if (!k.match(/jpg/g)) {
        rustMap[k] = map.response.map[k];
      }
    });
  })
});

rustplus.on('error', (err) => {
  logger.error(err.toString());
});

rustplus.on('message', async msg => {
  if (msg.response?.mapMarkers || msg.response?.map)
    return;
  logger.log(msg);
  const chatMsg = msg?.broadcast?.teamMessage?.message;
  if (chatMsg && chatMsg.name && chatMsg.message) {
    logger.log(__('rust.message') + JSON.stringify(chatMsg));
    try {
      await fetch(`${process.env.VOICE_API_ADDRESS}:${process.env.VOICE_API_PORT}/play/${encodeURIComponent(chatMsg.message)}`);
    } catch (err) {
      logger.error(__('rust.voiceError'));
    }
    await fetch(process.env.DISCORD_WEBHOOK, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        content: chatMsg.message,
        embeds: null,
        username: chatMsg.name, // sanitize maybe
        avatar_url: process.env.AVATAR_SOURCE + chatMsg.name,
        attachments: [],
        tts: false
      })
    });
  }
});

fastify.get('/', async (request, reply) => {
  return {
    version: require('../package.json').version,
    info: 'Rusty server',
    routes: ['GET /shops/:query', 'GET /message/:message', 'GET /sell/:query/:amount', 'GET /info']
  };
});

fastify.get('/message/:username/:message', async (request, reply) => {
  const message = request.params.message.replace(/[^A-z??-??????,.-?!@& ]/g, '').slice(0, 300);
  const username = request.params.username.replace(/[^A-z??-??????,.-?!@& ]/g, '').slice(0, 300);
  try {
    rustplus.sendTeamMessage(`<${username}> ${message}`);
    return { success: true };
  } catch (err) {
    logger.error(err);
    return { success: false };
  }
});

fastify.get('/info', async (request, reply) => {
  let info;
  try {
    info = (await rustplus.sendRequestAsync({ getInfo: {} }, 3000))?.info;
  } catch (err) {
    logger.error(err);
    process.exit();
  };
  return info;
});

fastify.get('/shops/:query', async (request, reply) => {
  const shops = await fetchShops();
  const query = request.params.query.replace(/[^A-z??-??????,.-?!@& ]/g, '').slice(0, 200);
  const foundItemIds = fuse.search(query).slice(0, 5).map(item => parseInt(item.item.id));
  const results = shops
    .filter(s => s.sellOrders.find(item => foundItemIds.includes(item.itemId)))
    .map(res => {
      return {
        name: res.name,
        x: res.x,
        y: res.y,
        square: getGridPos(res.x, res.y),
        items: res.sellOrders
          .map(o => ({
            item: itemsMap.get(o.itemId)?.displayName,
            itemId: o.itemId,
            image: itemsMap.get(o.itemId)?.image,
            quantity: o.quantity,
            currency: itemsMap.get(o.currencyId)?.displayName,
            currencyId: o.currencyId,
            costPerItem: o.costPerItem,
            amountInStock: o.amountInStock,
            itemIsBlueprint: o.itemIsBlueprint,
            currencyIsBlueprint: o.currencyIsBlueprint
          }))
          .filter(o => o.amountInStock > 0 && foundItemIds.includes(o.itemId))
      };
    })
    .filter(s => s.items.find(item => foundItemIds.includes(item.itemId)));
  return reply.code(200).send({ results: results, success: true });
});

fastify.get('/sell/:query/:amount', async (request, reply) => {
  const shops = await fetchShops();
  const query = request.params.query.replace(/[^A-z??-??????,.-?!@& ]/g, '').slice(0, 200);
  const amount = parseInt(request.params.amount);
  const foundItemIds = fuse.search(query).slice(0, 5).map(item => parseInt(item.item.id));
  const results = shops
    .filter(s => s.sellOrders.find(item => foundItemIds.includes(item.currencyId)))
    .map(res => {
      return {
        name: res.name,
        x: res.x,
        y: res.y,
        square: getGridPos(res.x, res.y),
        items: res.sellOrders
          .map(o => ({
            item: itemsMap.get(o.itemId)?.displayName,
            itemId: o.itemId,
            image: itemsMap.get(o.itemId)?.image,
            quantity: o.quantity,
            currency: itemsMap.get(o.currencyId)?.displayName,
            currencyId: o.currencyId,
            costPerItem: o.costPerItem,
            amountInStock: o.amountInStock,
            itemIsBlueprint: o.itemIsBlueprint,
            currencyIsBlueprint: o.currencyIsBlueprint
          }))
          .filter(o => o.amountInStock > 0 && foundItemIds.includes(o.currencyId) && o.costPerItem <= amount)
      };
    })
    .filter(s => s.items.find(item => foundItemIds.includes(item.currencyId)))
    .sort((a, b) => a.costPerItem - b.costPerItem);
  return reply.code(200).send({ results: results, success: true });
});

const init = async () => {
  const itemsUrl = 'https://gist.githubusercontent.com/Marcuzz/9e01a39a8f5f83dc673bfc6f6fa4aacc/raw/10429a847102811a243887b5ac48688f35bb3d64/items.json';
  const itemsPath = path.join(__dirname, '..', 'cache', 'items.json');

  try {
    fs.accessSync(itemsPath, fs.constants.F_OK)
  } catch (err) {
    items = await (await fetch(itemsUrl)).json();
    if (items?.length) {
      fs.writeFileSync(itemsPath, JSON.stringify(items));
    }
  }
  if (!items) {
    items = JSON.parse(fs.readFileSync(itemsPath));
  }
  itemsMap = items.reduce((a, it) => {
    a.set(parseInt(it.id), it);
    return a;
  }, new Map());

  fuse = new Fuse(items, {
    keys: ['displayName']
  });

  try {
    await fastify.listen({ port: process.env.RUSTY_API_PORT })
  } catch (err) {
    fastify.log.error(err)
    process.exit(1)
  }

  rustplus.connect();
}

init();