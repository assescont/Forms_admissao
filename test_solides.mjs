/**
 * test_solides.mjs
 * ----------------------------------------------
 * Teste de ponta-a-ponta da integração DIRETA com a API
 * Solides (sem passar pelo n8n). Útil para validar o
 * contrato da API isoladamente — formato do header de
 * autenticação, enums aceitos, mensagens de erro 4xx —
 * quando o nó Code do n8n estiver dando problema.
 *
 * ⚠️ Em produção o front NÃO fala mais com a Solides
 * (o token saiu do navegador junto com toda a lógica
 * de mapeamento). Quem cria o colaborador é o nó Code
 * do n8n. Este script é uma ferramenta de debug paralela
 * — manter aqui mas não é o caminho de produção.
 *
 * Como rodar (PowerShell):
 *   $env:SOLIDES_TOKEN='<token>'; node test_solides.mjs
 *
 * Como rodar (bash/zsh):
 *   SOLIDES_TOKEN='<token>' node test_solides.mjs
 *
 * O token é lido de SOLIDES_TOKEN no ambiente para evitar
 * que segredos fiquem hard-coded no repositório.
 *
 * O colaborador criado tem nome começando com "TESTE API"
 * para facilitar a identificação e remoção depois pelo
 * painel da Solides (Configurações > Colaboradores).
 * ============================================ */

const SOLIDES_CONFIG = {
    endpoint: 'https://app.solides.com/pt-BR/api/v1/colaboradores',
    token: process.env.SOLIDES_TOKEN
};

if (!SOLIDES_CONFIG.token) {
    console.error('\nERRO: variavel de ambiente SOLIDES_TOKEN nao definida.\n');
    console.error('PowerShell:  $env:SOLIDES_TOKEN=\'<token>\'; node test_solides.mjs');
    console.error('bash/zsh:    SOLIDES_TOKEN=\'<token>\' node test_solides.mjs\n');
    process.exit(1);
}

/* ---------- utilitários ---------- */

// Gera um CPF válido (apenas dígitos válidos pelo módulo 11).
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

function formatarDataBR(isoDate) {
    const [ano, mes, dia] = isoDate.split('-');
    return `${dia}/${mes}/${ano}`;
}

/* ---------- payload de teste ---------- */

const cpfTeste = gerarCPF();
const timestamp = Date.now();

// Dados fictícios. Nome com prefixo "TESTE API" para localizar depois.
const dadosTeste = {
    nome: `TESTE API - João da Silva Teste ${timestamp}`,
    email: `teste-api-${timestamp}@example.com`,
    cpf: cpfTeste,
    dataNascimento: '1990-05-15',
    estadoCivil: 'solteiro',
    genero: 'M',
    etnia: 'parda',
    nomePai: 'Pai do Teste',
    nomeMae: 'Mãe do Teste',
    cnh: '',
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

// Mesmos mapas usados no script.js (mantenha em sincronia se mudarem lá).
const MAPA_GENERO = { M: 'Masculino', F: 'Feminino', O: null, N: null };
const MAPA_ESTADO_CIVIL = {
    solteiro: 'Solteiro',
    casado: 'Casado',
    divorciado: 'Divorciado',
    viuvo: 'Viúvo',
    uniao_estavel: 'União Estável',
    separado: 'Divorciado'
};
const MAPA_ETNIA = {
    branca: 'Branca',
    preta: 'Preta',
    parda: 'Parda',
    amarela: 'Amarela',
    indigena: 'Indígena',
    nao_declarada: 'Outro'
};

function montarPayloadSolides(dados) {
    const cpfLimpo = dados.cpf.replace(/\D/g, '');

    const payload = {
        name: dados.nome.trim(),
        email: dados.email.trim().toLowerCase(),
        cpf: cpfLimpo,
        idNumber: cpfLimpo,
        birthDate: formatarDataBR(dados.dataNascimento),
        maritalStatus: MAPA_ESTADO_CIVIL[dados.estadoCivil] || null,
        ethnicity: MAPA_ETNIA[dados.etnia] || null,
        motherName: dados.nomeMae.trim(),
        birthPlace: dados.cidadeNascimento.trim(),
        zipCode: dados.cep.replace(/\D/g, ''),
        countryAcronym: 'BR',
        stateAcronym: dados.estado.trim().toUpperCase(),
        city: dados.cidade.trim(),
        neighborhood: dados.bairro.trim(),
        streetName: dados.rua.trim(),
        number: dados.numero.trim(),
        cellPhone: dados.celular.replace(/\D/g, ''),
        nationality: 'Brasileiro',
        dateAdmission: formatarDataBR(new Date().toISOString().slice(0, 10))
    };

    const gender = MAPA_GENERO[dados.genero];
    if (gender) payload.gender = gender;
    if (dados.nomePai?.trim()) payload.fatherName = dados.nomePai.trim();
    if (dados.complemento?.trim()) payload.additionalInformation = dados.complemento.trim();

    const cnhLimpa = dados.cnh?.replace(/\D/g, '');
    if (cnhLimpa) payload.nqc = cnhLimpa;

    return payload;
}

/* ---------- execução ---------- */

async function main() {
    const payload = montarPayloadSolides(dadosTeste);

    console.log('\n=== TESTE DE INTEGRAÇÃO — API SOLIDES ===');
    console.log(`Endpoint: ${SOLIDES_CONFIG.endpoint}`);
    console.log(`CPF gerado: ${cpfTeste}`);
    console.log(`Nome: ${payload.name}`);
    console.log(`Email: ${payload.email}`);
    console.log('\n--- Payload completo ---');
    console.log(JSON.stringify(payload, null, 2));
    console.log('\n--- Enviando... ---\n');

    const inicio = Date.now();
    const response = await fetch(SOLIDES_CONFIG.endpoint, {
        method: 'POST',
        headers: {
            'Authorization': `Token token=${SOLIDES_CONFIG.token}`,
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
    console.log(`Tempo: ${duracao}ms`);
    console.log('\n--- Resposta da Solides ---');
    console.log(typeof resposta === 'string' ? resposta : JSON.stringify(resposta, null, 2));

    if (response.ok) {
        console.log('\n✅ SUCESSO — colaborador criado.');
        if (resposta?.id) {
            console.log(`   ID Solides: ${resposta.id}`);
            console.log(`   Para remover: acesse o painel Solides > Colaboradores`);
            console.log(`   ou use POST /colaboradores/${resposta.id}/demitir`);
        }
    } else {
        console.log('\n❌ FALHA — ver resposta acima.');
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error('\n💥 Erro inesperado:', err);
    process.exit(1);
});
