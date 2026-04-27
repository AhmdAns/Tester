import pino from 'pino';

export const logger = pino({
  level: process.env.TESTHELPER_LOG_LEVEL ?? 'info',
  transport: process.stdout.isTTY
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});
