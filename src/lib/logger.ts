const isDev = import.meta.env.DEV;

export const logger = {
  error: (...args: any[]) => console.error(...args),
  warn: (...args: any[]) => isDev && console.warn(...args),
  info: (...args: any[]) => isDev && console.log(...args),
  debug: (...args: any[]) => false
};
