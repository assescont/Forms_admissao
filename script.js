/* ============================================
   ASSESCONT — FORMULÁRIO DE ADMISSÃO
   Lógica do formulário + integração API Solides
   ============================================ */

/* ============================================
   CONFIGURAÇÃO DA API SOLIDES
   ----------------------------------------------
   ⚠️ IMPORTANTE SEGURANÇA:
   NUNCA exponha o token de API em código 
   front-end em produção!
   
   ✅ SOLUÇÃO CORRETA:
   1. Seu HTML/JS envia dados para seu servidor
   2. Seu servidor recebe os dados
   3. Seu servidor envia para Solides com token
      armazenado de forma segura (variável de 
      ambiente, vault, etc)
   
   Para testar agora:
   - Confirme o endpoint correto com Solides
   - Substitua a URL e token nos campos abaixo
   ============================================ */
const SOLIDES_CONFIG = {
    // Endpoint para criar novo colaborador
    // AJUSTE CONFORME SUA DOCUMENTAÇÃO SOLIDES
    // Exemplos possíveis:
    // - https://api.solides.com.br/v2/colaboradores
    // - https://seu-dominio.solides.com.br/api/v1/employees
    endpoint: 'https://api.solides.com.br/v2/colaboradores',

    // SUBSTITUA COM SEU TOKEN OU USE UM PROXY
    // Melhor prática: enviar para seu back-end primeiro
    token: 'SEU_TOKEN_AQUI',

    // ID da empresa no Solides
    empresaId: '00412280000145'
};
};

/* ============================================
   ELEMENTOS
   ============================================ */
const form = document.getElementById('admissionForm');
const submitBtn = document.getElementById('submitBtn');
const feedback = document.getElementById('feedback');

// ✅ Verificação de elementos críticos
if (!form || !submitBtn || !feedback) {
    console.error('❌ ERRO CRÍTICO: Elementos do formulário não encontrados!');
    console.error({
        formExists: !!form,
        submitBtnExists: !!submitBtn,
        feedbackExists: !!feedback
    });
}

/* ============================================
   GERENCIAMENTO DE DOCUMENTOS
   ============================================ */
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const documentosArquivos = {}; // { rgFrente: File, rgVerso: File, ... }

function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function renderPreview(uploadEl, file) {
    const preview = uploadEl.querySelector('.doc-preview');
    const hint = uploadEl.querySelector('.doc-hint');
    const isImage = file.type.startsWith('image/');

    preview.innerHTML = '';

    // Thumbnail (apenas para imagens)
    if (isImage) {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(file);
        img.alt = file.name;
        preview.appendChild(img);
    } else {
        const icon = document.createElement('div');
        icon.style.cssText = 'width:36px;height:36px;display:flex;align-items:center;justify-content:center;background:var(--accent-soft);color:var(--accent-dark);font-size:0.7rem;font-weight:600';
        icon.textContent = 'PDF';
        preview.appendChild(icon);
    }

    // Info do arquivo
    const info = document.createElement('div');
    info.className = 'file-info';
    info.innerHTML = `
        <span class="file-name">${file.name}</span>
        <span class="file-size">${formatFileSize(file.size)}</span>
    `;
    preview.appendChild(info);

    // Botão de remover
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'file-remove';
    removeBtn.innerHTML = '✕';
    removeBtn.title = 'Remover arquivo';
    removeBtn.addEventListener('click', () => removerDocumento(uploadEl));
    preview.appendChild(removeBtn);

    preview.hidden = false;
    uploadEl.classList.add('has-file');
    uploadEl.classList.remove('error');
    hint.textContent = 'Arquivo carregado';
}

function removerDocumento(uploadEl) {
    const docKey = uploadEl.dataset.doc;
    const input = uploadEl.querySelector('input[type="file"]');
    const preview = uploadEl.querySelector('.doc-preview');
    const hint = uploadEl.querySelector('.doc-hint');

    delete documentosArquivos[docKey];
    input.value = '';
    preview.innerHTML = '';
    preview.hidden = true;
    uploadEl.classList.remove('has-file');
    hint.textContent = 'Clique ou arraste o arquivo';
}

function handleFile(uploadEl, file) {
    const docKey = uploadEl.dataset.doc;

    // Validação de tamanho
    if (file.size > MAX_FILE_SIZE) {
        uploadEl.classList.add('error');
        showFeedback('error', `O arquivo "${file.name}" excede o limite de 5MB.`);
        return;
    }

    // Validação de tipo
    const validTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf'];
    if (!validTypes.includes(file.type)) {
        uploadEl.classList.add('error');
        showFeedback('error', `Formato inválido. Use JPG, PNG ou PDF.`);
        return;
    }

    documentosArquivos[docKey] = file;
    renderPreview(uploadEl, file);
    hideFeedback();
}

// Bind dos eventos em cada zona de upload
document.querySelectorAll('.doc-upload').forEach(uploadEl => {
    const input = uploadEl.querySelector('input[type="file"]');
    const dropzone = uploadEl.querySelector('.doc-dropzone');

    input.addEventListener('change', e => {
        const file = e.target.files[0];
        if (file) handleFile(uploadEl, file);
    });

    // Drag & drop
    ['dragenter', 'dragover'].forEach(evt => {
        dropzone.addEventListener(evt, e => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach(evt => {
        dropzone.addEventListener(evt, e => {
            e.preventDefault();
            e.stopPropagation();
            dropzone.classList.remove('dragover');
        });
    });

    dropzone.addEventListener('drop', e => {
        const file = e.dataTransfer.files[0];
        if (file) {
            input.files = e.dataTransfer.files;
            handleFile(uploadEl, file);
        }
    });
});

/* ============================================
   CONVERSÃO DE ARQUIVO PARA BASE64
   ============================================ */
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]); // remove "data:...;base64,"
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

async function montarDocumentosBase64() {
    const docs = {};
    for (const [key, file] of Object.entries(documentosArquivos)) {
        docs[key] = {
            nome_arquivo: file.name,
            tipo: file.type,
            tamanho: file.size,
            conteudo_base64: await fileToBase64(file)
        };
    }
    return docs;
}

/* ============================================
   MÁSCARAS DE CAMPOS
   ============================================ */

// CPF: 000.000.000-00
function maskCPF(value) {
    return value
        .replace(/\D/g, '')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
        .substring(0, 14);
}

// CEP: 00000-000
function maskCEP(value) {
    return value
        .replace(/\D/g, '')
        .replace(/(\d{5})(\d)/, '$1-$2')
        .substring(0, 9);
}

// Celular: (00) 00000-0000
function maskPhone(value) {
    return value
        .replace(/\D/g, '')
        .replace(/(\d{2})(\d)/, '($1) $2')
        .replace(/(\d{5})(\d)/, '$1-$2')
        .substring(0, 15);
}

// CNH: apenas números, máx 11
function maskCNH(value) {
    return value.replace(/\D/g, '').substring(0, 11);
}

// Bind das máscaras (com verificação de existência)
const cpfInput = document.getElementById('cpf');
if (cpfInput) {
    cpfInput.addEventListener('input', e => {
        e.target.value = maskCPF(e.target.value);
    });
}

const cepInput = document.getElementById('cep');
if (cepInput) {
    cepInput.addEventListener('input', e => {
        e.target.value = maskCEP(e.target.value);
        if (e.target.value.replace(/\D/g, '').length === 8) {
            buscarCEP(e.target.value);
        }
    });
}

const celularInput = document.getElementById('celular');
if (celularInput) {
    celularInput.addEventListener('input', e => {
        e.target.value = maskPhone(e.target.value);
    });
}

const cnhInput = document.getElementById('cnh');
if (cnhInput) {
    cnhInput.addEventListener('input', e => {
        e.target.value = maskCNH(e.target.value);
    });
}

/* ============================================
   VALIDAÇÃO DE CPF
   ============================================ */
function validarCPF(cpf) {
    cpf = cpf.replace(/\D/g, '');
    if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;

    let soma = 0;
    for (let i = 0; i < 9; i++) soma += parseInt(cpf[i]) * (10 - i);
    let dig1 = 11 - (soma % 11);
    if (dig1 >= 10) dig1 = 0;
    if (dig1 !== parseInt(cpf[9])) return false;

    soma = 0;
    for (let i = 0; i < 10; i++) soma += parseInt(cpf[i]) * (11 - i);
    let dig2 = 11 - (soma % 11);
    if (dig2 >= 10) dig2 = 0;
    return dig2 === parseInt(cpf[10]);
}

/* ============================================
   INTEGRAÇÃO ViaCEP — preenchimento automático
   ============================================ */
async function buscarCEP(cep) {
    const cepLimpo = cep.replace(/\D/g, '');
    if (cepLimpo.length !== 8) return;

    showFeedback('info', 'Buscando endereço...');

    try {
        const response = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
        const data = await response.json();

        if (data.erro) {
            showFeedback('error', 'CEP não encontrado. Preencha manualmente.');
            return;
        }

        document.getElementById('cidade').value = data.localidade || '';
        document.getElementById('estado').value = data.uf || '';
        document.getElementById('bairro').value = data.bairro || '';
        document.getElementById('rua').value = data.logradouro || '';

        hideFeedback();
        document.getElementById('numero').focus();
    } catch (err) {
        console.error('Erro ao buscar CEP:', err);
        showFeedback('error', 'Erro ao buscar CEP. Preencha manualmente.');
    }
}

/* ============================================
   FEEDBACK VISUAL
   ============================================ */
function showFeedback(type, message) {
    feedback.className = 'feedback ' + type;
    feedback.textContent = message;
    feedback.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function hideFeedback() {
    feedback.className = 'feedback';
    feedback.textContent = '';
}

/* ============================================
   VALIDAÇÃO GERAL DO FORMULÁRIO
   ============================================ */
function validarFormulario(dados) {
    const erros = [];

    if (!dados.nome || dados.nome.trim().length < 3) {
        erros.push({ campo: 'nome', msg: 'Nome inválido' });
    }
    if (!dados.dataNascimento) {
        erros.push({ campo: 'dataNascimento', msg: 'Data inválida' });
    }
    if (!dados.estadoCivil) {
        erros.push({ campo: 'estadoCivil', msg: 'Selecione o estado civil' });
    }
    if (!validarCPF(dados.cpf)) {
        erros.push({ campo: 'cpf', msg: 'CPF inválido' });
    }
    if (!dados.genero) {
        erros.push({ campo: 'genero', msg: 'Selecione o gênero' });
    }
    if (!dados.etnia) {
        erros.push({ campo: 'etnia', msg: 'Selecione a etnia' });
    }
    if (!dados.nomeMae || dados.nomeMae.trim().length < 3) {
        erros.push({ campo: 'nomeMae', msg: 'Nome da mãe inválido' });
    }
    if (dados.cep.replace(/\D/g, '').length !== 8) {
        erros.push({ campo: 'cep', msg: 'CEP inválido' });
    }
    if (!dados.cidadeNascimento) {
        erros.push({ campo: 'cidadeNascimento', msg: 'Cidade obrigatória' });
    }
    if (!dados.bairro) erros.push({ campo: 'bairro', msg: 'Bairro obrigatório' });
    if (!dados.rua) erros.push({ campo: 'rua', msg: 'Rua obrigatória' });
    if (!dados.numero) erros.push({ campo: 'numero', msg: 'Número obrigatório' });
    if (!dados.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dados.email)) {
        erros.push({ campo: 'email', msg: 'E-mail inválido' });
    }
    if (dados.celular.replace(/\D/g, '').length < 10) {
        erros.push({ campo: 'celular', msg: 'Celular inválido' });
    }

    return erros;
}

function limparErros() {
    document.querySelectorAll('.form-field input, .form-field select').forEach(el => {
        el.classList.remove('error');
    });
}

function marcarErros(erros) {
    erros.forEach(({ campo }) => {
        const el = document.getElementById(campo);
        if (el) el.classList.add('error');
    });
}

/* ============================================
   MONTAGEM DO PAYLOAD PARA A API SOLIDES
   ----------------------------------------------
   Estrutura conforme contrato do endpoint
   "Registra um novo colaborador" da Solides.
   Ajuste os nomes dos campos conforme a versão
   atual da documentação caso necessário.
   ============================================ */
function montarPayloadSolides(dados, documentos) {
    return {
        // Dados cadastrais
        nome: dados.nome.trim(),
        data_nascimento: dados.dataNascimento,
        estado_civil: dados.estadoCivil,
        cpf: dados.cpf.replace(/\D/g, ''),
        genero: dados.genero,
        etnia: dados.etnia,
        nome_pai: dados.nomePai?.trim() || null,
        nome_mae: dados.nomeMae.trim(),
        cnh: dados.cnh?.replace(/\D/g, '') || null,

        // Naturalidade
        cidade_nascimento: dados.cidadeNascimento.trim(),

        // Endereço
        endereco: {
            cep: dados.cep.replace(/\D/g, ''),
            logradouro: dados.rua.trim(),
            numero: dados.numero.trim(),
            complemento: dados.complemento?.trim() || null,
            bairro: dados.bairro.trim(),
            cidade: dados.cidade.trim(),
            estado: dados.estado.trim()
        },

        // Contatos
        email: dados.email.trim().toLowerCase(),
        telefone_celular: dados.celular.replace(/\D/g, ''),

        // Documentos (em base64)
        documentos: documentos,

        // Vínculo com a empresa (se aplicável)
        empresa_id: SOLIDES_CONFIG.empresaId
    };
}

/* ============================================
   ENVIO PARA A API SOLIDES
   ============================================ */
async function enviarParaSolides(payload) {
    const response = await fetch(SOLIDES_CONFIG.endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Authorization': `Bearer ${SOLIDES_CONFIG.token}`
        },
        body: JSON.stringify(payload)
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
        const msg = data.message || data.error || `Erro HTTP ${response.status}`;
        throw new Error(msg);
    }

    return data;
}

/* ============================================
   SUBMIT DO FORMULÁRIO
   ============================================ */
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    limparErros();
    hideFeedback();

    // Coleta dos dados
    const dados = {
        nome: document.getElementById('nome').value,
        dataNascimento: document.getElementById('dataNascimento').value,
        estadoCivil: document.getElementById('estadoCivil').value,
        cpf: document.getElementById('cpf').value,
        genero: document.getElementById('genero').value,
        etnia: document.getElementById('etnia').value,
        nomePai: document.getElementById('nomePai').value,
        nomeMae: document.getElementById('nomeMae').value,
        cnh: document.getElementById('cnh').value,
        cep: document.getElementById('cep').value,
        cidadeNascimento: document.getElementById('cidadeNascimento').value,
        cidade: document.getElementById('cidade').value,
        estado: document.getElementById('estado').value,
        bairro: document.getElementById('bairro').value,
        rua: document.getElementById('rua').value,
        numero: document.getElementById('numero').value,
        complemento: document.getElementById('complemento').value,
        email: document.getElementById('email').value,
        celular: document.getElementById('celular').value
    };

    // Validação
    const erros = validarFormulario(dados);
    if (erros.length > 0) {
        marcarErros(erros);
        showFeedback('error', `Por favor, corrija os campos destacados (${erros.length} erro${erros.length > 1 ? 's' : ''}).`);
        return;
    }

    // Envio
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    submitBtn.querySelector('.btn-text').textContent = 'ENVIANDO';

    try {
        // Converte documentos para base64
        showFeedback('info', 'Processando documentos...');
        const documentos = await montarDocumentosBase64();

        const payload = montarPayloadSolides(dados, documentos);
        console.log('Enviando para Solides:', { ...payload, documentos: `[${Object.keys(documentos).length} arquivos]` });

        const resultado = await enviarParaSolides(payload);
        console.log('Resposta da Solides:', resultado);

        showFeedback('success',
            'Admissão enviada com sucesso! Em breve entraremos em contato.');
        form.reset();

        // Limpar previews dos documentos
        document.querySelectorAll('.doc-upload.has-file').forEach(el => removerDocumento(el));

    } catch (err) {
        console.error('Falha no envio:', err);
        showFeedback('error',
            `Não foi possível enviar a admissão: ${err.message}. Tente novamente em instantes.`);
    } finally {
        submitBtn.classList.remove('loading');
        submitBtn.disabled = false;
        submitBtn.querySelector('.btn-text').textContent = 'ENVIAR ADMISSÃO';
    }
});

/* ============================================
   LIMPAR ERRO AO DIGITAR NOVAMENTE
   ============================================ */
document.querySelectorAll('.form-field input, .form-field select').forEach(el => {
    el.addEventListener('input', () => {
        el.classList.remove('error');
    });
});
