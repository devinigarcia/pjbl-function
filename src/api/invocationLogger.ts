import type { InvocationContext } from '@azure/functions';
import type { Logger } from '../application/ports/Logger';

/** Adapta o log do Functions (que vai para o Application Insights) à porta Logger da aplicação. */
export function toLogger(context: InvocationContext): Logger {
  return {
    info: (message) => context.log(message),
    warn: (message) => context.warn(message),
    error: (message) => context.error(message),
  };
}
