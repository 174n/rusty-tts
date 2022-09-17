require('dotenv').config();

// Discord
const { Client, GatewayIntentBits, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildVoiceStates] });
const { createAudioPlayer, joinVoiceChannel, createAudioResource, NoSubscriberBehavior } = require('@discordjs/voice');

// Utils
const { onShutdown } = require('node-graceful-shutdown');
const fetch = require('node-fetch');
const path = require('path');

// Local
const logger = require('../logger');
const genVoice = require('./gen-voice');

// HTTP
const fastify = require('fastify')({ logger: logger.config });


client.on('ready', () => {
  logger.log(`Logged in as ${client.user.tag}!`);
});

let voiceConnection, subscription;

const audioPlayer = createAudioPlayer({
  behaviors: {
    noSubscriber: NoSubscriberBehavior.Pause,
  },
});
audioPlayer.on('error', error => {
  logger.error(`Error: ${error.message} with resource ${error?.resource?.metadata?.title}`);
});

const play = async voicePath => {
  if (!voiceConnection) {
    logger.error('No voice connection');
    return false;
  }

  const resource = createAudioResource(voicePath);
  if (audioPlayer.checkPlayable(resource)) {
    subscription = voiceConnection.subscribe(audioPlayer);
  }
  logger.log(`Playing: ${voicePath}`);
  audioPlayer.play(resource);
  return true;
}

const commands = {
  JOINVOICE: 'joinvoice',
  LEAVEVOICE: 'leavevoice',
  DELETE: 'del',
  SEARCH_SHOPS: 'buy',
  SEARCH_SELL: 'sell',
  MAP: 'map'
}

const getEmbed = ({ color, title, text }) => new EmbedBuilder()
  .setColor(color)
  .setTitle(title)
  .setDescription(text)
  .setTimestamp()
  .setFooter({ text: 'Rusty TTS' });

client.on('messageCreate', async msg => {
  if (!msg?.content || msg.author?.bot || msg.author?.system)
    return;

  logger.log(msg?.content);
  const params = msg?.content?.slice(1)?.split(' ');

  if (!params || msg.content.slice(0, 1) !== process.env.DISCORD_PREFIX) {
    const message = msg.content.replace(/[^A-zА-яЁё0-9,.-?!@& ]+/g, '');
    const username = msg.author.username.replace(/[^A-zА-яЁё0-9,.-?!@& ]+/g, '');
    try {
      await fetch(`${process.env.RUSTY_API_ADDRESS}:${process.env.RUSTY_API_PORT}/message/${username}/${encodeURIComponent(message)}`);
    } catch (err) {
      logger.error(err);
      msg.reply({
        embeds: [
          getEmbed({
            color: 0xff5454,
            title: 'Error',
            text: 'The message is not delivered to the rust server'
          })
        ]
      });
    }
    return;
  }

  switch (params[0]) {
    case commands.JOINVOICE:
      if (!msg.member?.voice?.channel?.id) {
        msg.reply({
          embeds: [
            getEmbed({
              color: 0xff5454,
              title: 'Error',
              text: 'You have to join a voice channel first'
            })
          ]
        });
        break;
      }
      voiceConnection = joinVoiceChannel({
        channelId: msg.member?.voice.channel.id,
        guildId: msg.guildId,
        adapterCreator: msg.guild.voiceAdapterCreator
      });
      subscription = voiceConnection.subscribe(audioPlayer);

      setInterval(() => {
        if (msg.member?.voice.channel.members.length === 0)
          subscription.unsubscribe();
          voiceConnection.destroy();
      }, 1000 * 60 * 2);

      msg.reply({
        embeds: [
          getEmbed({
            color: 0x6854ff,
            title: 'Joined voice',
            text: `Successfully joined channel "${msg.member?.voice.channel.name}". Have a good time`
          }).setThumbnail('https://i.imgur.com/DjVpMJ5.jpg')
        ]
      });
      break;
    case commands.LEAVEVOICE:
      subscription.unsubscribe();
      voiceConnection.destroy();
      msg.reply({
        embeds: [
          getEmbed({
            color: 0x6854ff,
            title: 'Left the voice channel',
            text: `Leaving the voice channel. Come back soon`
          }).setThumbnail('https://i.imgur.com/rGD6aQH.jpg')
        ]
      });
      break;
    case commands.DELETE:
      if (msg?.author?.id === process.env.DESCORD_ADMIN_ID) {
        const count = parseInt(params[1].replace(/\D+/g, ''));
        if (!count || count <= 0)
          return;
        for (let i = count; i > 0; i -= 100) {
          const fetched = (await msg.channel.messages.fetch({ limit: i > 100 ? 100 : i })).filter(m => m);
          msg.channel.bulkDelete(fetched).catch(err => {
            msg.channel.send({
              embeds: [
                getEmbed({
                  color: 0xff5454,
                  title: 'Error',
                  text: 'There was some kind of error. Maybe the messages are older then 14 days or something'
                })
              ]
            });
          });
        }
        msg.delete();
        break;
      }
      msg.reply({
        embeds: [
          getEmbed({
            color: 0xff5454,
            title: 'Not allowed',
            text: 'You have to be an admin to do that'
          })
        ]
      });
      break;
    case commands.SEARCH_SHOPS:
      const query = params.slice(1).join(' ').replace(/[^A-zА-яЁё0-9 ]/g, '').slice(0, 200);
      let results;
      try {
        results = (await (await fetch(`${process.env.RUSTY_API_ADDRESS}:${process.env.RUSTY_API_PORT}/shops/${query}`)).json())?.results;
      } catch (err) {
        logger.error(err);
        msg.reply({
          embeds: [
            getEmbed({
              color: 0xff5454,
              title: 'Error',
              text: 'There was some kind of error'
            })
          ]
        });
        break;
      }
      if (!results?.length) {
        msg.reply({
          embeds: [
            getEmbed({
              color: 0xff5454,
              title: 'Error',
              text: `There was some kind of error (no results) for query "${query}"`
            })
          ]
        });
        break;
      }
      msg.reply({
        embeds: [
          getEmbed({
            color: 0x2eff00,
            title: `Results for query "${query}"`,
            text: `Found ${results.length} shops.`
          }).setThumbnail(results?.[0]?.items?.[0]?.image || 'https://i.imgur.com/s9qXIYM.jpg').addFields(
            results.map(r => ({
              name: `${r.name} (${r.square})`,
              value: r.items.map(item =>
                `${item.quantity} ${item.item}${item.itemIsBlueprint ? ' (BP)' : ''} for ${item.costPerItem} ${item.currency}${item.currencyIsBlueprint ? ' (BP)' : ''} (${item.amountInStock} in stock)`
              ).join(', ')
            }))
          )
        ]
      });
      break;
    case commands.SEARCH_SELL:
      const querySell = params.slice(1, -1).join(' ').replace(/[^A-zА-яЁё0-9 ]/g, '').slice(0, 200);
      const amount = parseInt(params[params.length - 1]);
      let resultsSell;
      try {
        resultsSell = (await (await fetch(`${process.env.RUSTY_API_ADDRESS}:${process.env.RUSTY_API_PORT}/sell/${querySell}/${amount}`)).json())?.results;
      } catch (err) {
        logger.error(err);
        msg.reply({
          embeds: [
            getEmbed({
              color: 0xff5454,
              title: 'Error',
              text: 'There was some kind of error'
            })
          ]
        });
        break;
      }
      if (!resultsSell?.length) {
        msg.reply({
          embeds: [
            getEmbed({
              color: 0xff5454,
              title: 'Error',
              text: `There was some kind of error (no results) for query "${querySell}"`
            })
          ]
        });
        break;
      }
      msg.reply({
        embeds: [
          getEmbed({
            color: 0xffaf30,
            title: `Results to sell ${amount} of "${querySell}"`,
            text: `Found ${resultsSell.length} shops.`
          }).setThumbnail(resultsSell?.[0]?.items?.[0]?.image || 'https://i.imgur.com/s9qXIYM.jpg').addFields(
            resultsSell.map(r => ({
              name: `${r.name} (${r.square})`,
              value: r.items.map(item =>
                `${item.quantity} ${item.item}${item.itemIsBlueprint ? ' (BP)' : ''} for ${item.costPerItem} ${item.currency}${item.currencyIsBlueprint ? ' (BP)' : ''} (${item.amountInStock} in stock)`
              ).join(', ')
            }))
          )
        ]
      });
      break;
    case commands.MAP:
      const file = new AttachmentBuilder(path.join(__dirname, '..', 'cache', 'map.jpg'));
      msg.reply({
        embeds: [
          getEmbed({
            color: 0x00ff11,
            title: 'World map',
            text: 'Here is your map'
          }).setImage('attachment://map.jpg')
        ],
        files: [file]
      });
      break;
    default:
      msg.reply({
        embeds: [
          getEmbed({
            color: 0xff5454,
            title: 'Command not found',
            text: 'Available commands: ' + Object.values(commands).join(', ')
          }).setThumbnail('https://i.imgur.com/UK4APa4.jpg')
        ]
      });
  }
});

fastify.get('/', async (request, reply) => {
  return {
    version: require('../package.json').version,
    info: 'Voice server',
    routes: ['GET /play/:text']
  };
});

fastify.get('/play/:text', async (request, reply) => {
  const text = request.params.text.replace(/[^A-zА-яЁё0-9,.-?!@& ]/g, '').replace(/<(.*?)> /g, '').slice(0, 500);
  try {
    const filePath = await genVoice.gen(text);
    play(filePath);
  } catch (err) {
    logger.error(err);
    return reply.code(500).send({ error: true });
  }
  return reply.code(200).send({ text, success: true });
});

const start = async () => {
  try {
    await fastify.listen({ port: process.env.VOICE_API_PORT });
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
}
start();

client.login(process.env.DISCORD_TOKEN);

// Graceful shutdown

onShutdown(async () => {
  subscription.unsubscribe();
  voiceConnection.destroy();
  client.destroy();
});