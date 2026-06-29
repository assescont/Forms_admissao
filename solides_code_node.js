// ============================================================
// Solides - Criar Colaborador (Code node)
// ------------------------------------------------------------
// Fonte LEGIVEL do codigo que vai dentro do no "Solides -
// Criar Colaborador" do workflow no n8n. O mesmo codigo esta,
// escapado, em n8n_node_solides.json (formato importavel).
// Para aplicar: copie TODO o conteudo abaixo e cole no campo
// "JavaScript" do no no n8n, trocando COLE_SEU_TOKEN_AQUI pelo
// token Solides da empresa.
//
// Le os dados CRUS do formulario que chegam no Webhook
// (body.formulario), MAPEIA para o contrato da API Solides
// (enum por extenso, data dd/mm/aaaa, DDI 55 no telefone,
// endereco achatado) e injeta cargo/setor escolhidos pelo RH
// no Teams. Roda DEPOIS do no do Teams (sendAndWait).
// ============================================================

const SOLIDES_ENDPOINT = 'https://app.solides.com/pt-BR/api/v1/colaboradores';
const SOLIDES_TOKEN    = 'COLE_SEU_TOKEN_AQUI';

// ------------------------------------------------------------
// Mapas de enum (form -> API Solides)
// ------------------------------------------------------------
const MAPA_GENERO = { M: 'Masculino', F: 'Feminino', O: null, N: null };

const MAPA_ESTADO_CIVIL = {
  solteiro:      'Solteiro',
  casado:        'Casado',
  divorciado:    'Divorciado',
  viuvo:         'Viúvo',
  uniao_estavel: 'União Estável',
  separado:      'Divorciado'   // API nao tem 'Separado'; aproximacao
};

const MAPA_ETNIA = {
  branca:        'Branca',
  preta:         'Preta',
  parda:         'Parda',
  amarela:       'Amarela',
  indigena:      'Indígena',
  nao_declarada: 'Outro'
};

const MAPA_GRAU_INSTRUCAO = {
  fundamental_incompleto: 'Ensino Fundamental Incompleto',
  fundamental:            'Ensino Fundamental Completo',
  medio_incompleto:       'Ensino Médio Incompleto',
  medio:                  'Ensino Médio Completo',
  superior_incompleto:    'Ensino Superior Incompleto',
  superior:               'Ensino Superior Completo',
  pos:                    'Pós-Graduação',
  mestrado:               'Mestrado',
  doutorado:              'Doutorado'
};

// ------------------------------------------------------------
// Utilitarios de normalizacao
// ------------------------------------------------------------
function formatarDataBR(isoDate) {
  if (!isoDate) return null;
  const [ano, mes, dia] = String(isoDate).split('-');
  if (!ano || !mes || !dia) return null;
  return `${dia}/${mes}/${ano}`;
}

// A Solides parseia cellPhone como E.164. Sem o '55', um numero
// brasileiro acaba interpretado como +1 (EUA). Esta funcao
// garante o DDI 55 antes do DDD.
function normalizarCelular(celular) {
  if (!celular) return null;
  const digitos = String(celular).replace(/\D/g, '');
  if (digitos.length === 10 || digitos.length === 11) return '55' + digitos;
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) return digitos;
  return digitos;
}

// ------------------------------------------------------------
// 1) Le os campos crus do formulario (do Webhook)
// ------------------------------------------------------------
const body  = $('Webhook').first().json.body;
const dados = body && body.formulario;

if (!dados || typeof dados !== 'object') {
  throw new Error(
    'Payload de entrada nao contem "body.formulario". Confira se o front ' +
    'esta enviando { metadata, formulario, documentos, dependentes } e se ' +
    'este no esta apos o Webhook e o no do Teams.'
  );
}

// ------------------------------------------------------------
// 2) Monta o payload no contrato da API Solides
// ------------------------------------------------------------
const cpfLimpo = String(dados.cpf || '').replace(/\D/g, '');

const colaborador = {
  // --- Dados cadastrais ---
  name:     String(dados.nome  || '').trim(),
  email:    String(dados.email || '').trim().toLowerCase(),
  cpf:      cpfLimpo,
  idNumber: cpfLimpo,

  // --- Dados pessoais ---
  birthDate:     formatarDataBR(dados.dataNascimento),
  maritalStatus: MAPA_ESTADO_CIVIL[dados.estadoCivil] || null,
  ethnicity:     MAPA_ETNIA[dados.etnia] || null,
  motherName:    String(dados.nomeMae || '').trim(),
  birthPlace:    String(dados.cidadeNascimento || '').trim(),

  // --- Escolaridade ---
  schooling:     MAPA_GRAU_INSTRUCAO[dados.grauInstrucao] || null,

  // --- Endereco (campos achatados) ---
  zipCode:        String(dados.cep || '').replace(/\D/g, ''),
  countryAcronym: 'BR',
  stateAcronym:   String(dados.estado || '').trim().toUpperCase(),
  city:           String(dados.cidade  || '').trim(),
  neighborhood:   String(dados.bairro  || '').trim(),
  streetName:     String(dados.rua     || '').trim(),
  number:         String(dados.numero  || '').trim(),

  // --- Contato (com DDI: ver normalizarCelular) ---
  cellPhone: normalizarCelular(dados.celular),

  // --- Padroes uteis para HR ---
  nationality:   'Brasileiro',
  dateAdmission: formatarDataBR(new Date().toISOString().slice(0, 10))
};

// --- Opcionais (so envia se preencheu) ---
const gender = MAPA_GENERO[dados.genero];
if (gender) colaborador.gender = gender;
if (dados.nomePai && String(dados.nomePai).trim()) {
  colaborador.fatherName = String(dados.nomePai).trim();
}
if (dados.complemento && String(dados.complemento).trim()) {
  colaborador.additionalInformation = String(dados.complemento).trim();
}
if (dados.formacao && String(dados.formacao).trim()) {
  colaborador.course = String(dados.formacao).trim();
}

// ------------------------------------------------------------
// 3) Cargo/Setor escolhidos pelo RH no formulario do Teams
//    Os fieldLabel sao "Cargo" e "Setor " (com espaco no fim).
// ------------------------------------------------------------
const respostaTeams = $('Envia mensagem e aguarda resposta do RH').first().json;
const cargo = respostaTeams && respostaTeams.data && respostaTeams.data.Cargo;
const setor = respostaTeams && respostaTeams.data && respostaTeams.data['Setor '];
if (cargo) colaborador.position   = String(cargo).trim();
if (setor) colaborador.department = String(setor).trim();

// ------------------------------------------------------------
// 4) Sanity check dos obrigatorios pela Solides
// ------------------------------------------------------------
for (const campo of ['name', 'email', 'cpf']) {
  if (!colaborador[campo] || String(colaborador[campo]).trim() === '') {
    throw new Error(`Campo obrigatorio ausente no payload Solides: ${campo}`);
  }
}

// ------------------------------------------------------------
// 5) POST via helper nativo do n8n (fetch nao e garantido no
//    Code node). returnFullResponse devolve { statusCode, body }.
// ------------------------------------------------------------
let response;
try {
  response = await this.helpers.httpRequest({
    method: 'POST',
    url: SOLIDES_ENDPOINT,
    headers: {
      'Authorization': `Token token=${SOLIDES_TOKEN}`,
      'Accept':        'application/json',
      'Content-Type':  'application/json'
    },
    body: colaborador,
    json: true,
    returnFullResponse: true
  });
} catch (err) {
  const respostaErro = (err && err.response) || (err && err.cause && err.cause.response) || null;
  const corpoErro    = respostaErro && (respostaErro.body || respostaErro.data);
  const statusErro   = (respostaErro && (respostaErro.statusCode || respostaErro.status)) || err.httpCode || 'desconhecido';

  let detalhe;
  if (corpoErro && typeof corpoErro === 'object') {
    detalhe = corpoErro.message
      || corpoErro.error
      || (Array.isArray(corpoErro.errors) ? corpoErro.errors.join(', ') : null)
      || JSON.stringify(corpoErro);
  } else if (typeof corpoErro === 'string') {
    detalhe = corpoErro;
  } else {
    detalhe = err.message || 'erro desconhecido';
  }
  throw new Error(`Solides retornou ${statusErro}: ${detalhe}`);
}

const corpo  = response.body;
const status = response.statusCode;

// ------------------------------------------------------------
// 6) Sucesso - devolve id + corpo bruto + ecoa metadata/cargo/setor
// ------------------------------------------------------------
return [
  {
    json: {
      ok: true,
      status,
      solidesId: (corpo && corpo.id) || null,
      solidesResponse: corpo,
      metadata: body.metadata || null,
      cargo,
      setor,
      candidato: {
        nome:  colaborador.name,
        email: colaborador.email,
        cpf:   colaborador.cpf
      }
    }
  }
];
