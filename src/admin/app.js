import {
  login,
  completeNewPassword,
  forgotPassword,
  confirmForgotPassword,
  logout,
  isAuthenticated,
  currentEmail,
  messageFor,
} from './cognito.js';
import { getMoto, createBlob, saveMoto, deleteMoto, getDeployStatus, ApiError } from './api.js';
import { processImageFile, blobToBase64, slugForMoto, nextPhotoName } from './imageUtils.js';
import { rawPhotoUrl } from './config.js';

const root = document.getElementById('admin-root');

const state = {
  view: isAuthenticated() ? 'list' : 'login',
  moto: [],
  headSha: null,
  loading: false,
  loadError: '',
  editingSlug: null, // slug della moto in modifica, null = nuova
  draft: null, // bozza del form in corso (per non perderla su 409)
  search: '',
};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function render() {
  root.replaceChildren();
  if (state.view === 'login') root.appendChild(renderLogin());
  else if (state.view === 'list') root.appendChild(renderList());
  else if (state.view === 'form') root.appendChild(renderForm());
}

// ---------------- LOGIN ----------------

function renderLogin() {
  const wrap = el('div', { class: 'admin-shell' },
    el('div', { class: 'admin-wrap', style: 'max-width:380px;padding-top:4rem' },
      el('h1', { class: 'display', style: 'font-size:2rem;margin-bottom:0.2rem' }, 'MotoBroker'),
      el('p', { class: 'admin-muted', style: 'margin-bottom:1.5rem' }, 'Pannello di gestione annunci'),
      loginBody()
    )
  );
  return wrap;

  function loginBody() {
    const mode = state.loginMode || 'login';
    const msg = state.loginMsg;
    const info = state.loginInfo;
    const parts = [];
    if (info) parts.push(el('div', { class: 'admin-notice admin-notice--ok' }, info));
    if (msg) parts.push(el('div', { class: 'admin-notice' }, msg));

    if (mode === 'login') {
      const emailInput = el('input', { class: 'admin-input', type: 'email', id: 'f-email', required: true, autocomplete: 'username', value: state.loginEmail || '' });
      const pwInput = el('input', { class: 'admin-input', type: 'password', id: 'f-pw', required: true, autocomplete: 'current-password' });
      const btn = el('button', { class: 'admin-btn', type: 'submit' }, state.busy ? 'Accesso in corso…' : 'Accedi');
      if (state.busy) btn.disabled = true;
      const form = el('form', { class: 'admin-card', onsubmit: async (e) => {
        e.preventDefault();
        state.loginMsg = '';
        state.busy = true;
        state.loginEmail = emailInput.value.trim();
        render();
        try {
          await login(state.loginEmail, pwInput.value);
          await enterApp();
        } catch (err) {
          state.busy = false;
          if (err.code === 'NEW_PASSWORD_REQUIRED') {
            state.pendingUser = err.cognitoUser;
            state.loginMode = 'new_password';
          } else {
            state.loginMsg = messageFor(err);
          }
          render();
        }
      } },
        el('div', { class: 'admin-field' }, el('label', { class: 'admin-label', for: 'f-email' }, 'Email'), emailInput),
        el('div', { class: 'admin-field' }, el('label', { class: 'admin-label', for: 'f-pw' }, 'Password'), pwInput),
        btn,
        el('button', { type: 'button', class: 'admin-link', style: 'margin-top:0.8rem;background:none;border:none;', onclick: () => { state.loginMode = 'forgot'; state.loginMsg = ''; render(); } }, 'Password dimenticata?')
      );
      return el('div', {}, ...parts, form);
    }

    if (mode === 'new_password') {
      const npw = el('input', { class: 'admin-input', type: 'password', id: 'f-npw', required: true, minlength: 10, autocomplete: 'new-password' });
      const btn = el('button', { class: 'admin-btn', type: 'submit' }, state.busy ? 'Salvataggio…' : 'Imposta password e accedi');
      if (state.busy) btn.disabled = true;
      const form = el('form', { class: 'admin-card', onsubmit: async (e) => {
        e.preventDefault();
        state.busy = true;
        render();
        try {
          await completeNewPassword(state.pendingUser, state.loginEmail, npw.value);
          await enterApp();
        } catch (err) {
          state.busy = false;
          state.loginMsg = messageFor(err);
          render();
        }
      } },
        el('p', { class: 'admin-muted', style: 'margin-bottom:0.8rem' }, 'Primo accesso: scegli una nuova password (almeno 10 caratteri, maiuscole, minuscole e numeri).'),
        el('div', { class: 'admin-field' }, el('label', { class: 'admin-label', for: 'f-npw' }, 'Nuova password'), npw),
        btn
      );
      return el('div', {}, ...parts, form);
    }

    if (mode === 'forgot') {
      const emailInput = el('input', { class: 'admin-input', type: 'email', required: true, value: state.loginEmail || '' });
      const btn = el('button', { class: 'admin-btn', type: 'submit' }, state.busy ? 'Invio…' : 'Invia codice');
      if (state.busy) btn.disabled = true;
      const form = el('form', { class: 'admin-card', onsubmit: async (e) => {
        e.preventDefault();
        state.busy = true;
        state.loginEmail = emailInput.value.trim();
        render();
        try {
          await forgotPassword(state.loginEmail);
          state.busy = false;
          state.loginInfo = 'Codice inviato per email.';
          state.loginMode = 'forgot_confirm';
        } catch (err) {
          state.busy = false;
          state.loginMsg = messageFor(err);
        }
        render();
      } },
        el('p', { class: 'admin-muted', style: 'margin-bottom:0.8rem' }, 'Ricevi un codice via email per reimpostare la password.'),
        el('div', { class: 'admin-field' }, el('label', { class: 'admin-label' }, 'Email'), emailInput),
        btn,
        el('button', { type: 'button', class: 'admin-link', style: 'margin-top:0.8rem;background:none;border:none;', onclick: () => { state.loginMode = 'login'; render(); } }, 'Torna al login')
      );
      return el('div', {}, ...parts, form);
    }

    // forgot_confirm
    const codeInput = el('input', { class: 'admin-input', required: true });
    const npw2 = el('input', { class: 'admin-input', type: 'password', required: true, minlength: 10, autocomplete: 'new-password' });
    const btn = el('button', { class: 'admin-btn', type: 'submit' }, state.busy ? 'Salvataggio…' : 'Reimposta password');
    if (state.busy) btn.disabled = true;
    const form = el('form', { class: 'admin-card', onsubmit: async (e) => {
      e.preventDefault();
      state.busy = true;
      render();
      try {
        await confirmForgotPassword(state.loginEmail, codeInput.value.trim(), npw2.value);
        state.busy = false;
        state.loginMode = 'login';
        state.loginInfo = 'Password aggiornata. Accedi con la nuova password.';
      } catch (err) {
        state.busy = false;
        state.loginMsg = messageFor(err);
      }
      render();
    } },
      el('div', { class: 'admin-field' }, el('label', { class: 'admin-label' }, 'Codice ricevuto per email'), codeInput),
      el('div', { class: 'admin-field' }, el('label', { class: 'admin-label' }, 'Nuova password'), npw2),
      btn
    );
    return el('div', {}, ...parts, form);
  }
}

async function enterApp() {
  state.busy = false;
  state.loginMsg = '';
  state.view = 'list';
  render();
  await loadMoto();
}

// ---------------- CARICAMENTO ----------------

async function loadMoto() {
  state.loading = true;
  state.loadError = '';
  render();
  try {
    const data = await getMoto();
    state.moto = data.moto || [];
    state.headSha = data.headSha;
  } catch (err) {
    state.loadError = err.message || 'Errore nel caricamento.';
  } finally {
    state.loading = false;
    render();
  }
}

// Stesso ordine di src/lib/moto.ts ordinaMoto: non vendute prima, poi alfabetico marca+modello.
function ordinaMoto(list) {
  return [...list].sort((a, b) => {
    if (a.venduta !== b.venduta) return a.venduta ? 1 : -1;
    const na = `${a.marca} ${a.modello}`;
    const nb = `${b.marca} ${b.modello}`;
    return na.localeCompare(nb, 'it');
  });
}

function formattaPrezzo(p) {
  if (p === undefined || p === null) return 'Prezzo su richiesta';
  return new Intl.NumberFormat('it-IT').format(p) + ' €';
}

// ---------------- ELENCO ----------------

function renderList() {
  const topbar = el('div', { class: 'admin-topbar' },
    el('h1', {}, 'Moto'),
    el('div', { style: 'display:flex;align-items:center;gap:0.7rem' },
      el('span', { class: 'admin-muted', style: 'display:none' }, currentEmail() || ''),
      el('button', { class: 'admin-btn admin-btn--ghost admin-btn--small', onclick: () => { logout(); state.view = 'login'; state.moto = []; render(); } }, 'Esci')
    )
  );

  const wrap = el('div', { class: 'admin-wrap' });

  if (state.loadError) {
    wrap.appendChild(el('div', { class: 'admin-notice' }, state.loadError));
    wrap.appendChild(el('button', { class: 'admin-btn', onclick: loadMoto }, 'Riprova'));
    return el('div', { class: 'admin-shell' }, topbar, wrap);
  }

  if (state.notice) wrap.appendChild(el('div', { class: 'admin-notice admin-notice--ok' }, state.notice));

  const searchInput = el('input', {
    class: 'admin-input admin-search',
    placeholder: 'Cerca per marca o modello…',
    value: state.search,
    oninput: (e) => { state.search = e.target.value; renderListBody(); },
  });
  wrap.appendChild(searchInput);
  const newBtn = el('button', { class: 'admin-btn', style: 'margin-bottom:1rem', onclick: () => openForm(null) }, '+ Nuova moto');
  // Senza headSha (caricamento /moto non ancora completato) il salvataggio verrebbe
  // rifiutato con 400 "headSha mancante": disabilitato finché l'elenco non è pronto.
  if (!state.headSha) newBtn.disabled = true;
  wrap.appendChild(newBtn);

  const bodyHolder = el('div', { id: 'admin-list-body' });
  wrap.appendChild(bodyHolder);

  function renderListBody() {
    bodyHolder.replaceChildren();
    if (state.loading) {
      bodyHolder.appendChild(el('p', { class: 'admin-muted' }, 'Caricamento…'));
      return;
    }
    const needle = state.search.trim().toLowerCase();
    let list = ordinaMoto(state.moto);
    if (needle) list = list.filter((m) => `${m.marca} ${m.modello}`.toLowerCase().includes(needle));
    bodyHolder.appendChild(el('p', { class: 'admin-muted', style: 'margin-bottom:0.6rem' }, `${list.length} moto`));
    if (list.length === 0) bodyHolder.appendChild(el('p', { class: 'admin-muted' }, 'Nessuna moto trovata.'));
    for (const m of list) {
      const cover = m.foto?.[0];
      const img = cover
        ? el('img', { class: 'admin-list-cover', src: rawPhotoUrl(m.slug, cover), alt: '' })
        : el('div', { class: 'admin-list-cover' });
      bodyHolder.appendChild(
        el('div', { class: 'admin-list-item' },
          img,
          el('div', { class: 'admin-list-main' },
            el('p', { class: 'admin-list-title' }, `${m.marca} ${m.modello}`, m.venduta ? el('span', { class: 'admin-badge' }, 'Venduta') : null),
            el('p', { class: 'admin-list-sub' }, `${m.anno} · ${formattaPrezzo(m.prezzo)}`)
          ),
          el('div', { class: 'admin-list-buttons' },
            el('button', { class: 'admin-btn admin-btn--ghost admin-btn--small', onclick: () => openForm(m) }, 'Modifica'),
            el('button', { class: 'admin-btn admin-btn--ghost admin-btn--small', onclick: () => toggleVenduta(m) }, m.venduta ? 'Segna disponibile' : 'Segna venduta')
          )
        )
      );
    }
  }
  renderListBody();

  return el('div', { class: 'admin-shell' }, topbar, wrap);
}

async function toggleVenduta(m) {
  state.loading = true;
  render();
  try {
    const res = await saveMoto({
      slug: m.slug,
      headSha: state.headSha,
      data: { marca: m.marca, modello: m.modello, anno: m.anno, km: m.km, cilindrata: m.cilindrata, prezzo: m.prezzo, descrizione: m.descrizione, venduta: !m.venduta },
      photos: (m.foto || []).map((name) => ({ name })),
    });
    state.headSha = res.headSha;
    m.venduta = !m.venduta;
    state.notice = `Salvato: ${m.marca} ${m.modello} segnata come ${m.venduta ? 'venduta' : 'disponibile'}. Online fra 1–2 minuti.`;
  } catch (err) {
    if (err instanceof ApiError && err.status === 409) {
      state.loadError = '';
      await loadMoto();
      state.notice = 'Qualcun altro ha salvato nel frattempo: elenco aggiornato, riprova.';
    } else {
      state.loadError = err.message || 'Errore nel salvataggio.';
    }
  } finally {
    state.loading = false;
    render();
  }
}

// ---------------- FORM ----------------

function openForm(moto) {
  state.editingSlug = moto ? moto.slug : null;
  state.draft = moto
    ? {
        marca: moto.marca, modello: moto.modello, anno: moto.anno, km: moto.km, cilindrata: moto.cilindrata,
        prezzo: moto.prezzo, descrizione: moto.descrizione || '', venduta: moto.venduta,
        photos: (moto.foto || []).map((name) => ({ uid: name, name, existing: true, previewUrl: rawPhotoUrl(moto.slug, name), uploading: false, progress: 100, error: null, sha: null })),
      }
    : { marca: '', modello: '', anno: new Date().getFullYear(), km: '', cilindrata: '', prezzo: '', descrizione: '', venduta: false, photos: [] };
  state.saveError = '';
  state.saveNotice = '';
  state.confirmDelete = false;
  state.view = 'form';
  render();
}

function renderForm() {
  const d = state.draft;
  const isNew = !state.editingSlug;

  const topbar = el('div', { class: 'admin-topbar' },
    el('h1', {}, isNew ? 'Nuova moto' : 'Modifica moto'),
    el('button', { class: 'admin-btn admin-btn--ghost admin-btn--small', onclick: () => { state.view = 'list'; render(); } }, "Torna all'elenco")
  );

  const marcaInput = el('input', { class: 'admin-input', required: true, value: d.marca, oninput: (e) => (d.marca = e.target.value) });
  const modelloInput = el('input', { class: 'admin-input', required: true, value: d.modello, oninput: (e) => (d.modello = e.target.value) });
  const annoInput = el('input', { class: 'admin-input', type: 'number', required: true, value: d.anno, oninput: (e) => (d.anno = e.target.value) });
  const kmInput = el('input', { class: 'admin-input', type: 'number', min: 0, value: d.km ?? '', oninput: (e) => (d.km = e.target.value) });
  const cilInput = el('input', { class: 'admin-input', type: 'number', min: 1, value: d.cilindrata ?? '', oninput: (e) => (d.cilindrata = e.target.value) });
  const prezzoInput = el('input', { class: 'admin-input', type: 'number', min: 0, step: '1', placeholder: 'Vuoto = «Prezzo su richiesta»', value: d.prezzo ?? '', oninput: (e) => (d.prezzo = e.target.value) });
  const descInput = el('textarea', { class: 'admin-textarea', oninput: (e) => (d.descrizione = e.target.value) }, d.descrizione || '');
  const vendutaInput = el('input', { type: 'checkbox', checked: d.venduta || undefined, onchange: (e) => (d.venduta = e.target.checked) });

  const uploader = renderUploader(d);

  const formError = el('div', {});
  if (state.formError) formError.appendChild(el('p', { class: 'admin-error' }, state.formError));

  const saveBtn = el('button', { class: 'admin-btn', type: 'submit' }, state.saving ? 'Salvataggio…' : (hasUploading(d) ? 'Caricamento foto…' : 'Salva'));
  if (state.saving || hasUploading(d)) saveBtn.disabled = true;

  const actions = el('div', { class: 'admin-actions' }, saveBtn);
  if (!isNew) {
    actions.appendChild(el('a', { class: 'admin-btn admin-btn--ghost', href: `/moto/${state.editingSlug}/`, target: '_blank', rel: 'noreferrer' }, 'Vedi sul sito'));
    actions.appendChild(el('button', { type: 'button', class: 'admin-btn admin-btn--danger', onclick: () => { state.confirmDelete = true; render(); } }, 'Elimina moto'));
  }

  const form = el('form', { class: 'admin-card', onsubmit: (e) => { e.preventDefault(); handleSubmit(d); } },
    el('div', { class: 'admin-row2' },
      el('div', { class: 'admin-field' }, el('label', { class: 'admin-label' }, 'Marca'), marcaInput),
      el('div', { class: 'admin-field' }, el('label', { class: 'admin-label' }, 'Modello'), modelloInput)
    ),
    el('div', { class: 'admin-row2' },
      el('div', { class: 'admin-field' }, el('label', { class: 'admin-label' }, 'Anno'), annoInput),
      el('div', { class: 'admin-field' }, el('label', { class: 'admin-label' }, 'Chilometri'), kmInput)
    ),
    el('div', { class: 'admin-row2' },
      el('div', { class: 'admin-field' }, el('label', { class: 'admin-label' }, 'Cilindrata (cc)'), cilInput),
      el('div', { class: 'admin-field' }, el('label', { class: 'admin-label' }, 'Prezzo (€)'), prezzoInput)
    ),
    el('div', { class: 'admin-field' }, el('label', { class: 'admin-label' }, 'Descrizione'), descInput),
    el('div', { class: 'admin-field admin-checkbox-row' }, vendutaInput, el('label', {}, 'Venduta')),
    el('div', { class: 'admin-field' }, el('label', { class: 'admin-label' }, 'Foto (la prima è la copertina)'), uploader),
    formError,
    actions
  );

  const wrap = el('div', { class: 'admin-wrap' });
  if (state.saveNotice) wrap.appendChild(el('div', { class: 'admin-notice admin-notice--ok' }, state.saveNotice));
  if (state.saveError) wrap.appendChild(el('div', { class: 'admin-notice' }, state.saveError));
  wrap.appendChild(form);

  if (state.confirmDelete) {
    wrap.appendChild(
      el('div', { class: 'admin-card', style: 'border-color:var(--rosso);margin-top:1rem' },
        el('p', { style: 'margin-bottom:0.8rem' }, `Eliminare definitivamente «${d.marca} ${d.modello}»? L'operazione non è reversibile dal pannello.`),
        el('div', { class: 'admin-actions' },
          el('button', { class: 'admin-btn admin-btn--danger', onclick: handleDelete }, 'Confermo, elimina'),
          el('button', { class: 'admin-btn admin-btn--ghost', onclick: () => { state.confirmDelete = false; render(); } }, 'Annulla')
        )
      )
    );
  }

  return el('div', { class: 'admin-shell' }, topbar, wrap);
}

function hasUploading(d) {
  return d.photos.some((p) => p.uploading);
}

function renderUploader(d) {
  const container = el('div', {});
  let dragIndex = null;

  const fileInput = el('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, onchange: (e) => { addFiles(e.target.files); e.target.value = ''; } });
  const dropzone = el('div', {
    class: 'admin-dropzone',
    onclick: () => fileInput.click(),
    ondragover: (e) => { e.preventDefault(); dropzone.classList.add('is-over'); },
    ondragleave: () => dropzone.classList.remove('is-over'),
    ondrop: (e) => { e.preventDefault(); dropzone.classList.remove('is-over'); addFiles(e.dataTransfer.files); },
  }, 'Scatta o seleziona le foto, oppure trascinale qui', fileInput);

  const grid = el('div', { class: 'admin-thumb-grid' });

  container.appendChild(dropzone);
  container.appendChild(grid);
  renderGrid();
  return container;

  function renderGrid() {
    grid.replaceChildren();
    d.photos.forEach((p, i) => {
      const thumb = el('div', {
        class: 'admin-thumb' + (i === 0 ? ' is-cover' : ''),
        draggable: !p.uploading,
        ondragstart: () => { dragIndex = i; },
        ondragover: (e) => e.preventDefault(),
        ondrop: () => { reorder(dragIndex, i); dragIndex = null; },
      });
      if (p.previewUrl) thumb.appendChild(el('img', { src: p.previewUrl, alt: '' }));
      else thumb.appendChild(el('div', { style: 'aspect-ratio:4/3;background:var(--panel2)' }));
      if (i === 0) thumb.appendChild(el('span', { class: 'admin-thumb-badge' }, 'Copertina'));
      if (p.uploading) {
        const bar = el('div', { class: 'admin-progress', style: 'position:absolute;left:4px;right:4px;bottom:26px' });
        bar.appendChild(el('div', { style: `width:${p.progress}%` }));
        thumb.appendChild(bar);
      }
      if (p.error) thumb.appendChild(el('p', { class: 'admin-error', style: 'position:absolute;top:2px;left:2px;right:2px;font-size:0.65rem' }, p.error));
      thumb.appendChild(
        el('div', { class: 'admin-thumb-bar' },
          el('button', { type: 'button', onclick: () => { removeImage(p.uid); } }, 'Rimuovi')
        )
      );
      grid.appendChild(thumb);
    });
  }

  function reorder(from, to) {
    if (from === null || from === to) return;
    const next = [...d.photos];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    d.photos = next;
    renderGrid();
  }

  function removeImage(uid) {
    d.photos = d.photos.filter((p) => p.uid !== uid);
    renderGrid();
  }

  async function addFiles(fileList) {
    const files = Array.from(fileList).filter((f) => f.type.startsWith('image/'));
    if (files.length === 0) return;
    const placeholders = files.map((f) => ({ uid: `${Date.now()}-${Math.random().toString(36).slice(2)}`, file: f, name: null, existing: false, previewUrl: null, uploading: true, progress: 0, error: null, sha: null, receipt: null }));
    d.photos = [...d.photos, ...placeholders];
    renderGrid();

    for (const ph of placeholders) {
      try {
        const { blob, w, h } = await processImageFile(ph.file);
        const base64 = await blobToBase64(blob);
        const res = await createBlob(base64);
        ph.sha = res.sha;
        ph.receipt = res.receipt;
        ph.name = nextPhotoName();
        ph.previewUrl = URL.createObjectURL(blob);
        ph.uploading = false;
        ph.progress = 100;
        ph.w = w;
        ph.h = h;
      } catch (err) {
        ph.uploading = false;
        ph.error = err.message || 'errore upload';
      }
      renderGrid();
    }
  }
}

function buildPayload(d) {
  if (!d.marca.trim()) return { error: 'La marca è obbligatoria.' };
  if (!d.modello.trim()) return { error: 'Il modello è obbligatorio.' };
  const anno = parseInt(d.anno, 10);
  if (!Number.isInteger(anno)) return { error: "L'anno deve essere un numero intero." };
  const ready = d.photos.filter((p) => p.name && !p.uploading && !p.error);
  if (ready.length === 0) return { error: 'Serve almeno una foto caricata correttamente.' };

  const data = {
    marca: d.marca.trim(),
    modello: d.modello.trim(),
    anno,
    venduta: !!d.venduta,
  };
  if (d.km !== '' && d.km !== null && d.km !== undefined) data.km = parseInt(d.km, 10);
  if (d.cilindrata !== '' && d.cilindrata !== null && d.cilindrata !== undefined) data.cilindrata = parseInt(d.cilindrata, 10);
  if (d.prezzo !== '' && d.prezzo !== null && d.prezzo !== undefined) data.prezzo = Number(d.prezzo);
  if (d.descrizione && d.descrizione.trim()) data.descrizione = d.descrizione.trim();

  const photos = ready.map((p) => (p.existing ? { name: p.name } : { name: p.name, sha: p.sha, receipt: p.receipt }));
  return { data, photos };
}

async function handleSubmit(d) {
  state.formError = '';
  const { error, data, photos } = buildPayload(d);
  if (error) {
    state.formError = error;
    render();
    return;
  }

  const newSlug = slugForMoto(data.marca, data.modello);
  const isNew = !state.editingSlug;
  const isRename = !isNew && newSlug !== state.editingSlug;

  if (isRename && !state.renameConfirmed) {
    const ok = window.confirm(
      `Cambiando marca/modello cambia anche il link pubblico:\nda /moto/${state.editingSlug}/\na /moto/${newSlug}/\n\nI link già condivisi smetteranno di funzionare. Continuare?`
    );
    if (!ok) return;
    state.renameConfirmed = true;
  }

  state.saving = true;
  state.saveError = '';
  render();
  try {
    const res = await saveMoto({
      slug: newSlug,
      headSha: state.headSha,
      data,
      photos,
      create: isNew || undefined,
      previousSlug: isRename ? state.editingSlug : undefined,
    });
    state.headSha = res.headSha;
    state.renameConfirmed = false;
    await afterSave(newSlug);
  } catch (err) {
    state.saving = false;
    if (err instanceof ApiError && err.status === 409 && err.body?.code === 'SLUG_EXISTS') {
      state.saveError = 'Esiste già una moto con questa marca e modello: scegline un\'altra combinazione, oppure modifica quella esistente.';
      render();
    } else if (err instanceof ApiError && err.status === 409) {
      state.saveError = 'Qualcun altro ha salvato nel frattempo. Ricarico i dati più recenti; la tua bozza resta qui, puoi salvare di nuovo.';
      try {
        const fresh = await getMoto();
        state.moto = fresh.moto || [];
        state.headSha = fresh.headSha;
      } catch {
        // se anche il reload fallisce, il prossimo salvataggio lo segnalerà di nuovo
      }
      render();
    } else {
      state.saveError = err.message || 'Errore nel salvataggio.';
      render();
    }
  }
}

async function afterSave(slug) {
  state.view = 'list';
  state.saving = false;
  state.notice = `Salvato. Online fra 1–2 minuti. Scheda: /moto/${slug}/`;
  await loadMoto();
  pollDeployStatus(slug);
}

async function pollDeployStatus(slug) {
  try {
    const status = await getDeployStatus();
    if (status.status) {
      state.notice = `Salvato. Pubblicazione: ${translateStatus(status)} — scheda: /moto/${slug}/`;
      render();
    }
  } catch {
    // non bloccante
  }
}

function translateStatus(s) {
  if (s.status === 'completed') return s.conclusion === 'success' ? 'online' : `terminata (${s.conclusion})`;
  if (s.status === 'in_progress' || s.status === 'queued') return 'in corso, online fra 1–2 minuti';
  if (s.status === 'unknown') return 'stato non disponibile';
  return s.status || 'sconosciuto';
}

async function handleDelete() {
  state.saving = true;
  render();
  try {
    const res = await deleteMoto(state.editingSlug, state.headSha);
    state.headSha = res.headSha;
    state.view = 'list';
    state.saving = false;
    state.confirmDelete = false;
    state.notice = `Moto eliminata. Online fra 1–2 minuti.`;
    await loadMoto();
  } catch (err) {
    state.saving = false;
    if (err instanceof ApiError && err.status === 409) {
      state.saveError = 'Qualcun altro ha salvato nel frattempo. Ricarico i dati più recenti.';
      try {
        const fresh = await getMoto();
        state.moto = fresh.moto || [];
        state.headSha = fresh.headSha;
      } catch {}
    } else {
      state.saveError = err.message || "Errore nell'eliminazione.";
    }
    render();
  }
}

render();
if (state.view === 'list') loadMoto();
