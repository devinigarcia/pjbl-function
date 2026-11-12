import { InvocationContext } from '@azure/functions';
import { describe, expect, it } from 'vitest';
import { createProcessOrderEventEndpoint } from '../../../src/api/features/ProcessOrderEvent/ProcessOrderEventEndpoint';
import { ProcessOrderEventHandler } from '../../../src/application/features/ProcessOrderEvent/ProcessOrderEvent';
import { StockServiceUnavailableError } from '../../../src/application/ports/StockGateway';
import { buildOrderEvent, FakeStockGateway } from '../../helpers/fakes';

function setup() {
  const gateway = new FakeStockGateway({ cafe: 10, caneca: 4 });
  const endpoint = createProcessOrderEventEndpoint(new ProcessOrderEventHandler(gateway));
  const logs: Array<{ level: string; message: string }> = [];
  const context = new InvocationContext({
    functionName: 'processOrderEvent',
    triggerMetadata: { id: 'msg-7', dequeueCount: 3 },
    logHandler: (level, ...args) => logs.push({ level, message: args.join(' ') }),
  });
  return { gateway, endpoint, context, logs };
}

describe('processOrderEvent (adaptador do Queue Trigger)', () => {
  it('processa a mensagem que o runtime entrega já como objeto', async () => {
    const { gateway, endpoint, context, logs } = setup();

    await endpoint(buildOrderEvent(), context);

    expect(gateway.stockOf('cafe')).toBe(8);
    expect(gateway.stockOf('caneca')).toBe(3);
    // os logs do caso de uso saem pelo InvocationContext (é o que aparece no portal do Azure)
    expect(logs.some((log) => log.message.includes('entrega nº 3'))).toBe(true);
  });

  it('processa a mensagem entregue como string', async () => {
    const { gateway, endpoint, context } = setup();

    await endpoint(JSON.stringify(buildOrderEvent()), context);

    expect(gateway.stockOf('cafe')).toBe(8);
  });

  it('mensagem inválida não derruba a function (senão iria para a fila poison à toa)', async () => {
    const { gateway, endpoint, context, logs } = setup();

    await expect(endpoint('{ isso não é json', context)).resolves.toBeUndefined();

    expect(gateway.calls).toHaveLength(0);
    expect(logs.filter((log) => log.level === 'error')).toHaveLength(1);
    expect(logs[0]?.message).toContain('msg-7');
  });

  it('deixa a falha temporária subir para o runtime fazer o retry', async () => {
    const { gateway, endpoint, context } = setup();
    gateway.failNext(1);

    await expect(endpoint(buildOrderEvent(), context)).rejects.toBeInstanceOf(StockServiceUnavailableError);
  });
});
