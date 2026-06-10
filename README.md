# Forms_admissao — Formulário de admissão Assescont

Formulário web estático que coleta dados de admissão de novos colaboradores e dispara um workflow no n8n responsável por criar o colaborador na **API Solides Gestão V1**.

> **Status:** em produção. O navegador não conhece o token nem o contrato da Solides — toda a integração mora no n8n.

---

## Visão geral

```
[ Candidato ] → [ Form HTML/JS ] ── POST ──► [ Webhook n8n ]
                                                    │
                                                    ├─ Aprovação do RH (Teams)
                                                    │
                                                    └─ Nó Code "Solides"
                                                                 │
                                                                 ▼
                                                         [ API Solides ]
                                                      (token no n8n)
```

O front faz **uma única chamada HTTP** ao submeter: um `POST` direto para o webhook do n8n. O n8n cuida de todo o resto: aprovação de cargo/setor pelo RH (formulário no Teams), mapeamento dos campos para o contrato da API Solides e o `POST /colaboradores`.

O token da Solides nunca trafega pelo navegador — fica no n8n. A URL do webhook, porém, **fica visível** no front (envio direto); o controle de acesso é o "Allowed Origins" do nó Webhook no n8n. Existe um Cloudflare Worker em [worker/](worker/) que esconderia essa URL (`Form → Worker → n8n`), mantido como opção de hardening mas **fora de uso** no caminho atual.

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
| [index.html](index.html) | **Front completo (single-file):** marcação, CSS, JS (validação, máscaras, ViaCEP, upload, consentimento LGPD, envio ao n8n) e logo em base64 — sem dependências de arquivos locais. É o arquivo que vai pra hospedagem. |
| [worker/](worker/) | Cloudflare Worker (proxy opcional entre o front e o n8n) — **fora de uso** no caminho atual (o front posta direto no n8n); mantido para hardening futuro |
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
| Adicionar/remover campo do formulário | marcação + `<script>` (coleta + validação) no [index.html](index.html) + nó Code do n8n (mapeamento Solides) |
| Trocar a URL do webhook do n8n | `N8N_CONFIG.webhookUrl` no `<script>` do [index.html](index.html) (o front posta direto no n8n) |
| Restringir origem que pode chamar o webhook | "Allowed Origins" do nó **Webhook** no n8n (hoje `*`) |
| Trocar o token da Solides | Painel do n8n (credencial Header Auth ou variável do nó Code) — **não toca no front** |
| Adicionar/remover slot de upload de dependente | Constante `SLOTS_DEPENDENTE` no `<script>` do [index.html](index.html) |
| Ajustar mapeamento de enum (gênero, estado civil, etnia) | Nó Code do n8n (não está no front) |
| Mudar o texto do consentimento LGPD | Bloco `<div class="form-consent">` em [index.html](index.html) |

A [DOCUMENTACAO.md](DOCUMENTACAO.md) tem todos os cenários em detalhe, com tabelas de equivalência form ↔ API, códigos de resposta da Solides, troubleshooting de 4xx, deploy do Worker e mais.

## Segurança

- **Token da Solides** não trafega pelo navegador — fica no n8n.
- **URL do webhook do n8n** fica visível no DevTools (envio direto). O controle de acesso é o "Allowed Origins" do nó Webhook no n8n — restrinja ao domínio do formulário. Para esconder a URL de vez, usar o Cloudflare Worker em [worker/](worker/) (`Form → Worker → n8n`), hoje fora de uso.
- **Consentimento LGPD** explícito no submit (checkbox obrigatório).
- **Documentos** trafegam por HTTPS em base64 dentro do payload JSON.

Detalhes completos na [seção 7 da DOCUMENTACAO.md](DOCUMENTACAO.md#7-segurança--riscos-atuais-e-plano-de-mitigação).

## Licença

Uso interno Assescont.
