import type { HttpRequest, HttpResponseInit } from '@azure/functions';

const SWAGGER_UI_CDN = 'https://unpkg.com/swagger-ui-dist@5.17.14';

/** GET /api/docs — Swagger UI carregado do unpkg, apontando para o /api/openapi.json desta Function. */
export async function docsEndpoint(request: HttpRequest): Promise<HttpResponseInit> {
  // Descobre o caminho da especificação a partir da própria URL, para funcionar
  // mesmo se o prefixo de rota (/api) for trocado no host.json.
  const specPath = new URL(request.url).pathname.replace(/\/docs\/?$/, '/openapi.json');

  return {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
    body: renderSwaggerPage(specPath),
  };
}

export function renderSwaggerPage(specUrl: string): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Conecta Store — Azure Function (Swagger)</title>
    <link rel="stylesheet" href="${SWAGGER_UI_CDN}/swagger-ui.css" />
    <style>body { margin: 0; background: #fafafa; }</style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="${SWAGGER_UI_CDN}/swagger-ui-bundle.js" crossorigin></script>
    <script>
      window.onload = function () {
        window.ui = SwaggerUIBundle({
          url: ${JSON.stringify(specUrl)},
          dom_id: '#swagger-ui',
          deepLinking: true,
          persistAuthorization: true,
        });
      };
    </script>
  </body>
</html>
`;
}
