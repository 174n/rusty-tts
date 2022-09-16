const config = {
    transport: {
        target: 'pino-pretty',
        options: {
            singleLine: true,
            translateTime: 'HH:MM:ss'
        }
    },
};
const logger = require('pino')(config);

module.exports = {
    config,
    log(...attrs) {
        logger.info(...attrs);
    },
    warn(...attrs) {
        logger.warn(...attrs);
    },
    error(...attrs) {
        logger.error(...attrs);
    }
}