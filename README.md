# Rusty TTS

A discord bot that listens to [Rust+](https://rust.facepunch.com/companion) chat events and speaks them out loud in your discord server. It can also search for items for sale on the map.

## Instalation

You have to be on Windows to run the TTS part for now, bacause it uses the built-in TTS on Windows (PRs to make it cross platform without using paid APIs are welcome). You have to also have node.js and ffmpeg installed.

Clone the repo and install the dependencies:

```bash
git clone https://github.com/174n/rusty-tts.git
cd rusty-tts
npm i
```

Copy ```.env.example``` as ```.env``` and fill up the blanks. [Here is a guilde how to get discord bot token](https://github.com/reactiflux/discord-irc/wiki/Creating-a-discord-bot-&-getting-a-token). You can get DISCORD_WEBHOOK from the text channel settings. How to get Rust+ data is described [here](https://github.com/liamcottle/rustplus.js#using-the-command-line-tool). I'm not responsible if you mess up something, do it on your own risk.

## Usage

### Running the bot

The app consists of two scripts one is for the communication to the discord and another one is for Rust+. You have to run both of them to get everything working. You can open two terminals and paste this commands to them:

```bash
# first terminal
node voice-bot
# second terminal
node rust-listener.js
```

If it doesn't work, you probably didn't fill up the ```.env``` values right. Read the errors and fix the env.

### Commands

* ```.joinvoice``` makes the bot join your voice channel
* ```.shops item name``` searches for the given item in vending machines on the map
* ```.del n``` deletes the last *n* messages from the chat