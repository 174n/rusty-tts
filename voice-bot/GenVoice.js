const fs = require('fs');
const crypto = require('crypto');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const path = require('path');
const { speak, getInstalledVoices } = require("windows-tts");

const sha1 = input => crypto.createHash('sha1').update(input).digest('hex');

module.exports = class GenVoice {
  constructor() {
    this.torSpeech;
    this.savedVoices = fs.readdirSync(path.join(__dirname, '..', 'cache')).filter(f => f.match(/\.(mp3|ogg|wav)$/g)).map(f => f.slice(0, -4));
  }

  async init() {
  }

  async getVoices() {
    return await getInstalledVoices();
  }

  getFilePath(text) {
    const filename = sha1(text);
    return {
      filename,
      filePath: path.join(__dirname, '..', 'cache', filename)
    };
  }

  async gen(text) {
    const { filename, filePath } = this.getFilePath(text);
    if (!this.savedVoices.includes(filename)) {
      await this.genFresh(text);
    } else {
      try {
        fs.accessSync(filePath + '.ogg', fs.constants.F_OK)
      } catch (err) {
        console.log('Cached file not found', filePath + '.ogg');
        console.error(err);
        await this.genFresh(text);
      }
    }
    return filePath + '.ogg';
  }

  async genFresh(text, tried = 0) {
    if (tried > 2)
      return;

    const { filePath, filename } = this.getFilePath(text);

    console.log(`${tried+1}th try to generate the voice for text "${text}" to "${filePath}"`);

    const wavBuffer = await speak(text, { voice: process.env.WINDOWS_VOICE, rate: 3 });
    await fs.promises.writeFile(filePath + '.wav', wavBuffer);

    this.savedVoices.push(filename);
    try {
      const { stdout, stderr } = await exec(`ffmpeg -i "${filePath}.wav" -c:a libopus -b:a 16k "${filePath}.ogg"`);
      console.log('stdout:', stdout);
      console.error('stderr:', stderr);
    } catch (e) {
      console.error(e);
      return;
    }
    await (new Promise(res => setInterval(res, 500)));
    fs.unlinkSync(filePath + '.wav');
    try {
      fs.accessSync(filePath + '.ogg', fs.constants.F_OK)
    } catch (_) {
      console.error(`File "${filePath}.ogg" not found`);
    }
  }

}