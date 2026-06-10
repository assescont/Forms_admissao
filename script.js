/* ============================================
   ASSESCONT — FORMULÁRIO DE ADMISSÃO
   Lógica do formulário + envio ao webhook n8n
   ============================================ */

/* ============================================
   CONFIGURAÇÃO DO ENVIO (webhook n8n direto)
   ----------------------------------------------
   O submit POSTa direto no webhook do n8n.

   Cadeia completa:
     [ Form ] → [ n8n ] → [ API Solides ]
                  │              │
                  │              └─ token no n8n
                  └─ mapeamento (body.formulario)

   ⚠️ Trade-offs deste caminho direto:
     - A URL do webhook fica visível no DevTools →
       Network. Qualquer um pode copiar e fazer POST
       direto. Para mitigar, o webhook do n8n deve
       restringir "Allowed Origins" ao domínio do
       formulário (assescontcontabil.com.br) — isso
       barra chamadas via navegador de outras origens
       (CORS), embora não impeça requisições
       server-to-server (que podem forjar o Origin).
     - Não há Header Auth no caminho do navegador.

   Existe um Cloudflare Worker em worker/ que esconde
   a URL do n8n (Form → Worker → n8n). Não está em uso
   neste caminho direto; manter como opção futura de
   hardening. Ver DOCUMENTACAO.md (§7.4).
   ============================================ */
const N8N_CONFIG = {
    // URL pública do webhook de produção do n8n.
    webhookUrl: 'https://n8n.srv934741.hstgr.cloud/webhook/e35762b6-ecc4-440f-91ba-4f4517880968'
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
   ----------------------------------------------
   Os arquivos enviados pelo candidato (RG, CPF,
   comprovantes, foto 3x4 etc.) são guardados em
   memória aqui e enviados ao n8n em base64 no
   submit. A API de criação de colaborador da
   Solides não aceita anexos — o que o n8n faz
   com esses arquivos depois (storage, e-mail
   pra RH, etc.) é responsabilidade do workflow.

   Ver "Documentos" em DOCUMENTACAO.md.
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
   ----------------------------------------------
   Utilitário usado para serializar cada arquivo
   antes de empacotar no payload do webhook n8n.
   Formato resultante (por arquivo):
     { nome_arquivo, tipo, tamanho, conteudo_base64 }
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
   DEPENDENTES (seção dinâmica)
   ----------------------------------------------
   Quando o candidato responde "Sim" em
   "Possui dependentes?", esta seção aparece e
   permite adicionar 1..N dependentes, cada um
   com: nome, data de nascimento, parentesco,
   CPF (opcional) e um documento anexo
   (opcional — certidão de nascimento, RG ou CPF).

   ⚠️ Assim como os documentos do candidato, os
   dependentes NÃO entram no POST de criação de
   colaborador da Solides — o body schema do
   endpoint não tem campo `dependents`. Os
   arquivos vão no payload do webhook n8n em
   base64; o destino final fica a cargo do
   workflow (ver DOCUMENTACAO.md, seção 6/7).

   O arquivo File de cada dependente fica no
   próprio nó DOM (`card._documento`) para evitar
   estado paralelo que precise sincronizar com
   adições/remoções.
   ============================================ */
const temDependentesSelect = document.getElementById('temDependentes');
const dependentesSection = document.getElementById('dependentesSection');
const dependentesList = document.getElementById('dependentesList');
const addDependenteBtn = document.getElementById('addDependenteBtn');
let nextDependenteId = 1;

// Mostra/oculta a seção e adiciona o primeiro card automaticamente
// quando o usuário responde "Sim" e ainda não há nenhum.
if (temDependentesSelect) {
    temDependentesSelect.addEventListener('change', e => {
        const mostrar = e.target.value === 'sim';
        dependentesSection.hidden = !mostrar;
        if (mostrar && dependentesList.children.length === 0) {
            adicionarDependente();
        }
    });
}

if (addDependenteBtn) {
    addDependenteBtn.addEventListener('click', () => adicionarDependente());
}

/**
 * Slots de documento por dependente. A ordem aqui define a ordem
 * em que aparecem no card.
 *
 * Slots condicionais (`condicional: '<valor de estadoCivil>'`) só
 * aparecem quando o candidato (titular) tem o estado civil indicado.
 * A visibilidade é gerenciada por sincronizarSlotsCondicionais() —
 * basta adicionar/remover slots aqui que a função se ajusta sozinha.
 */
const SLOTS_DEPENDENTE = [
    {
        chave: 'certidaoNasc',
        titulo: 'Certidão de Nascimento',
        hint: 'Imagem ou PDF da certidão',
        icone: `<rect x="3" y="5" width="18" height="14" rx="2"/><line x1="7" y1="10" x2="17" y2="10"/><line x1="7" y1="13" x2="17" y2="13"/>`
    },
    {
        chave: 'certidaoCasamento',
        titulo: 'Certidão de Casamento',
        hint: 'Anexe somente se o candidato for casado',
        icone: `<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"/>`,
        condicional: 'casado'
    },
    {
        chave: 'certidaoUniaoEstavel',
        titulo: 'Certidão de União Estável',
        hint: 'Anexe a escritura/declaração de união estável',
        // Dois círculos interligados — alusão a aliança/união.
        icone: `<circle cx="9" cy="12" r="5"/><circle cx="15" cy="12" r="5"/>`,
        condicional: 'uniao_estavel'
    },
    {
        chave: 'cpfDoc',
        titulo: 'CPF do Dependente',
        hint: 'Imagem ou PDF do CPF',
        icone: `<rect x="4" y="3" width="16" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/>`
    }
];

function adicionarDependente() {
    const id = nextDependenteId++;
    const card = document.createElement('div');
    card.className = 'dependente-card';
    card.dataset.depId = String(id);
    // Estado dos arquivos de cada slot deste card. Derivado do
    // SLOTS_DEPENDENTE para que novos slots entrem automaticamente.
    card._documentos = SLOTS_DEPENDENTE.reduce((acc, slot) => {
        acc[slot.chave] = null;
        return acc;
    }, {});

    const slotsHtml = SLOTS_DEPENDENTE.map(slot => `
        <div class="dep-slot ${slot.condicional ? 'dep-slot-condicional' : ''}" data-slot="${slot.chave}">
            <input type="file" id="depDoc-${id}-${slot.chave}" data-slot-input="${slot.chave}" accept="image/*,.pdf" hidden>
            <label for="depDoc-${id}-${slot.chave}" class="doc-dropzone dep-dropzone">
                <div class="doc-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="22" height="22">
                        ${slot.icone}
                    </svg>
                </div>
                <div class="doc-info">
                    <span class="doc-title">${slot.titulo}</span>
                    <span class="doc-hint">${slot.hint}</span>
                </div>
            </label>
            <div class="doc-preview" hidden></div>
        </div>
    `).join('');

    card.innerHTML = `
        <div class="dependente-card-header">
            <span class="dependente-numero"></span>
            <button type="button" class="dependente-remove" aria-label="Remover dependente" title="Remover dependente">✕</button>
        </div>
        <div class="dep-slots-grid">
            ${slotsHtml}
        </div>
    `;

    dependentesList.appendChild(card);

    // Botão remover.
    card.querySelector('.dependente-remove').addEventListener('click', () => removerDependente(card));

    // Bind de upload por slot (mesmas validações dos demais uploads).
    card.querySelectorAll('[data-slot-input]').forEach(input => {
        const slotKey = input.dataset.slotInput;
        input.addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.size > MAX_FILE_SIZE) {
                showFeedback('error', `O arquivo "${file.name}" excede o limite de 5MB.`);
                input.value = '';
                return;
            }
            const validTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp', 'application/pdf'];
            if (!validTypes.includes(file.type)) {
                showFeedback('error', 'Formato inválido. Use JPG, PNG ou PDF.');
                input.value = '';
                return;
            }
            card._documentos[slotKey] = file;
            renderPreviewSlot(card, slotKey, file);
            hideFeedback();
        });
    });

    sincronizarSlotsCondicionais(card);
    renumerarDependentes();
}

function removerDependente(card) {
    card.remove();
    renumerarDependentes();
    // Se removeram tudo enquanto a resposta for "Sim", oferecer
    // botão para adicionar de novo (já está visível na seção).
}

function renumerarDependentes() {
    const cards = dependentesList.querySelectorAll('.dependente-card');
    cards.forEach((card, idx) => {
        const numero = String(idx + 1).padStart(2, '0');
        card.querySelector('.dependente-numero').textContent = `DEPENDENTE ${numero}`;
    });
}

function renderPreviewSlot(card, slotKey, file) {
    const slotEl = card.querySelector(`.dep-slot[data-slot="${slotKey}"]`);
    const preview = slotEl.querySelector('.doc-preview');
    const hint = slotEl.querySelector('.doc-hint');
    const dropzone = slotEl.querySelector('.doc-dropzone');
    const slotMeta = SLOTS_DEPENDENTE.find(s => s.chave === slotKey);
    const isImage = file.type.startsWith('image/');

    preview.innerHTML = '';

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

    const info = document.createElement('div');
    info.className = 'file-info';
    info.innerHTML = `
        <span class="file-name">${file.name}</span>
        <span class="file-size">${formatFileSize(file.size)}</span>
    `;
    preview.appendChild(info);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'file-remove';
    removeBtn.innerHTML = '✕';
    removeBtn.title = 'Remover arquivo';
    removeBtn.addEventListener('click', () => {
        card._documentos[slotKey] = null;
        slotEl.querySelector('[data-slot-input]').value = '';
        preview.innerHTML = '';
        preview.hidden = true;
        dropzone.classList.remove('has-file');
        hint.textContent = slotMeta.hint;
    });
    preview.appendChild(removeBtn);

    preview.hidden = false;
    dropzone.classList.add('has-file');
    hint.textContent = 'Arquivo carregado';
}

/**
 * Mostra/oculta os slots condicionais (slots de SLOTS_DEPENDENTE com
 * a chave `condicional`) conforme o estado civil do candidato titular.
 * Se um slot for ocultado e tiver arquivo, a referência é descartada
 * para não vazar dado fora de contexto.
 *
 * Pode ser chamada para um card específico (ao adicionar) ou sem args
 * (atualiza todos — usado quando o candidato muda o estado civil).
 *
 * Como adicionar um novo slot condicional:
 *   1. Acrescentar entrada em SLOTS_DEPENDENTE com `condicional: '<valor>'`.
 *   2. Pronto — esta função pega a lista nova automaticamente.
 */
function sincronizarSlotsCondicionais(cardEspecifico) {
    const estadoCivil = document.getElementById('estadoCivil')?.value || '';
    const cards = cardEspecifico
        ? [cardEspecifico]
        : Array.from(dependentesList.querySelectorAll('.dependente-card'));

    const slotsCondicionais = SLOTS_DEPENDENTE.filter(s => s.condicional);

    cards.forEach(card => {
        slotsCondicionais.forEach(slotMeta => {
            const slot = card.querySelector(`.dep-slot[data-slot="${slotMeta.chave}"]`);
            if (!slot) return;
            const mostrar = slotMeta.condicional === estadoCivil;
            slot.hidden = !mostrar;
            if (!mostrar && card._documentos[slotMeta.chave]) {
                // Limpa estado e preview se o slot deixou de fazer sentido.
                card._documentos[slotMeta.chave] = null;
                const input = slot.querySelector('[data-slot-input]');
                if (input) input.value = '';
                const preview = slot.querySelector('.doc-preview');
                const hint = slot.querySelector('.doc-hint');
                const dropzone = slot.querySelector('.doc-dropzone');
                if (preview) { preview.innerHTML = ''; preview.hidden = true; }
                if (dropzone) dropzone.classList.remove('has-file');
                if (hint) hint.textContent = slotMeta.hint;
            }
        });
    });
}

// Reage à mudança de estado civil do candidato (titular).
const estadoCivilEl = document.getElementById('estadoCivil');
if (estadoCivilEl) {
    estadoCivilEl.addEventListener('change', () => sincronizarSlotsCondicionais());
}

/**
 * Lê os cards e devolve uma lista de dependentes com seus arquivos
 * prontos para persistência futura. Cada dependente precisa ter ao
 * menos UM dos slots aplicáveis preenchido (caso contrário não faz
 * sentido tê-lo na lista). Retorna `null` se algum card estiver vazio.
 */
function coletarEValidarDependentes() {
    const cards = Array.from(dependentesList.querySelectorAll('.dependente-card'));
    const estadoCivil = document.getElementById('estadoCivil')?.value || '';
    const dependentes = [];
    let temErro = false;

    cards.forEach(card => {
        // Slots aplicáveis = todos exceto os condicionais cujo gatilho não bate.
        const aplicaveis = SLOTS_DEPENDENTE.filter(slot =>
            !slot.condicional || slot.condicional === estadoCivil
        );
        const arquivos = {};
        let totalArquivos = 0;

        aplicaveis.forEach(slot => {
            const arq = card._documentos[slot.chave] || null;
            arquivos[slot.chave] = arq;
            if (arq) totalArquivos++;
        });

        // Marca o card como erro se nenhum slot foi preenchido.
        card.classList.remove('error');
        if (totalArquivos === 0) {
            card.classList.add('error');
            temErro = true;
        }

        dependentes.push({ arquivos });
    });

    return temErro ? null : dependentes;
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
    if (!dados.grauInstrucao) {
        erros.push({ campo: 'grauInstrucao', msg: 'Selecione o grau de instrução' });
    }
    // `formacao` é opcional — não validamos.
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
    if (!dados.temDependentes) {
        erros.push({ campo: 'temDependentes', msg: 'Informe se possui dependentes' });
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
   MONTAGEM E ENVIO PARA O WEBHOOK N8N
   ----------------------------------------------
   O payload leva os dados crus do formulário
   (úteis para exibição na aprovação de RH/gestores
   e para o n8n mapear para a Solides) + os
   arquivos em base64 (candidato + dependentes).

   O mapeamento para o contrato da API Solides
   (enums por extenso, formato de data dd/mm/aaaa,
   campos achatados de endereço, etc.) acontece
   100% dentro do n8n — não duplicamos isso aqui.

   Estrutura:
   {
     metadata: { ... },
     formulario: { ... dados crus do form ... },
     documentos: {
       rgFrente: { nome_arquivo, tipo, tamanho, conteudo_base64 },
       ...
     },
     dependentes: [
       { numero, arquivos: { certidaoNasc: {...}, ... } },
       ...
     ]
   }

   ⚠️ Imagens/PDFs em base64 inflam o payload em
   ~33%. Com o limite de 5MB por arquivo, um
   colaborador com vários anexos pode chegar a
   dezenas de MB no body. Se o n8n responder 413
   (Payload Too Large), aumentar o limite no
   reverse proxy do n8n ou trocar a estratégia
   para upload separado (multipart/pré-assinado).
   ============================================ */
async function montarPayloadN8N(dados, dependentes) {
    // Documentos do candidato em base64 (RG, CPF, comprovantes, foto, etc.).
    const documentos = Object.keys(documentosArquivos).length > 0
        ? await montarDocumentosBase64()
        : {};

    // Dependentes em base64 — replica o formato do bloco "futuro" do submit
    // para manter um único formato consumido pelo n8n.
    const dependentesBase64 = await Promise.all(dependentes.map(async (dep, idx) => {
        const arquivos = {};
        for (const [slot, file] of Object.entries(dep.arquivos)) {
            if (!file) continue;
            arquivos[slot] = {
                nome_arquivo: file.name,
                tipo: file.type,
                tamanho: file.size,
                conteudo_base64: await fileToBase64(file)
            };
        }
        return { numero: idx + 1, arquivos };
    }));

    return {
        metadata: {
            origem: 'forms-admissao-assescont',
            versao: '1.0',
            enviado_em: new Date().toISOString(),
            // Útil para o n8n marcar logs/aprovações por candidato sem
            // depender ainda do id da Solides (que só nasce depois).
            candidato_cpf: dados.cpf.replace(/\D/g, ''),
            candidato_email: dados.email.trim().toLowerCase()
        },
        formulario: dados,
        documentos,
        dependentes: dependentesBase64
    };
}

/**
 * POST do payload completo direto no webhook do n8n.
 * Não envia header de auth do lado do navegador — a proteção é o
 * "Allowed Origins" configurado no nó Webhook do n8n, que deve
 * conter o domínio do formulário (assescontcontabil.com.br) para
 * barrar chamadas via navegador de outras origens (CORS).
 */
async function enviarParaN8N(payload) {
    const response = await fetch(N8N_CONFIG.webhookUrl, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    // O n8n pode responder com JSON, texto puro ou body vazio dependendo
    // do nó "Respond to Webhook". Tentamos JSON primeiro e caímos em texto.
    let data = null;
    const ct = response.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
        data = await response.json().catch(() => null);
    } else {
        data = await response.text().catch(() => null);
    }

    if (!response.ok) {
        const msg = (data && data.message)
            || (typeof data === 'string' && data)
            || `Erro HTTP ${response.status} no webhook n8n`;
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
        grauInstrucao: document.getElementById('grauInstrucao').value,
        formacao: document.getElementById('formacao').value,
        genero: document.getElementById('genero').value,
        etnia: document.getElementById('etnia').value,
        nomePai: document.getElementById('nomePai').value,
        nomeMae: document.getElementById('nomeMae').value,
        temDependentes: document.getElementById('temDependentes').value,
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

    // Consentimento LGPD — obrigatório.
    // Bloqueia o envio se o usuário não marcou o checkbox; o campo
    // recebe a classe .error para destacar visualmente.
    const consentEl = document.getElementById('consentLgpd');
    const consentField = document.getElementById('consentField');
    if (!consentEl?.checked) {
        consentField?.classList.add('error');
        showFeedback('error', 'É necessário concordar com o tratamento dos dados (LGPD) para enviar a admissão.');
        consentField?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }
    consentField?.classList.remove('error');

    // Dependentes — só valida/coleta se o usuário disse "Sim".
    // Se "Não", o array fica vazio e a seção é ignorada.
    let dependentes = [];
    if (dados.temDependentes === 'sim') {
        const cards = dependentesList.querySelectorAll('.dependente-card');
        if (cards.length === 0) {
            showFeedback('error', 'Adicione pelo menos um dependente ou altere a resposta para "Não".');
            return;
        }
        const resultado = coletarEValidarDependentes();
        if (resultado === null) {
            showFeedback('error', 'Anexe ao menos um documento por dependente (cards em vermelho).');
            return;
        }
        dependentes = resultado;
    }

    // Envio
    submitBtn.classList.add('loading');
    submitBtn.disabled = true;
    submitBtn.querySelector('.btn-text').textContent = 'ENVIANDO';

    try {
        // Webhook n8n — único destino. Carrega tudo: dados crus
        // do formulário + documentos do candidato e dos dependentes
        // (em base64). O n8n cuida do mapeamento para a Solides e
        // do POST /colaboradores — o front não fala com a Solides.
        showFeedback('info', 'Registrando admissão...');
        const payloadN8N = await montarPayloadN8N(dados, dependentes);
        console.log('[n8n] enviando payload (resumo):', {
            metadata: payloadN8N.metadata,
            docs: Object.keys(payloadN8N.documentos),
            dependentes: payloadN8N.dependentes.length
        });

        const respostaN8N = await enviarParaN8N(payloadN8N);
        console.log('[n8n] resposta:', respostaN8N);

        showFeedback('success',
            'Admissão enviada com sucesso! Em breve entraremos em contato.');
        form.reset();

        // Limpar previews dos documentos
        document.querySelectorAll('.doc-upload.has-file').forEach(el => removerDocumento(el));

        // Limpar seção de dependentes
        dependentesList.innerHTML = '';
        dependentesSection.hidden = true;
        nextDependenteId = 1;

        // form.reset() já desmarca o checkbox; só limpamos o destaque de erro.
        document.getElementById('consentField')?.classList.remove('error');

    } catch (err) {
        console.error('Falha no envio:', err);
        showFeedback('error',
            `Não foi possível registrar a admissão: ${err.message}. Tente novamente em instantes.`);
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

// Mesma lógica para o checkbox de consentimento LGPD.
document.getElementById('consentLgpd')?.addEventListener('change', () => {
    document.getElementById('consentField')?.classList.remove('error');
});
