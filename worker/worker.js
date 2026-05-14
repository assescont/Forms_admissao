/* ============================================================
   Cloudflare Worker — Proxy do webhook n8n "Forms de admissão"
   ------------------------------------------------------------
   Por que existe:
     A URL secreta do webhook do n8n NÃO pode aparecer no front
     (DevTools → Network expõe pra qualquer um). Este Worker
     fica entre o navegador e o n8n: recebe o POST do form,
     valida origem, e encaminha pro n8n com a URL guardada como
     secret. O front só conhece a URL pública deste Worker.

   Fluxo:
     [ Form HTML ]  ── POST ──►  [ Worker (este arquivo) ]
                                        │
                                        │ valida Origin (CORS)
                                        │ encaminha JSON
                                        ▼
                                 [ Webhook n8n ]
                                  (URL em env.N8N_WEBHOOK_URL)

   Configuração:
     - N8N_WEBHOOK_URL  → secret (URL completa do webhook do n8n)
     - ALLOWED_ORIGINS  → var (CSV dos domínios permitidos)

   Configurar via wrangler:
     wrangler secret put N8N_WEBHOOK_URL
     # cola a URL completa: https://n8n.srv...../webhook/<id>

   ALLOWED_ORIGINS é setado no wrangler.toml (não é segredo).
   ============================================================ */

/** Tamanho máximo do payload aceito (em bytes). 50MB cobre vários
 *  documentos em base64. Ajustar se o reverse proxy do n8n aceitar
 *  mais — mas cuidado: payload grande demais aumenta custo e risco
 *  de DoS. */
const MAX_BODY_BYTES = 50 * 1024 * 1024;

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';
        const allowed = parseOrigins(env.ALLOWED_ORIGINS);
        const originOk = allowed.includes(origin);

        // ---- CORS preflight ----
        if (request.method === 'OPTIONS') {
            // Mesmo que o origin não seja conhecido, devolvemos um 204
            // sem os headers de CORS; o navegador bloqueia sozinho.
            return new Response(null, {
                status: 204,
                headers: corsHeaders(originOk ? origin : null)
            });
        }

        // ---- Só aceitamos POST ----
        if (request.method !== 'POST') {
            return jsonError(405, 'Method Not Allowed', corsHeaders(null));
        }

        // ---- Origem precisa estar na allowlist ----
        // Observação: este check confia no header Origin que o navegador
        // adiciona automaticamente. Requisições server-to-server podem
        // forjar esse header — para hardening adicional, combinar com
        // Cloudflare Turnstile ou um nonce assinado.
        if (!originOk) {
            return jsonError(403, 'Forbidden: origem não autorizada', corsHeaders(null));
        }

        // ---- Configuração obrigatória ----
        if (!env.N8N_WEBHOOK_URL) {
            console.error('N8N_WEBHOOK_URL não configurada nos secrets do Worker.');
            return jsonError(500, 'Proxy mal configurado', corsHeaders(origin));
        }

        // ---- Limite de tamanho ----
        const contentLength = parseInt(request.headers.get('Content-Length') || '0', 10);
        if (contentLength > MAX_BODY_BYTES) {
            return jsonError(413, 'Payload muito grande', corsHeaders(origin));
        }

        // ---- Encaminha para o n8n ----
        let upstream;
        try {
            upstream = await fetch(env.N8N_WEBHOOK_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                    // Se o webhook do n8n usar Header Auth, o token vai aqui:
                    // 'Authorization': env.N8N_AUTH_HEADER
                },
                body: request.body
            });
        } catch (err) {
            console.error('Falha ao chamar o n8n:', err);
            return jsonError(502, 'Upstream (n8n) inalcançável', corsHeaders(origin));
        }

        // Repassa status e corpo do n8n para o front, mantendo CORS.
        const responseBody = await upstream.text();
        return new Response(responseBody, {
            status: upstream.status,
            headers: {
                ...corsHeaders(origin),
                'Content-Type': upstream.headers.get('content-type') || 'application/json'
            }
        });
    }
};

/** Lê a env ALLOWED_ORIGINS (CSV) e devolve array sem espaços. */
function parseOrigins(csv) {
    if (!csv) return [];
    return csv.split(',').map(s => s.trim()).filter(Boolean);
}

/** Monta os headers de CORS. Se origin for null, devolve só
 *  Vary: Origin (o navegador rejeita por falta de Allow-Origin). */
function corsHeaders(origin) {
    const base = { 'Vary': 'Origin' };
    if (!origin) return base;
    return {
        ...base,
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Accept',
        'Access-Control-Max-Age': '86400'
    };
}

/** Resposta JSON padronizada para erros do próprio Worker. */
function jsonError(status, message, headers) {
    return new Response(JSON.stringify({ ok: false, error: message }), {
        status,
        headers: {
            ...headers,
            'Content-Type': 'application/json'
        }
    });
}
