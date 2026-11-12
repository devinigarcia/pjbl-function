import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { CORRELATION_HEADER, resolveCorrelationId } from './http';

export interface OpenApiOptions {
  /** Nome da fila que o Queue Trigger escuta (aparece na descrição). */
  queueName: string;
}

const exampleProducts = [
  {
    id: '7f1c2a54-0d0b-4b53-9a57-1f1f0c3f9a01',
    sku: 'CAFE-500G',
    name: 'Café torrado 500g',
    description: 'Torra média',
    category: 'Mercearia',
    price: 24.9,
    stock: 12,
    lowStock: false,
  },
  {
    id: '2b9d6c1e-6f37-4a0c-8a55-0f6a4f1f7b02',
    sku: 'CANECA-AZUL',
    name: 'Caneca azul 300ml',
    category: 'Utilidades',
    price: 35,
    stock: 3,
    lowStock: true,
  },
  {
    id: '9c3e8f70-41a2-4d6e-b0c9-5a2d7e8f1c03',
    sku: 'FILTRO-103',
    name: 'Filtro de papel 103',
    category: 'Mercearia',
    price: 6.5,
    stock: 0,
    lowStock: true,
  },
];

const exampleOrders = [
  {
    id: 'a1b2c3d4-1111-4222-8333-444455556666',
    customerName: 'Ana Souza',
    customerEmail: 'ana@exemplo.com',
    status: 'PAGO',
    total: 84.8,
    items: [
      { productId: '7f1c2a54-0d0b-4b53-9a57-1f1f0c3f9a01', productName: 'Café torrado 500g', unitPrice: 24.9, quantity: 2, subtotal: 49.8 },
      { productId: '2b9d6c1e-6f37-4a0c-8a55-0f6a4f1f7b02', productName: 'Caneca azul 300ml', unitPrice: 35, quantity: 1, subtotal: 35 },
    ],
  },
  {
    id: 'b2c3d4e5-2222-4333-8444-555566667777',
    customerName: 'Bruno Lima',
    customerEmail: 'bruno@exemplo.com',
    status: 'PENDENTE',
    total: 24.9,
    items: [{ productId: '7f1c2a54-0d0b-4b53-9a57-1f1f0c3f9a01', productName: 'Café torrado 500g', unitPrice: 24.9, quantity: 1, subtotal: 24.9 }],
  },
  {
    id: 'c3d4e5f6-3333-4444-8555-666677778888',
    customerName: 'Carla Dias',
    customerEmail: 'carla@exemplo.com',
    status: 'CANCELADO',
    total: 70,
    items: [{ productId: '2b9d6c1e-6f37-4a0c-8a55-0f6a4f1f7b02', productName: 'Caneca azul 300ml', unitPrice: 35, quantity: 2, subtotal: 70 }],
  },
];

// Resultado real do cálculo para os exemplos acima (conferido nos testes).
const exampleIndicators = {
  products: {
    total: 3,
    totalUnitsInStock: 15,
    inventoryValue: 403.8,
    lowStock: [
      { id: '9c3e8f70-41a2-4d6e-b0c9-5a2d7e8f1c03', sku: 'FILTRO-103', name: 'Filtro de papel 103', stock: 0 },
      { id: '2b9d6c1e-6f37-4a0c-8a55-0f6a4f1f7b02', sku: 'CANECA-AZUL', name: 'Caneca azul 300ml', stock: 3 },
    ],
    outOfStock: 1,
    byCategory: [
      { category: 'Mercearia', count: 2, units: 12, value: 298.8 },
      { category: 'Utilidades', count: 1, units: 3, value: 105 },
    ],
  },
  orders: {
    total: 3,
    byStatus: { PENDENTE: 1, PAGO: 1, ENVIADO: 0, ENTREGUE: 0, CANCELADO: 1 },
    revenue: 84.8,
    averageTicket: 84.8,
    pendingValue: 24.9,
    cancellationRate: 0.33,
  },
  topProducts: [
    { productId: '7f1c2a54-0d0b-4b53-9a57-1f1f0c3f9a01', productName: 'Café torrado 500g', quantity: 3, revenue: 74.7 },
    { productId: '2b9d6c1e-6f37-4a0c-8a55-0f6a4f1f7b02', productName: 'Caneca azul 300ml', quantity: 1, revenue: 35 },
  ],
  alerts: [
    '2 produtos estão com estoque baixo.',
    '1 produto está zerado no estoque.',
    '1 pedido pendente aguardando pagamento (R$ 24,90).',
    'Taxa de cancelamento alta: 33% dos pedidos foram cancelados.',
  ],
  generatedAt: '2025-06-10T14:30:00.000Z',
  computedBy: 'azure-function',
};

const exampleOrderEvent = {
  eventId: '5d0c1f6e-7a11-4c9b-9f55-0a1b2c3d4e5f',
  type: 'order.created',
  version: 1,
  source: 'ms-pedidos',
  occurredAt: '2025-06-10T14:29:58.120Z',
  correlationId: '0f8fad5b-d9cb-469f-a165-70867728950e',
  data: {
    orderId: 'a1b2c3d4-1111-4222-8333-444455556666',
    customerName: 'Ana Souza',
    customerEmail: 'ana@exemplo.com',
    status: 'PENDENTE',
    total: 84.8,
    items: [
      { productId: '7f1c2a54-0d0b-4b53-9a57-1f1f0c3f9a01', productName: 'Café torrado 500g', quantity: 2, unitPrice: 24.9 },
      { productId: '2b9d6c1e-6f37-4a0c-8a55-0f6a4f1f7b02', productName: 'Caneca azul 300ml', quantity: 1, unitPrice: 35 },
    ],
  },
};

export const openApiExamples = {
  products: exampleProducts,
  orders: exampleOrders,
  indicators: exampleIndicators,
  orderEvent: exampleOrderEvent,
};

function describeApi(queueName: string): string {
  return [
    'Parte *serverless* da **Conecta Store** (trabalho PJBL de arquitetura distribuída). Esta Function App tem dois papéis:',
    '',
    '### 1. HTTP Trigger — `calculateIndicators`',
    'O BFF chama `POST /api/indicators` dentro do `GET /aggregated-data`, mandando os produtos (ms-produtos) e os pedidos (ms-pedidos) que acabou de buscar. A Function devolve os indicadores do painel: valor do estoque, produtos com estoque baixo, faturamento, ticket médio, produtos mais vendidos e alertas em português.',
    '',
    `### 2. Queue Trigger — \`processOrderEvent\` (fila \`${queueName}\`)`,
    'Não aparece na lista de rotas porque não é HTTP: ela é disparada por mensagens da Azure Storage Queue publicadas pelo ms-pedidos (padrão *Transactional Outbox*).',
    '',
    '| Evento | O que a Function faz |',
    '|---|---|',
    '| `order.created` | registra uma **SAÍDA** de estoque para cada item do pedido |',
    '| `order.cancelled` | registra uma **ENTRADA** (devolução) para cada item |',
    '',
    'Para cada item ela chama `POST /products/{productId}/stock-movements` no ms-produtos com `eventId = "<eventId>:<productId>"`. Essa chave deixa o processamento **idempotente**: se a mesma mensagem chegar de novo (a entrega é *at-least-once*), o ms-produtos responde `200 duplicate: true` e o estoque não é alterado duas vezes.',
    '',
    'Tratamento de erros do consumidor:',
    '- mensagem que não é JSON ou está fora do contrato → é logada e descartada;',
    '- `404`/`409` do ms-produtos (produto removido, estoque insuficiente) → *warning* no log e segue para os outros itens, sem reprocessar;',
    `- falha de rede, \`5xx\` ou \`429\` → a exceção sobe, o runtime reentrega a mensagem e, depois de 5 tentativas, ela vai para a fila \`${queueName}-poison\`.`,
    '',
    'O formato do evento está no schema `OrderEvent` (no fim desta página) e, com mais detalhes, no AsyncAPI do ms-pedidos (`/events/docs`).',
    '',
    '### Convenções',
    '- `x-correlation-id`: se vier na requisição é reaproveitado, senão a Function gera um UUID. Sempre volta na resposta.',
    '- Erros seguem o formato padrão do projeto: `{ "error": { "code", "message", "details?", "correlationId" } }`.',
  ].join('\n');
}

export function buildOpenApiDocument(options: OpenApiOptions): Record<string, unknown> {
  const correlationHeaderParam = {
    name: CORRELATION_HEADER,
    in: 'header',
    required: false,
    description: 'Identificador para rastrear a requisição entre os serviços. Se não for enviado, a Function gera um.',
    schema: { type: 'string', format: 'uuid' },
    example: '0f8fad5b-d9cb-469f-a165-70867728950e',
  };
  const correlationHeaderResponse = {
    [CORRELATION_HEADER]: {
      description: 'Mesmo identificador recebido (ou o que foi gerado).',
      schema: { type: 'string' },
    },
  };

  return {
    openapi: '3.0.3',
    info: {
      title: 'Conecta Store — Azure Function',
      version: '1.0.0',
      description: describeApi(options.queueName),
    },
    servers: [{ url: '/api', description: 'Esta Function App (local ou na nuvem)' }],
    tags: [
      { name: 'Indicadores', description: 'Cálculo dos indicadores do painel (HTTP Trigger chamado pelo BFF).' },
      { name: 'Infra', description: 'Saúde do serviço e documentação.' },
    ],
    paths: {
      '/indicators': {
        post: {
          tags: ['Indicadores'],
          operationId: 'calculateIndicators',
          summary: 'Calcula os indicadores de produtos e pedidos',
          description: [
            'Recebe as listas de produtos e pedidos e devolve os números agregados. A Function não guarda estado nem acessa banco: o resultado depende só do que foi enviado.',
            '',
            'Regras do cálculo:',
            '- `inventoryValue` = soma de `price × stock`;',
            '- `lowStock` = produtos com 5 unidades ou menos (os zerados também entram e são contados em `outOfStock`);',
            '- `revenue` = soma dos pedidos `PAGO`, `ENVIADO` e `ENTREGUE`; `averageTicket` = `revenue` ÷ quantidade desses pedidos;',
            '- `pendingValue` = soma dos pedidos `PENDENTE`; `cancellationRate` = cancelados ÷ total (de 0 a 1);',
            '- `topProducts` = os 5 produtos com mais unidades vendidas, ignorando pedidos cancelados;',
            '- valores em dinheiro e taxas são arredondados para 2 casas.',
            '',
            'Campos extras nos produtos e pedidos são aceitos e ignorados. Se `products` ou `orders` vier ausente ou `null`, é tratado como lista vazia.',
            '',
            'Na nuvem esta rota exige a chave da Function (`x-functions-key`). Rodando local com `func start` a chave não é cobrada.',
          ].join('\n'),
          security: [{ functionKey: [] }],
          parameters: [correlationHeaderParam],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/IndicatorsRequest' },
                examples: {
                  lojaPequena: {
                    summary: 'Três produtos e três pedidos',
                    value: { products: exampleProducts, orders: exampleOrders },
                  },
                  semDados: {
                    summary: 'Sem nenhum dado (tudo zerado)',
                    value: { products: [], orders: [] },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Indicadores calculados.',
              headers: correlationHeaderResponse,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Indicators' },
                  examples: { lojaPequena: { summary: 'Resultado para o exemplo "Três produtos e três pedidos"', value: exampleIndicators } },
                },
              },
            },
            '400': {
              description: 'Corpo inválido: JSON malformado (`INVALID_JSON`) ou campos fora do esperado (`VALIDATION_ERROR`).',
              headers: correlationHeaderResponse,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                  examples: {
                    validacao: {
                      summary: 'Campo com tipo errado',
                      value: {
                        error: {
                          code: 'VALIDATION_ERROR',
                          message: 'Dados inválidos.',
                          details: [{ field: 'products.0.price', message: 'Deve ser número (veio texto).' }],
                          correlationId: '0f8fad5b-d9cb-469f-a165-70867728950e',
                        },
                      },
                    },
                    jsonInvalido: {
                      summary: 'JSON malformado',
                      value: {
                        error: {
                          code: 'INVALID_JSON',
                          message: 'O corpo da requisição não é um JSON válido.',
                          correlationId: '0f8fad5b-d9cb-469f-a165-70867728950e',
                        },
                      },
                    },
                  },
                },
              },
            },
            '401': { description: 'Chave da Function ausente ou errada (resposta do próprio runtime do Azure Functions, sem corpo).' },
            '500': {
              description: 'Erro inesperado (`INTERNAL_ERROR`).',
              headers: correlationHeaderResponse,
              content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } },
            },
          },
        },
      },
      '/health': {
        get: {
          tags: ['Infra'],
          operationId: 'health',
          summary: 'Verifica se a Function está no ar',
          description: 'Rota anônima. O BFF consulta este endereço no `GET /health` dele para montar o status das dependências.',
          parameters: [correlationHeaderParam],
          responses: {
            '200': {
              description: 'Function respondendo.',
              headers: correlationHeaderResponse,
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/Health' },
                  example: { status: 'ok', service: 'pjbl-function', timestamp: '2025-06-10T14:30:00.000Z' },
                },
              },
            },
          },
        },
      },
      '/openapi.json': {
        get: {
          tags: ['Infra'],
          operationId: 'openapi',
          summary: 'Especificação OpenAPI 3 (este documento)',
          responses: {
            '200': { description: 'Documento OpenAPI em JSON.', content: { 'application/json': { schema: { type: 'object' } } } },
          },
        },
      },
      '/docs': {
        get: {
          tags: ['Infra'],
          operationId: 'docs',
          summary: 'Swagger UI (esta página)',
          responses: {
            '200': { description: 'Página HTML do Swagger UI.', content: { 'text/html': { schema: { type: 'string' } } } },
          },
        },
      },
    },
    components: {
      securitySchemes: {
        functionKey: {
          type: 'apiKey',
          in: 'header',
          name: 'x-functions-key',
          description: 'Chave de função/host do Azure Functions. O BFF guarda esse valor na variável `FUNCTION_KEY`.',
        },
      },
      schemas: {
        Product: {
          type: 'object',
          description: 'Produto como o ms-produtos devolve. Só os campos marcados como obrigatórios entram no cálculo.',
          required: ['id', 'sku', 'name', 'price', 'stock'],
          additionalProperties: true,
          properties: {
            id: { type: 'string', example: '7f1c2a54-0d0b-4b53-9a57-1f1f0c3f9a01' },
            sku: { type: 'string', example: 'CAFE-500G' },
            name: { type: 'string', example: 'Café torrado 500g' },
            category: { type: 'string', nullable: true, description: 'Sem categoria vira "Sem categoria" no agrupamento.', example: 'Mercearia' },
            price: { type: 'number', minimum: 0, example: 24.9 },
            stock: { type: 'integer', minimum: 0, example: 12 },
          },
        },
        OrderItem: {
          type: 'object',
          required: ['productId', 'productName', 'unitPrice', 'quantity'],
          additionalProperties: true,
          properties: {
            productId: { type: 'string', example: '7f1c2a54-0d0b-4b53-9a57-1f1f0c3f9a01' },
            productName: { type: 'string', example: 'Café torrado 500g' },
            unitPrice: { type: 'number', minimum: 0, example: 24.9 },
            quantity: { type: 'integer', minimum: 0, example: 2 },
          },
        },
        Order: {
          type: 'object',
          description: 'Pedido como o ms-pedidos devolve. Só os campos marcados como obrigatórios entram no cálculo.',
          required: ['status', 'total'],
          additionalProperties: true,
          properties: {
            id: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['PENDENTE', 'PAGO', 'ENVIADO', 'ENTREGUE', 'CANCELADO'], example: 'PAGO' },
            total: { type: 'number', minimum: 0, example: 84.8 },
            items: { type: 'array', items: { $ref: '#/components/schemas/OrderItem' } },
          },
        },
        IndicatorsRequest: {
          type: 'object',
          additionalProperties: true,
          properties: {
            products: { type: 'array', nullable: true, items: { $ref: '#/components/schemas/Product' } },
            orders: { type: 'array', nullable: true, items: { $ref: '#/components/schemas/Order' } },
          },
        },
        LowStockProduct: {
          type: 'object',
          required: ['id', 'sku', 'name', 'stock'],
          properties: {
            id: { type: 'string' },
            sku: { type: 'string', example: 'CANECA-AZUL' },
            name: { type: 'string', example: 'Caneca azul 300ml' },
            stock: { type: 'integer', example: 3 },
          },
        },
        CategorySummary: {
          type: 'object',
          required: ['category', 'count', 'units', 'value'],
          properties: {
            category: { type: 'string', example: 'Mercearia' },
            count: { type: 'integer', description: 'Quantidade de produtos na categoria.', example: 2 },
            units: { type: 'integer', description: 'Unidades em estoque.', example: 12 },
            value: { type: 'number', description: 'Valor do estoque da categoria (price × stock).', example: 298.8 },
          },
        },
        ProductIndicators: {
          type: 'object',
          required: ['total', 'totalUnitsInStock', 'inventoryValue', 'lowStock', 'outOfStock', 'byCategory'],
          properties: {
            total: { type: 'integer', description: 'Quantidade de produtos.', example: 3 },
            totalUnitsInStock: { type: 'integer', description: 'Soma do estoque de todos os produtos.', example: 15 },
            inventoryValue: { type: 'number', description: 'Valor total do estoque.', example: 403.8 },
            lowStock: {
              type: 'array',
              description: 'Produtos com 5 unidades ou menos, do mais crítico para o menos.',
              items: { $ref: '#/components/schemas/LowStockProduct' },
            },
            outOfStock: { type: 'integer', description: 'Quantidade de produtos com estoque zerado.', example: 1 },
            byCategory: { type: 'array', description: 'Resumo por categoria, em ordem alfabética.', items: { $ref: '#/components/schemas/CategorySummary' } },
          },
        },
        OrderIndicators: {
          type: 'object',
          required: ['total', 'byStatus', 'revenue', 'averageTicket', 'pendingValue', 'cancellationRate'],
          properties: {
            total: { type: 'integer', example: 3 },
            byStatus: {
              type: 'object',
              description: 'Quantidade de pedidos em cada status (os cinco status sempre aparecem, mesmo zerados).',
              additionalProperties: { type: 'integer' },
              example: { PENDENTE: 1, PAGO: 1, ENVIADO: 0, ENTREGUE: 0, CANCELADO: 1 },
            },
            revenue: { type: 'number', description: 'Soma dos pedidos PAGO + ENVIADO + ENTREGUE.', example: 84.8 },
            averageTicket: { type: 'number', description: 'revenue ÷ quantidade de pedidos PAGO/ENVIADO/ENTREGUE (0 se não houver).', example: 84.8 },
            pendingValue: { type: 'number', description: 'Soma dos pedidos PENDENTE.', example: 24.9 },
            cancellationRate: { type: 'number', minimum: 0, maximum: 1, description: 'Cancelados ÷ total, de 0 a 1.', example: 0.33 },
          },
        },
        TopProduct: {
          type: 'object',
          required: ['productId', 'productName', 'quantity', 'revenue'],
          properties: {
            productId: { type: 'string' },
            productName: { type: 'string', example: 'Café torrado 500g' },
            quantity: { type: 'integer', description: 'Unidades vendidas (pedidos cancelados não contam).', example: 3 },
            revenue: { type: 'number', description: 'Soma de unitPrice × quantity.', example: 74.7 },
          },
        },
        Indicators: {
          type: 'object',
          required: ['products', 'orders', 'topProducts', 'alerts', 'generatedAt', 'computedBy'],
          properties: {
            products: { $ref: '#/components/schemas/ProductIndicators' },
            orders: { $ref: '#/components/schemas/OrderIndicators' },
            topProducts: { type: 'array', maxItems: 5, items: { $ref: '#/components/schemas/TopProduct' } },
            alerts: {
              type: 'array',
              description: 'Frases prontas para mostrar no painel.',
              items: { type: 'string' },
              example: ['2 produtos estão com estoque baixo.', '1 pedido pendente aguardando pagamento (R$ 24,90).'],
            },
            generatedAt: { type: 'string', format: 'date-time' },
            computedBy: { type: 'string', enum: ['azure-function'] },
          },
        },
        Health: {
          type: 'object',
          required: ['status', 'service', 'timestamp'],
          properties: {
            status: { type: 'string', enum: ['ok'] },
            service: { type: 'string', enum: ['pjbl-function'] },
            timestamp: { type: 'string', format: 'date-time' },
          },
        },
        ErrorResponse: {
          type: 'object',
          required: ['error'],
          properties: {
            error: {
              type: 'object',
              required: ['code', 'message', 'correlationId'],
              properties: {
                code: { type: 'string', example: 'VALIDATION_ERROR' },
                message: { type: 'string', example: 'Dados inválidos.' },
                details: {
                  type: 'array',
                  description: 'Só aparece em VALIDATION_ERROR.',
                  items: {
                    type: 'object',
                    required: ['field', 'message'],
                    properties: { field: { type: 'string', example: 'products.0.price' }, message: { type: 'string', example: 'Campo obrigatório.' } },
                  },
                },
                correlationId: { type: 'string' },
              },
            },
          },
        },
        OrderEvent: {
          type: 'object',
          description: `Mensagem consumida pelo Queue Trigger \`processOrderEvent\` na fila \`${options.queueName}\` (JSON codificado em Base64). Não é enviada por HTTP — está aqui só para documentar o consumidor.`,
          required: ['eventId', 'type', 'data'],
          properties: {
            eventId: { type: 'string', format: 'uuid' },
            type: { type: 'string', enum: ['order.created', 'order.cancelled'] },
            version: { type: 'integer', example: 1 },
            source: { type: 'string', example: 'ms-pedidos' },
            occurredAt: { type: 'string', format: 'date-time' },
            correlationId: { type: 'string', description: 'Repassado ao ms-produtos em `x-correlation-id`.' },
            data: {
              type: 'object',
              required: ['orderId', 'items'],
              properties: {
                orderId: { type: 'string', format: 'uuid' },
                customerName: { type: 'string' },
                customerEmail: { type: 'string' },
                status: { type: 'string' },
                total: { type: 'number' },
                items: {
                  type: 'array',
                  minItems: 1,
                  items: {
                    type: 'object',
                    required: ['productId', 'quantity'],
                    properties: {
                      productId: { type: 'string' },
                      productName: { type: 'string' },
                      quantity: { type: 'integer', minimum: 1 },
                      unitPrice: { type: 'number' },
                    },
                  },
                },
              },
            },
          },
          example: exampleOrderEvent,
        },
      },
    },
    // Extensão própria, só informativa: gatilhos que não são HTTP.
    'x-queue-triggers': [
      {
        function: 'processOrderEvent',
        queue: options.queueName,
        poisonQueue: `${options.queueName}-poison`,
        connection: 'AzureWebJobsStorage',
        messageEncoding: 'base64',
        payload: { $ref: '#/components/schemas/OrderEvent' },
      },
    ],
  };
}

/** GET /api/openapi.json */
export function createOpenApiEndpoint(options: OpenApiOptions): (request: HttpRequest) => Promise<HttpResponseInit> {
  const document = buildOpenApiDocument(options);

  return async (request) => ({
    status: 200,
    jsonBody: document,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-cache',
      [CORRELATION_HEADER]: resolveCorrelationId(request),
    },
  });
}
