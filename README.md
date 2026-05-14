# Forms_admissao — Formulário de admissão Assescont

Formulário web estático que coleta dados de admissão de novos colaboradores e dispara um workflow no n8n responsável por criar o colaborador na **API Solides Gestão V1**.

> **Status:** em produção. O navegador não conhece o token nem o contrato da Solides — toda a integração mora no n8n.

---

## Visão geral

```
[ Candidato ] → [ Form HTML/JS ] ── POST ──► [ Cloudflare Worker ] ── POST ──► [ Webhook n8n ]
                                              (esconde a URL do n8n)                 │
                                                                                     ├─ Validação RH
                                                                                     │
                                                                                     └─ Nó Code "Solides"
                                                                                                  │
                                                                                                  ▼
                                                                                          [ API Solides ]
                                                                                       (token no n8n)
```

O front faz **uma única chamada HTTP** ao submeter: um `POST` para um **Cloudflare Worker** que esconde a URL real do webhook do n8n. O Worker valida o header `Origin`, encaminha o payload pro n8n, e o n8n cuida de todo o resto: mapeamento dos campos para o contrato da API Solides, validação interna do RH e o `POST /colaboradores`.

Nenhum segredo (token da Solides, URL do webhook do n8n) aparece no DevTools do navegador.

## Stack

- **HTML5** estático (sem framework, sem build)
- **CSS** puro (identidade visual Assescont — paleta dourada sobre fundo escuro)
- **JavaScript ES2020** sem dependências (`fetch` nativo)
- **Fontes:** Cormorant Garamond + Montserrat (Google Fonts)
- **APIs externas:** [ViaCEP](https://viacep.com.br) (autocompletar endereço) e webhook do n8n
- **Hospedagem-alvo:** GitHub Pages (ou qualquer host estático com HTTPS)

## Estrutura de arquivos

| Arquivo | Função |
|---|---|
| [index.html](index.html) | Marcação do formulário (dados pessoais, endereço, contato, documentos, dependentes) |
| [styles.css](styles.css) | Identidade visual Assescont |
| [script.js](script.js) | Validação, máscaras, ViaCEP, upload de documentos, consentimento LGPD, envio ao Worker |
| [worker/](worker/) | Cloudflare Worker (proxy entre o front e o n8n) — esconde a URL do webhook |
| [n8n_node_solides.json](n8n_node_solides.json) | Nó Code do n8n que faz o `POST /colaboradores` na Solides |
| [test_n8n_webhook.mjs](test_n8n_webhook.mjs) | Teste end-to-end do webhook do n8n (Node 18+) |
| [test_solides.mjs](test_solides.mjs) | Teste direto contra a API Solides — ferramenta de debug do contrato |
| [DOCUMENTACAO.md](DOCUMENTACAO.md) | Documentação técnica completa: contratos, mapeamentos, troubleshooting |

## O que o formulário coleta

- **Dados pessoais:** nome, CPF, data de nascimento, estado civil, gênero, etnia, nome dos pais
- **Endereço:** CEP (com preenchimento automático via ViaCEP), cidade, estado, bairro, rua, número, complemento
- **Contato:** e-mail, celular
- **Dependentes (opcional):** quantos forem necessários, cada um com slots de documentos condicionais conforme o estado civil do titular
- **Documentos:** RG (frente/verso), CNH, CPF, comprovante de residência, carteira de trabalho, título de eleitor, foto 3×4

Tudo é enviado em uma chamada só ao webhook do n8n (com os arquivos serializados em base64 dentro do JSON).

## Rodar localmente

Não há build — é só servir os estáticos:

```powershell
# Qualquer servidor estático funciona. Exemplo com Python:
python -m http.server 8080
# ou com Node:
npx serve .
```

Abrir `http://localhost:8080` no navegador.

> Não dá pra abrir `index.html` direto pelo `file://` porque o navegador bloqueia `fetch` cross-origin nesse contexto — o ViaCEP e o webhook do n8n vão falhar.

## Testar a integração

```powershell
# Teste do webhook n8n (caminho de produção):
node test_n8n_webhook.mjs

# Teste direto da API Solides (ferramenta de debug):
node test_solides.mjs
```

Detalhes dos testes (o que cada um faz, cuidados, como interpretar a saída) estão na seção **Testes** da [DOCUMENTACAO.md](DOCUMENTACAO.md#11-testes).

## Manutenção rápida

| O que você quer fazer | Onde mexer |
|---|---|
| Adicionar/remover campo do formulário | [index.html](index.html) + [script.js](script.js) (coleta + validação) + nó Code do n8n (mapeamento Solides) |
| Trocar a URL do webhook do n8n | `wrangler secret put N8N_WEBHOOK_URL` no diretório `worker/` — **não toca no front** |
| Trocar a URL pública do Worker | `N8N_CONFIG.webhookUrl` em [script.js](script.js) |
| Adicionar nova origem permitida (novo domínio) | `ALLOWED_ORIGINS` em `worker/wrangler.toml` + `wrangler deploy` |
| Trocar o token da Solides | Painel do n8n (credencial Header Auth ou variável do nó Code) — **não toca no front** |
| Adicionar/remover slot de upload de dependente | Constante `SLOTS_DEPENDENTE` em [script.js](script.js) |
| Ajustar mapeamento de enum (gênero, estado civil, etnia) | Nó Code do n8n (não está no front) |
| Mudar o texto do consentimento LGPD | Bloco `<div class="form-consent">` em [index.html](index.html) |

A [DOCUMENTACAO.md](DOCUMENTACAO.md) tem todos os cenários em detalhe, com tabelas de equivalência form ↔ API, códigos de resposta da Solides, troubleshooting de 4xx, deploy do Worker e mais.

## Segurança

- **Token da Solides** não trafega pelo navegador — fica no n8n.
- **URL do webhook do n8n** não aparece no DevTools — fica em secret do Cloudflare Worker. O navegador só conhece a URL pública do Worker, que faz CORS (só aceita origens da allowlist).
- **Consentimento LGPD** explícito no submit (checkbox obrigatório).
- **Documentos** trafegam por HTTPS em base64 dentro do payload JSON.

Detalhes completos na [seção 7 da DOCUMENTACAO.md](DOCUMENTACAO.md#7-segurança--riscos-atuais-e-plano-de-mitigação).

## Licença

Uso interno Assescont.
