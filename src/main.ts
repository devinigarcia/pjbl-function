import { app } from '@azure/functions';
import { createCalculateIndicatorsEndpoint } from './api/features/CalculateIndicators/CalculateIndicatorsEndpoint';
import { createProcessOrderEventEndpoint } from './api/features/ProcessOrderEvent/ProcessOrderEventEndpoint';
import { docsEndpoint } from './api/docs';
import { healthEndpoint } from './api/health';
import { createOpenApiEndpoint } from './api/openapi';
import { CalculateIndicatorsHandler } from './application/features/CalculateIndicators/CalculateIndicators';
import { ProcessOrderEventHandler } from './application/features/ProcessOrderEvent/ProcessOrderEvent';
import { loadConfig } from './infrastructure/config';
import { ProdutosHttpStockGateway } from './infrastructure/ProdutosHttpStockGateway';

// Composition root: é o único arquivo que conhece ao mesmo tempo a infraestrutura e os
// adaptadores das functions. Aqui as peças são montadas e registradas no runtime.

const config = loadConfig();

const stockGateway = new ProdutosHttpStockGateway({
  baseUrl: config.produtosApiUrl,
  apiKey: config.produtosApiKey,
  timeoutMs: config.produtosTimeoutMs,
});

const calculateIndicators = new CalculateIndicatorsHandler();
const processOrderEvent = new ProcessOrderEventHandler(stockGateway);

// HTTP Trigger chamado pelo BFF (precisa do cabeçalho x-functions-key).
app.http('calculateIndicators', {
  methods: ['POST'],
  authLevel: 'function',
  route: 'indicators',
  handler: createCalculateIndicatorsEndpoint(calculateIndicators),
});

// Message Trigger: consome os eventos de pedido publicados pelo ms-pedidos.
// As regras de retry (maxDequeueCount, fila poison, base64) ficam no host.json.
app.storageQueue('processOrderEvent', {
  queueName: config.orderEventsQueue,
  connection: 'AzureWebJobsStorage',
  handler: createProcessOrderEventEndpoint(processOrderEvent),
});

app.http('health', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'health',
  handler: healthEndpoint,
});

app.http('openapi', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'openapi.json',
  handler: createOpenApiEndpoint({ queueName: config.orderEventsQueue }),
});

app.http('docs', {
  methods: ['GET'],
  authLevel: 'anonymous',
  route: 'docs',
  handler: docsEndpoint,
});
