module.exports = {
  timeout: (prom, time) =>
    Promise.race([prom, new Promise((_r, rej) => setTimeout(rej, time))]),
  sha1: input => crypto.createHash('sha1').update(input).digest('hex')
};