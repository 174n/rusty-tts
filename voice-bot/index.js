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

// Translation
const { __ } = require('../i18n');


client.on('ready', () => {
  logger.log(__('discord.loggedIn', { user: client.user.tag }));
});

let voiceConnection, subscription, voiceInterval;

const audioPlayer = createAudioPlayer({
  behaviors: {
    noSubscriber: NoSubscriberBehavior.Pause,
  },
});
audioPlayer.on('error', error => {
  logger.error(__('audioplayer.error', { error: error.message, ressource: error?.resource?.metadata?.title }));
});

const play = async voicePath => {
  if (!voiceConnection) {
    logger.error(__('audioplayer.noVoice'));
    return false;
  }

  const resource = createAudioResource(voicePath);
  if (audioPlayer.checkPlayable(resource)) {
    subscription = voiceConnection.subscribe(audioPlayer);
  }
  logger.log(__('audioplayer.playing', { file: voicePath }));
  audioPlayer.play(resource);
  return true;
}

const commands = {
  JOINVOICE: 'joinvoice',
  LEAVEVOICE: 'leavevoice',
  DELETE: 'del',
  SEARCH_SHOPS: 'buy',
  SEARCH_SELL: 'sell',
  MAP: 'map',
  INFO: 'info',
  RESTART_RUST: 'restart'
}

const getEmbed = ({ color, title, text }) => new EmbedBuilder()
  .setColor(color)
  .setTitle(title)
  .setDescription(text)
  .setTimestamp()
  .setFooter({ text: __('title') });

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
            title: __('discord.rustServerError.title'),
            text: __('discord.rustServerError.text')
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
              title: __('discord.joinVoiceError.title'),
              text: __('discord.joinVoiceError.text')
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

      if (voiceInterval)
        clearInterval(voiceInterval);

      voiceInterval = setInterval(() => {
        if (!msg.member?.voice.channel || msg.member?.voice.channel.members.length === 0) {
          subscription.unsubscribe();
          voiceConnection.destroy();
          clearInterval(voiceInterval);
        }
      }, 1000 * 60 * 2);

      msg.reply({
        embeds: [
          getEmbed({
            color: 0x6854ff,
            title: __('discord.joinVoiceSuccess.title'),
            text: __('discord.joinVoiceSuccess.text', { channel: msg.member?.voice.channel.name })
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
            title: __('discord.leaveChannel.title'),
            text: __('discord.leaveChannel.text')
          }).setThumbnail('https://i.imgur.com/j4l6U5t.jpg')
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
                  title: __('discord.deleteMessagesError.title'),
                  text: __('discord.deleteMessagesError.text')
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
            title: __('discord.notAllowed.title'),
            text: __('discord.notAllowed.text')
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
              title: __('discord.someError.title'),
              text: __('discord.someError.text')
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
              title: __('discord.noResultsOrError.title'),
              text: __('discord.noResultsOrError.text', { query })
            })
          ]
        });
        break;
      }
      msg.reply({
        embeds: [
          getEmbed({
            color: 0x2eff00,
            title: __('discord.buyResults.title', { query }),
            text: __('discord.buyResults.text', { len: results.length })
          }).setThumbnail(results?.[0]?.items?.[0]?.image || 'https://i.imgur.com/s9qXIYM.jpg').addFields(
            results.map(r => ({
              name: `${r.name} (${r.square})`,
              value: r.items.map(item =>
                __('discord.buyResult', {
                  quantity: item.quantity,
                  item: item.item,
                  isBP: item.itemIsBlueprint ? ' (BP)' : '',
                  cost: item.costPerItem,
                  currency: item.currency,
                  isCurrencyBP: item.currencyIsBlueprint ? ' (BP)' : '',
                  inStock: item.amountInStock
                })
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
              title: __('discord.someError.title'),
              text: __('discord.someError.text')
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
              title: __('discord.noResultsOrError.title'),
              text: __('discord.noResultsOrError.text', { query: querySell })
            })
          ]
        });
        break;
      }
      msg.reply({
        embeds: [
          getEmbed({
            color: 0xffaf30,
            title: __('discord.sellResults.title', { amount, query: querySell }),
            text: __('discord.sellResults.text', { len: resultsSell.length }),
          }).setThumbnail(resultsSell?.[0]?.items?.[0]?.image || 'https://i.imgur.com/s9qXIYM.jpg').addFields(
            resultsSell.map(r => ({
              name: `${r.name} (${r.square})`,
              value: r.items.map(item =>
                __('discord.buyResult', {
                  quantity: item.quantity,
                  item: item.item,
                  isBP: item.itemIsBlueprint ? ' (BP)' : '',
                  cost: item.costPerItem,
                  currency: item.currency,
                  isCurrencyBP: item.currencyIsBlueprint ? ' (BP)' : '',
                  inStock: item.amountInStock
                })
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
            title: __('discord.mapShow.title'),
            text: __('discord.mapShow.text')
          }).setImage('attachment://map.jpg')
        ],
        files: [file]
      });
      break;
    case commands.INFO:
      let info;
      try {
        info = await (await fetch(`${process.env.RUSTY_API_ADDRESS}:${process.env.RUSTY_API_PORT}/info`)).json();
      } catch (err) {
        logger.error(err);
        msg.reply({
          embeds: [
            getEmbed({
              color: 0xff5454,
              title: __('discord.someError.title'),
              text: __('discord.someError.text')
            })
          ]
        });
        break;
      }
      if (!info?.name) {
        logger.error(__('discord.rustServerError.text'));
        msg.reply({
          embeds: [
            getEmbed({
              color: 0xff5454,
              title: __('discord.someError.title'),
              text: __('discord.someError.text')
            })
          ]
        });
        break;
      }

      msg.reply({
        embeds: [
          getEmbed({
            color: 0x2dd1ff,
            title: info.name,
            text: info.map
          }).setThumbnail(info.headerImage)
            .addFields([
              {
                name: __('discord.info.wipeTime'),
                value: info.wipeTime.toString(),
                inline: true
              },
              {
                name: __('discord.info.players'),
                value: `${info.players}/${info.maxPlayers}`,
                inline: true
              },
              {
                name: __('discord.info.queued'),
                value: info.queuedPlayers.toString(),
                inline: true
              },
              {
                name: __('discord.info.map'),
                value: __('discord.info.mapTitle', { mapType: info.map, seed: info.seed, size: info.mapSize })
              }
            ])
        ]
      });
      break;
    case commands.RESTART_RUST:
      await fetch(`${process.env.RUSTY_API_ADDRESS}:${process.env.RUSTY_API_PORT}/info`);

      msg.reply({
        embeds: [
          getEmbed({
            color: 0xff5454,
            title: __('rust.restart.title'),
            text: __('rust.restart.text')
          })
        ]
      });
      break;
    default:
      msg.reply({
        embeds: [
          getEmbed({
            color: 0xff5454,
            title: __('discord.cmdNotFound.title'),
            text: __('discord.cmdNotFound.text', { commands: Object.values(commands).join(', ') })
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