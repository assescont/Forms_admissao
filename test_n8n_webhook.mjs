/**
 * test_n8n_webhook.mjs
 * ----------------------------------------------
 * Teste de ponta-a-ponta da integração com o
 * webhook n8n "Forms de admissão".
 *
 * Replica a estrutura de payload do front
 * (montarPayloadN8N em script.js): metadata +
 * formulario + documentos (base64) +
 * dependentes (base64).
 *
 * O mapeamento dos campos para o contrato da
 * API Solides acontece dentro do próprio
 * workflow do n8n, não aqui — este teste só
 * exercita o webhook.
 *
 * Como rodar (PowerShell):
 *   $env:N8N_WEBHOOK_URL='https://...../webhook-test/<id>'; node test_n8n_webhook.mjs
 *
 * Como rodar (bash/zsh):
 *   N8N_WEBHOOK_URL='https://...../webhook-test/<id>' node test_n8n_webhook.mjs
 *
 * A URL do webhook é lida de N8N_WEBHOOK_URL no ambiente
 * para evitar que fique hard-coded no repositório (em
 * produção a URL é tratada como credencial — quem tem
 * a URL pode disparar o workflow).
 *
 * O candidato de teste tem nome começando com
 * "TESTE WEBHOOK" para facilitar identificação
 * no fluxo do n8n. O e-mail do candidato é
 * controlado abaixo (EMAIL_DESTINO_TESTE) caso
 * o workflow encaminhe para o endereço do
 * candidato.
 *
 * Imagens dos documentos: PNGs de 200x150 px
 * com cores distintas por slot, geradas no ato
 * (sem dependências externas). Permitem validar
 * visualmente, no n8n, que o base64 chega
 * íntegro e decodifica de volta em imagem.
 * ============================================ */

import { deflateSync } from 'node:zlib';

const N8N_CONFIG = {
    webhookUrl: process.env.N8N_WEBHOOK_URL
};

if (!N8N_CONFIG.webhookUrl) {
    console.error('\nERRO: variavel de ambiente N8N_WEBHOOK_URL nao definida.\n');
    console.error('PowerShell:  $env:N8N_WEBHOOK_URL=\'https://...../webhook-test/<id>\'; node test_n8n_webhook.mjs');
    console.error('bash/zsh:    N8N_WEBHOOK_URL=\'https://...../webhook-test/<id>\' node test_n8n_webhook.mjs\n');
    process.exit(1);
}

// E-mail que o workflow "Forms de admissão" deve disparar.
// Usado como `email` do candidato neste teste para que o nó de envio
// no n8n possa pegar o destinatário do próprio payload se quiser.
const EMAIL_DESTINO_TESTE = 'gabriel.ferreria@assescont.com';

/* ---------- utilitários (espelham script.js) ---------- */

function gerarCPF() {
    const rnd = (n) => Math.floor(Math.random() * n);
    const base = Array.from({ length: 9 }, () => rnd(10));
    const calcDV = (digits, pesoInicial) => {
        const soma = digits.reduce((acc, d, i) => acc + d * (pesoInicial - i), 0);
        const r = 11 - (soma % 11);
        return r >= 10 ? 0 : r;
    };
    const d1 = calcDV(base, 10);
    const d2 = calcDV([...base, d1], 11);
    return [...base, d1, d2].join('');
}

/* ---------- dados de teste (mesma base do test_solides.mjs) ---------- */

const cpfTeste = gerarCPF();
const cpfDependente = gerarCPF();
const timestamp = Date.now();

const dadosTeste = {
    nome: `TESTE WEBHOOK - João da Silva Teste ${timestamp}`,
    // Usa o e-mail-alvo como e-mail do candidato. Assim o nó de envio
    // do n8n pode tirar o destinatário do payload sem precisar
    // hard-codar nada do lado de lá.
    email: EMAIL_DESTINO_TESTE,
    cpf: cpfTeste,
    dataNascimento: '1990-05-15',
    estadoCivil: 'solteiro',
    genero: 'M',
    etnia: 'parda',
    nomePai: 'Pai do Teste',
    nomeMae: 'Mãe do Teste',
    temDependentes: 'nao',
    cep: '01310100',
    cidadeNascimento: 'São Paulo',
    cidade: 'São Paulo',
    estado: 'SP',
    bairro: 'Bela Vista',
    rua: 'Avenida Paulista',
    numero: '1000',
    complemento: 'Apto 101',
    celular: '11987654321'
};

/* ---------- gerador de PNG colorido (sem dependências) ----------
   PNG é um formato simples o suficiente para construir à mão usando
   só `zlib` (nativo do Node). Cada chunk = [length(4)] [type(4)]
   [data] [crc32(4)]. Geramos um PNG 8-bit RGB com pixels sólidos.

   Por que não usar bibliotecas (jimp, sharp, canvas):
     - test_n8n_webhook.mjs não tem package.json e queremos manter
       o teste livre de `npm install`.
     - 60 linhas de código resolvem para o que precisamos: imagens
       coloridas distintas por slot para inspeção visual no n8n.
*/

// Tabela CRC32 pré-calculada (polinômio 0xEDB88320, padrão PNG/zlib).
const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
    }
    return t;
})();

function crc32(buf) {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

// Empacota um chunk PNG: length + type + data + CRC.
function chunk(type, data) {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
}

function gerarPNGColorido(largura, altura, [r, g, b]) {
    // Assinatura padrão do PNG.
    const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

    // IHDR: largura, altura, bitDepth=8, colorType=2 (RGB), compress=0, filter=0, interlace=0.
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(largura, 0);
    ihdr.writeUInt32BE(altura, 4);
    ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

    // IDAT: para cada linha um byte de filtro (0=None) seguido de RGB de cada pixel.
    const rowBytes = largura * 3 + 1;
    const raw = Buffer.alloc(rowBytes * altura);
    for (let y = 0; y < altura; y++) {
        raw[y * rowBytes] = 0;
        for (let x = 0; x < largura; x++) {
            const off = y * rowBytes + 1 + x * 3;
            raw[off] = r; raw[off + 1] = g; raw[off + 2] = b;
        }
    }

    return Buffer.concat([
        sig,
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

// Cores RGB distintas por slot — escolhidas para serem facilmente
// distinguíveis a olho nu no n8n. Cada um dos 8 slots do candidato
// tem uma cor única, mais 3 cores para slots de dependente.
const CORES_SLOT = {
    rgFrente:              [220,  53,  69],   // vermelho
    rgVerso:               [ 13, 110, 253],   // azul
    cnhDoc:                [255,  87,  34],   // laranja
    cpfDoc:                [ 25, 135,  84],   // verde
    comprovanteResidencia: [  0, 150, 136],   // verde-azulado
    carteiraTrabalho:      [ 63,  81, 181],   // azul-índigo
    tituloEleitor:         [121,  85,  72],   // marrom
    foto3x4:               [255, 193,   7],   // amarelo
    certidaoNasc:          [108,  92, 231],   // roxo
    certidaoCasamento:     [232,  62, 140],   // rosa
    cpfDepDoc:             [ 32, 201, 151]    // turquesa
};

function gerarDocPNG(nomeArquivo, slotKey) {
    const cor = CORES_SLOT[slotKey] || [128, 128, 128];
    const png = gerarPNGColorido(200, 150, cor);
    return {
        nome_arquivo: nomeArquivo,
        tipo: 'image/png',
        tamanho: png.length,
        conteudo_base64: png.toString('base64')
    };
}

/* ---------- montagem do payload n8n (espelha montarPayloadN8N do front) ---------- */

function montarPayloadN8N(dados) {
    return {
        metadata: {
            origem: 'forms-admissao-assescont',
            versao: '1.0',
            enviado_em: new Date().toISOString(),
            candidato_cpf: dados.cpf.replace(/\D/g, ''),
            candidato_email: dados.email.trim().toLowerCase(),
            // Marca este envio como teste para o n8n poder filtrar
            // (workflow pode ramificar com base nesse campo se quiser).
            ambiente: 'teste',
            disparado_por: 'test_n8n_webhook.mjs'
        },
        formulario: dados,
        // Todos os 8 slots de documento do candidato preenchidos
        // (mesmas chaves do data-doc dos elementos no index.html).
        documentos: {
            rgFrente:              gerarDocPNG('rg-frente.png',             'rgFrente'),
            rgVerso:               gerarDocPNG('rg-verso.png',              'rgVerso'),
            cnhDoc:                gerarDocPNG('cnh.png',                   'cnhDoc'),
            cpfDoc:                gerarDocPNG('cpf.png',                   'cpfDoc'),
            comprovanteResidencia: gerarDocPNG('comprovante-residencia.png','comprovanteResidencia'),
            carteiraTrabalho:      gerarDocPNG('carteira-trabalho.png',     'carteiraTrabalho'),
            tituloEleitor:         gerarDocPNG('titulo-eleitor.png',        'tituloEleitor'),
            foto3x4:               gerarDocPNG('foto-3x4.png',              'foto3x4')
        },
        // Sem dependentes neste cenário — o front envia array vazio quando
        // o candidato responde "Não" em "Possui dependentes?".
        dependentes: []
    };
}

/* ---------- execução ---------- */

async function main() {
    const payload = montarPayloadN8N(dadosTeste);
    const tamanhoPayloadKB = (JSON.stringify(payload).length / 1024).toFixed(1);

    console.log('\n=== TESTE DE INTEGRAÇÃO — WEBHOOK n8n "Forms de admissão" ===');
    console.log(`Endpoint:           ${N8N_CONFIG.webhookUrl}`);
    console.log(`E-mail de destino:  ${EMAIL_DESTINO_TESTE}`);
    console.log(`Candidato:          ${payload.formulario.nome}`);
    console.log(`CPF gerado:         ${cpfTeste}`);
    console.log(`Documentos:         ${Object.keys(payload.documentos).join(', ')}`);
    console.log(`Dependentes:        ${payload.dependentes.length}`);
    console.log(`Tamanho do payload: ${tamanhoPayloadKB} KB`);
    console.log('\n--- Resumo do payload (sem base64) ---');
    console.log(JSON.stringify({
        metadata: payload.metadata,
        formulario_keys: Object.keys(payload.formulario),
        documentos_keys: Object.keys(payload.documentos),
        dependentes_resumo: payload.dependentes.map(d => ({
            numero: d.numero,
            arquivos_keys: Object.keys(d.arquivos)
        }))
    }, null, 2));
    // Confirma visualmente que cada documento foi codificado em base64.
    console.log('\n--- Base64 de cada documento (prévia 60 chars) ---');
    let docsOk = 0, docsFalha = 0;
    Object.entries(payload.documentos).forEach(([slot, doc]) => {
        const previa = doc.conteudo_base64.slice(0, 60);
        const tamKB = (doc.conteudo_base64.length / 1024).toFixed(2);
        // Validação: base64 começa com a assinatura do PNG (iVBORw...).
        const ehPngValido = doc.conteudo_base64.startsWith('iVBORw0KGgo');
        const status = ehPngValido ? '✅' : '❌';
        if (ehPngValido) docsOk++; else docsFalha++;
        console.log(`  ${status} ${slot.padEnd(10)} | ${doc.nome_arquivo.padEnd(18)} | ${tamKB} KB | ${previa}...`);
    });
    console.log(`\n  Total: ${docsOk} OK | ${docsFalha} com problema`);

    // Auditoria: todos os campos esperados foram preenchidos?
    console.log('\n--- Auditoria de preenchimento ---');
    const camposObrigatorios = {
        'formulario.nome':           payload.formulario.nome,
        'formulario.email':          payload.formulario.email,
        'formulario.cpf':            payload.formulario.cpf,
        'formulario.dataNascimento': payload.formulario.dataNascimento,
        'formulario.estadoCivil':    payload.formulario.estadoCivil,
        'formulario.genero':         payload.formulario.genero,
        'formulario.etnia':          payload.formulario.etnia,
        'formulario.nomeMae':        payload.formulario.nomeMae,
        'formulario.cep':            payload.formulario.cep,
        'formulario.cidade':         payload.formulario.cidade,
        'formulario.estado':         payload.formulario.estado,
        'formulario.bairro':         payload.formulario.bairro,
        'formulario.rua':            payload.formulario.rua,
        'formulario.numero':         payload.formulario.numero,
        'formulario.celular':        payload.formulario.celular,
        'formulario.temDependentes': payload.formulario.temDependentes,
        'metadata.candidato_cpf':    payload.metadata.candidato_cpf,
        'metadata.candidato_email':  payload.metadata.candidato_email
    };
    let okCount = 0, vaziosCount = 0;
    Object.entries(camposObrigatorios).forEach(([campo, valor]) => {
        const preenchido = valor !== null && valor !== undefined && String(valor).trim() !== '';
        if (preenchido) okCount++; else vaziosCount++;
        if (!preenchido) console.log(`  ❌ ${campo} — VAZIO`);
    });
    console.log(`  ✅ ${okCount}/${okCount + vaziosCount} campos preenchidos${vaziosCount === 0 ? ' (todos OK)' : ''}`);

    console.log('\n--- Enviando... ---\n');

    const inicio = Date.now();
    const response = await fetch(N8N_CONFIG.webhookUrl, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });
    const duracao = Date.now() - inicio;

    const textoResposta = await response.text();
    let resposta;
    try { resposta = JSON.parse(textoResposta); } catch { resposta = textoResposta; }

    console.log(`Status HTTP: ${response.status} ${response.statusText}`);
    console.log(`Tempo:       ${duracao}ms`);
    console.log(`Content-Type da resposta: ${response.headers.get('content-type') || '(ausente)'}`);
    console.log('\n--- Resposta do n8n ---');
    console.log(typeof resposta === 'string'
        ? (resposta || '(corpo vazio)')
        : JSON.stringify(resposta, null, 2));

    // Health check da integração: HTTP 2xx + corpo coerente.
    console.log('\n--- Health check da chamada ao n8n ---');
    const checagens = [
        ['HTTP entre 200 e 299',     response.status >= 200 && response.status < 300],
        ['Tempo abaixo de 5s',       duracao < 5000],
        ['Resposta não vazia',       resposta !== null && resposta !== ''],
        ['Workflow disparado',       typeof resposta === 'object'
                                        && resposta?.message?.toLowerCase().includes('workflow')]
    ];
    checagens.forEach(([nome, ok]) => {
        console.log(`  ${ok ? '✅' : '⚠️ '} ${nome}`);
    });

    if (response.ok) {
        console.log('\n✅ SUCESSO — webhook recebeu o payload.');
        console.log(`   Verifique a inbox de ${EMAIL_DESTINO_TESTE} para o e-mail de teste.`);
        console.log('   Caso o e-mail não chegue, abra o histórico de execuções do');
        console.log('   workflow "Forms de admissão" no n8n para ver onde parou.');
    } else {
        console.log('\n❌ FALHA — ver resposta acima.');
        if (response.status === 404) {
            console.log('   404 = workflow inativo OU URL trocada. Confira o toggle do');
            console.log('   workflow no n8n e o id do webhook.');
        }
        if (response.status === 413) {
            console.log('   413 = payload grande demais. Aumentar limite do reverse');
            console.log('   proxy do n8n (client_max_body_size).');
        }
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error('\n💥 Erro inesperado:', err);
    process.exit(1);
});
