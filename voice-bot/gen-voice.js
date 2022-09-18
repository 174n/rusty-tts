const fs = require('fs');
const crypto = require('crypto');
const util = require('util');
const exec = util.promisify(require('child_process').exec);
const path = require('path');
const { speak, getInstalledVoices } = require("windows-tts");
const logger = require('../logger');
const { __ } = require('../i18n');
const { sha1 } = require('../utils');

const ext = process.platform === "win32" ? 'ogg' : 'wav';
const getRate = isWin => (process.env.TTS_RATE || 1.5) * (isWin ? 1 : 100);
const getVoice = isWin => isWin
  ? process.env.WINDOWS_VOICE || 'Microsoft Irina Desktop'
  : process.env.LINUX_VOICE || 'mikhail';
const savedVoices = fs.readdirSync(path.join(__dirname, '..', 'cache'))
  .filter(f => f.match(/\.(mp3|ogg|wav)$/g))
  .map(f => f.slice(0, -4));

module.exports = {
  ext,
  savedVoices,

  async getVoices() {
    return await getInstalledVoices();
  },

  getFilePath(text) {
    const filename = sha1(text);
    return {
      filename,
      filePath: path.join(__dirname, '..', 'cache', filename)
    };
  },

  async gen(text) {
    const { filename, filePath } = this.getFilePath(text);
    if (!this.savedVoices.includes(filename)) {
      await this.genFresh(text);
    } else {
      try {
        fs.accessSync(filePath + ('.' + ext), fs.constants.F_OK)
      } catch (err) {
        logger.log(`Cached file not found' ${filePath}.${ext}`);
        logger.error(err);
        await this.genFresh(text);
      }
    }
    return filePath + ('.' + ext);
  },

  async genFresh(text) {
    if (process.platform === "win32")
      return await this.genFreshWin(text);
    else
      return await this.genFreshLinux(text);

  },

  async genFreshLinux(text) {
    const { filePath, filename } = this.getFilePath(text);

    logger.log(__('voice.generating', { text, filePath }));

    try {
      await exec(`echo "${text.replace(/"\\/g, '')
        }" | RHVoice-test -p "${getVoice()}" -r ${getRate()} -o ${filePath}.${ext}`
      );
    } catch (err) {
      logger.error(err);
      return;
    }

    this.savedVoices.push(filename);

    try {
      fs.accessSync(filePath + ('.' + ext), fs.constants.F_OK)
    } catch (_) {
      logger.error(__('voice.fileNotFound', { file: filePath + '.' + ext }));
    }
  },

  async genFreshWin(text) {
    const { filePath, filename } = this.getFilePath(text);

    logger.log(__('voice.generating', { text, filePath }));

    const wavBuffer = await speak(text, { voice: getVoice(true), rate: getRate(true) });
    await fs.promises.writeFile(filePath + '.wav', wavBuffer);

    this.savedVoices.push(filename);
    if (ext !== 'wav') {
      try {
        const { stdout, stderr } = await exec(`ffmpeg -i "${filePath}.wav" -c:a libopus -b:a 16k "${filePath}.${ext}"`);
        logger.log('stdout:', stdout);
        logger.error('stderr:', stderr);
      } catch (e) {
        logger.error(e);
        return;
      }
      await (new Promise(res => setInterval(res, 500)));
      fs.unlinkSync(filePath + '.wav');
    }
    try {
      fs.accessSync(filePath + ('.' + ext), fs.constants.F_OK)
    } catch (_) {
      logger.error(__('voice.fileNotFound', { file: filePath + '.' + ext }));
    }
  }

}