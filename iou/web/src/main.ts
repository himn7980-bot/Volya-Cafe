// The public confirmation page. The person a record is about opens
// https://<site>/c/#<token>, sees the record in their language, and confirms
// or disputes it without an account. Then they are invited to install the app.
//
// Data is only ever inserted with textContent (never innerHTML).

import { describeRecord, formatContextFor, makeT, pickLanguage, type Dict, type LangMeta, type SharedLoan, type T } from './view';

declare const __CONFIG__: {
  supabaseUrl: string;
  anonKey: string;
  brand: { name: string; scheme: string; appStoreUrl: string; playStoreUrl: string };
  languages: LangMeta[];
};
const config = __CONFIG__;

// ---------- Server ----------

async function rpc<R>(fn: string, body: Record<string, unknown>): Promise<R> {
  const res = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: config.anonKey, authorization: `Bearer ${config.anonKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as R;
}

type Answer = { status?: string; error?: 'not_found' | 'rate_limited' | 'closed' | 'changed' | 'invalid' };

// ---------- Language ----------

const localeCache = new Map<string, Dict>();
async function loadLocale(code: string): Promise<Dict> {
  const cached = localeCache.get(code);
  if (cached) return cached;
  const res = await fetch(`../locales/${code}.json`);
  const dict = (await res.json()) as Dict;
  localeCache.set(code, dict);
  return dict;
}

function savedLanguage(): string | null {
  try {
    return localStorage.getItem('iou.lang');
  } catch {
    return null;
  }
}

// ---------- DOM helpers ----------

type Child = Node | string | null | false | undefined;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...children: Child[]) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  for (const c of children) if (c) node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  return node;
}

// ---------- State ----------

const token = decodeURIComponent(location.hash.slice(1)).trim();
let data: SharedLoan | null = null;
let lang: LangMeta = config.languages.find((l) => l.code === 'en')!;
let t: T = (k) => k;
let mode: 'view' | 'dispute' | 'done' | 'repaymentDone' = 'view';
let doneStatus: 'confirmed' | 'disputed' = 'confirmed';
/** Repayment the visitor is explaining a "no" for. */
let disputingRepayment: string | null = null;
let notice: string | null = null;
let busy = false;

async function setLanguage(code: string) {
  lang = config.languages.find((l) => l.code === code) ?? lang;
  const [primary, english] = await Promise.all([loadLocale(lang.code), loadLocale('en')]);
  t = makeT(primary, english, { appName: config.brand.name });
  document.documentElement.lang = lang.code;
  document.documentElement.dir = lang.dir;
  document.body.dataset.script = lang.script;
  document.title = `${config.brand.name} · ${t('web.title')}`;
}

// ---------- Rendering ----------

const root = document.getElementById('app')!;

function languagePicker() {
  const select = el('select', { 'aria-label': t('settings.language'), class: 'lang' });
  for (const l of config.languages) {
    const option = el('option', { value: l.code }, l.nativeName);
    if (l.code === lang.code) option.selected = true;
    select.append(option);
  }
  select.addEventListener('change', async () => {
    try {
      localStorage.setItem('iou.lang', select.value);
    } catch {
      // private mode: just don't remember
    }
    await setLanguage(select.value);
    render();
  });
  return select;
}

function installCard() {
  const claim = `${config.brand.scheme}://claim?token=${encodeURIComponent(token)}`;
  return el(
    'section',
    { class: 'card install' },
    el('h2', {}, t('web.installTitle')),
    el('p', {}, t('web.installBody')),
    el(
      'div',
      { class: 'stores' },
      el('a', { class: 'button secondary', href: config.brand.playStoreUrl, rel: 'noopener' }, t('web.getAndroid')),
      el('a', { class: 'button secondary', href: config.brand.appStoreUrl, rel: 'noopener' }, t('web.getIos')),
    ),
    el('a', { class: 'link', href: claim }, t('web.openInApp')),
  );
}

function message(title: string, body?: string) {
  return el('section', { class: 'card center' }, el('h1', {}, title), body ? el('p', {}, body) : null);
}

async function answer(action: 'confirm' | 'dispute', comment: string | null) {
  if (!data || data.error || !data.open || busy) return;
  busy = true;
  notice = null;
  render();
  try {
    const r = await rpc<Answer>('respond_shared_loan', { p_token: token, p_action: action, p_comment: comment, p_version: data.version });
    if (r.status === 'confirmed' || r.status === 'disputed') {
      doneStatus = r.status;
      mode = 'done';
    } else if (r.error === 'changed') {
      data = await rpc<SharedLoan>('get_shared_loan', { p_token: token });
      mode = 'view';
      notice = t('web.changed', { name: data.error ? '' : data.creator_name });
    } else if (r.error === 'rate_limited') {
      notice = t('web.rateLimited');
    } else if (r.error === 'closed') {
      data = await rpc<SharedLoan>('get_shared_loan', { p_token: token });
    } else {
      notice = t('common.somethingWrong');
    }
  } catch {
    notice = t('common.somethingWrong');
  } finally {
    busy = false;
    render();
  }
}

async function answerRepayment(id: string, action: 'confirm' | 'dispute', comment: string | null) {
  if (busy) return;
  busy = true;
  notice = null;
  render();
  try {
    const r = await rpc<Answer>('respond_shared_repayment', { p_token: token, p_repayment_id: id, p_action: action, p_comment: comment });
    if (r.status) {
      disputingRepayment = null;
      data = await rpc<SharedLoan>('get_shared_loan', { p_token: token });
      // Everything answered: thank them; otherwise show the next question.
      if (data.error || !data.open) mode = 'repaymentDone';
    } else {
      notice = t(r.error === 'rate_limited' ? 'web.rateLimited' : 'common.somethingWrong');
    }
  } catch {
    notice = t('common.somethingWrong');
  } finally {
    busy = false;
    render();
  }
}

function commentForm(label: string, placeholder: string, onSend: (text: string) => void, onCancel: () => void) {
  const area = el('textarea', { id: 'comment', maxlength: '500', rows: '4', placeholder });
  const form = el(
    'form',
    { class: 'card' },
    el('label', { for: 'comment' }, label),
    area,
    el('button', { class: 'button primary', type: 'submit' }, t('web.sendDispute')),
    el('button', { class: 'button ghost', type: 'button' }, t('common.cancel')),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (area.value.trim()) onSend(area.value.trim());
    else area.focus();
  });
  form.querySelector('.ghost')!.addEventListener('click', onCancel);
  setTimeout(() => area.focus(), 0);
  return form;
}

function render() {
  const header = el('header', {}, el('strong', { class: 'brand' }, config.brand.name), languagePicker());
  const main = el('main', {});
  root.replaceChildren(header, main);

  if (!data) {
    main.append(el('p', { class: 'muted center', role: 'status' }, t('common.loading')));
    return;
  }
  if (data.error) {
    main.append(message(t(data.error === 'rate_limited' ? 'web.rateLimited' : 'web.notFound')), installCard());
    return;
  }
  const name = `⁨${data.creator_name}⁩`;
  if (mode === 'repaymentDone') {
    main.append(message(t('web.confirmedTitle'), t('web.repaymentThanks', { name })), installCard());
    return;
  }
  if (mode === 'done') {
    main.append(
      doneStatus === 'confirmed'
        ? message(t('web.confirmedTitle'), t('web.confirmedBody', { name }))
        : message(t('web.disputedTitle'), t('web.disputedBody', { name })),
      installCard(),
    );
    return;
  }
  if (!data.open) {
    main.append(message(t(data.status === 'confirmed' ? 'web.closedConfirmed' : 'web.closedOther')), installCard());
    return;
  }

  const fmt = formatContextFor(lang, t);
  const view = describeRecord(data, t, fmt);
  const card = el(
    'section',
    { class: 'card' },
    el('p', { class: 'eyebrow' }, t('web.title')),
    el('h1', {}, view.headline),
    el('p', { class: 'amount', dir: 'auto' }, view.amount),
    el('ul', { class: 'details' }, ...view.details.map((d) => el('li', {}, d))),
    view.disputed ? el('p', { class: 'disputed' }, view.disputed) : null,
  );
  main.append(card);
  if (notice) main.append(el('p', { class: 'notice', role: 'alert' }, notice));

  // An already confirmed record: the visitor (a lender without the app) is
  // only asked about repayments.
  if (data.status === 'confirmed') {
    for (const r of view.repayments) {
      if (disputingRepayment === r.id) {
        main.append(
          commentForm(
            t('web.repaymentNoLabel'),
            '',
            (text) => void answerRepayment(r.id, 'dispute', text),
            () => {
              disputingRepayment = null;
              render();
            },
          ),
        );
        continue;
      }
      const yes = el('button', { class: 'button primary', type: 'button' }, t('web.repaymentYes'));
      const no = el('button', { class: 'button secondary', type: 'button' }, t('web.repaymentNo'));
      yes.addEventListener('click', () => void answerRepayment(r.id, 'confirm', null));
      no.addEventListener('click', () => {
        disputingRepayment = r.id;
        render();
      });
      if (busy) [yes, no].forEach((b) => b.setAttribute('disabled', ''));
      main.append(el('section', { class: 'actions' }, el('h2', {}, r.question), r.note ? el('p', { class: 'muted' }, r.note) : null, yes, no));
    }
    main.append(el('p', { class: 'muted small' }, t('web.privacy')));
    return;
  }

  if (mode === 'dispute') {
    main.append(
      commentForm(
        t('web.disputeLabel'),
        t('web.disputePlaceholder'),
        (text) => void answer('dispute', text),
        () => {
          mode = 'view';
          render();
        },
      ),
    );
  } else {
    const confirm = el('button', { class: 'button primary', type: 'button' }, t('web.confirm'));
    confirm.addEventListener('click', () => void answer('confirm', null));
    const actions = el('section', { class: 'actions' }, el('h2', {}, t('web.question')), confirm);
    if (data.status === 'pending') {
      const dispute = el('button', { class: 'button secondary', type: 'button' }, t('web.dispute'));
      dispute.addEventListener('click', () => {
        mode = 'dispute';
        render();
      });
      actions.append(dispute);
    }
    actions.append(el('p', { class: 'muted' }, t('web.noAccount')));
    if (busy) actions.querySelectorAll('button').forEach((b) => b.setAttribute('disabled', ''));
    main.append(actions);
  }
  main.append(el('p', { class: 'muted small' }, t('web.privacy')));
}

// ---------- Start ----------

async function start() {
  const params = new URLSearchParams(location.search);
  const codes = config.languages.map((l) => l.code);
  // A first guess so the loading text is in a sensible language.
  await setLanguage(pickLanguage(codes, { query: params.get('lang'), stored: savedLanguage(), browser: navigator.languages }));
  render();
  if (!/^[0-9a-f]{64}$/.test(token)) {
    data = { error: 'not_found' };
  } else {
    try {
      data = await rpc<SharedLoan>('get_shared_loan', { p_token: token });
    } catch {
      data = null;
      root.replaceChildren(message(t('common.somethingWrong')));
      return;
    }
  }
  // Now we know who wrote the record: their language is the last fallback.
  const writer = data && !data.error ? data.language : null;
  await setLanguage(pickLanguage(codes, { query: params.get('lang'), stored: savedLanguage(), browser: navigator.languages, writer }));
  render();
}

void start();
