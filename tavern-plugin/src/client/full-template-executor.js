// UI only: commands and template evaluation stay in the service.
function createServerTemplatePanel({ window: hostWindow, rpc: invoke, isActive = () => true }) {
  let sessionId = '', panel = null, cleanup = null;
  const fields = [
    ['enabled', '启用提示词模板', true],
    ['generate_enabled', '生成时执行模板', true],
    ['generate_loader_enabled', '生成时加载 GENERATE 世界书条目', true],
    ['inject_loader_enabled', '启用 @INJECT 注入', false],
    ['render_enabled', '显示时执行模板', true],
    ['render_loader_enabled', '显示时加载 RENDER 世界书条目', true],
    ['preload_worldinfo_enabled', '预加载世界书', true],
    ['preload_only', '仅预加载 PRELOAD 条目', true],
    ['code_blocks_enabled', '处理消息中的代码块', false],
    ['raw_message_evaluation_enabled', '将模板结果写入原始消息', true],
    ['filter_message_enabled', '生成时过滤消息中的模板代码', true],
    ['depth_limit', '消息处理深度（-1 表示不限）', -1],
    ['autosave_enabled', '自动保存变量更新', false],
    ['with_context_disabled', '禁用 with 上下文', false],
    ['invert_enabled', '旧设定兼容模式', true],
    ['sandbox', '模板兼容沙箱', false],
    ['compile_workers', '异步编译', false],
    ['cache_enabled', '编译缓存', 0, [[0, '关闭'], [1, '开启'], [2, '仅世界书']]],
    ['cache_size', '缓存数量（0 表示不限）', 64],
    ['cache_hasher', '缓存哈希函数', 'h32ToString', [['h32ToString','h32ToString'], ['h64ToString','h64ToString']]],
    ['debug_enabled', '调试日志', false]
  ];
  function close() { const done = cleanup; cleanup = null; panel?.close(); panel?.remove(); panel = null; done?.(); }
  async function open(event) {
    if (!sessionId || !isActive() || event?.detail?.handled) return;
    if (event?.detail) event.detail.handled = true;
    close();
    const document = hostWindow.document, owner = sessionId, previous = document.activeElement;
    const dialog = document.createElement('dialog'); panel = dialog;
    const alive = () => panel === dialog && sessionId === owner && isActive();
    cleanup = () => { event?.detail?.onClose?.(); if (previous?.isConnected) previous.focus(); };
    if (event?.detail) event.detail.close = () => { if (panel === dialog) close(); };
    function el(tag, text, className) { const node = document.createElement(tag); if (text) node.textContent = text; if (className) node.className = className; return node; }
    function button(text, action) { const node = el('button', text, 'dsh-tavern-btn'); node.type = 'button'; node.onclick = action; return node; }
    function section(title, help) { const node = el('section', '', 'dsh-template-section'); node.append(el('h3', title), el('p', help, 'dsh-template-help')); body.append(node); return node; }
    function status(parent) { const node = el('p', '', 'dsh-template-feedback'); node.setAttribute('role', 'status'); parent.append(node); return node; }
    function report(node, error) { if (alive()) node.textContent = String(error.message || error); }
    dialog.className = 'dsh-ejs-editor dsh-template-panel'; dialog.setAttribute('aria-label', '提示词模板设置与编辑器');
    const header = el('div', '', 'dsh-ejs-editor-head'), heading = el('div');
    heading.append(el('h2', '提示词模板设置与编辑器'), el('p', '模板运行设置 · 当前游戏世界书 · 模板命令测试'));
    header.append(heading, button('关闭', close));
    const body = el('div', '', 'dsh-template-panel-body'); dialog.append(header, body); document.body.append(dialog);
    dialog.addEventListener('cancel', e => { e.preventDefault(); close(); }); dialog.showModal();
    const settingsSection = section('模板运行设置', '这些设置对所有游戏生效。关闭模板可能影响依赖 EJS 的人物卡或状态栏。修改后点击保存设置。');
    const settingsStatus = status(settingsSection); settingsStatus.textContent = '正在读取设置…';
    const bookSection = section('世界书模板编辑', '编辑当前游戏使用的世界书。EJS 代码编辑器支持补全、主题和字体；应用后点击保存条目。');
    const bookStatus = status(bookSection); bookStatus.textContent = '正在读取世界书…';
    const commandSection = section('模板命令', '在当前游戏中执行，例如 /ejs <%= 1 + 1 %>。命令可修改变量或游戏数据。');
    const command = el('textarea'); command.setAttribute('aria-label', '模板命令'); command.placeholder = '/ejs <%= 1 + 1 %>';
    const commandStatus = status(commandSection);
    const run = button('执行模板命令', async () => {
      if (!alive() || run.disabled || !command.value.trim()) return;
      run.disabled = true; commandStatus.textContent = '正在执行…';
      try { const result = await invoke('executeFullTemplateCommand', { text: command.value }, owner); if (alive()) commandStatus.textContent = String(result.pipe ?? '已执行'); }
      catch (error) { report(commandStatus, error); }
      finally { if (alive()) run.disabled = false; }
    });
    commandSection.insertBefore(command, commandStatus); commandSection.insertBefore(run, commandStatus);
    await Promise.all([
      (async () => {
        try {
          const state = await invoke('getFullPromptTemplateState', {}, owner); if (!alive()) return;
          let settings = state.environment.extension_settings.EjsTemplate;
          const form = el('form', '', 'dsh-template-settings-form'), inputs = [];
          const basic = el('div', '', 'dsh-template-settings-grid'), advanced = el('details'); advanced.append(el('summary', '高级兼容与性能选项'));
          const advancedGrid = el('div', '', 'dsh-template-settings-grid'); advanced.append(advancedGrid); form.append(basic, advanced);
          fields.forEach(([key, label, fallback, choices], index) => {
            const value = settings?.[key] ?? fallback, row = el('label', '', 'dsh-template-setting');
            const input = el(choices ? 'select' : 'input'); input.setAttribute('aria-label', label);
            if (choices) {
              const values = choices.some(([v]) => String(v) === String(value)) ? choices : [...choices, [value, String(value)]];
              values.forEach(([v, text]) => { const option = el('option', text); option.value = String(v); input.append(option); }); input.value = String(value);
            } else {
              input.type = typeof fallback === 'boolean' ? 'checkbox' : 'number';
              if (input.type === 'checkbox') input.checked = Boolean(value);
              else { input.value = String(value); input.step = '1'; input.min = key === 'depth_limit' ? '-1' : '0'; }
            }
            row.append(el('span', label), input); (index < 8 ? basic : advancedGrid).append(row); inputs.push({ key, input, fallback });
          });
          const save = button('保存设置'); save.type = 'submit'; form.append(save);
          form.onsubmit = async e => {
            e.preventDefault(); if (!alive() || save.disabled) return;
            save.disabled = true; settingsStatus.textContent = '正在保存…';
            try {
              const next = { ...settings };
              for (const { key, input, fallback } of inputs) next[key] = typeof fallback === 'boolean' ? input.checked : typeof fallback === 'number' ? Number(input.value) : input.value;
              const result = await invoke('saveFullPromptTemplateSettings', { settings: next, expectedSettings: settings }, owner);
              if (!alive()) return; if (!result.updated) throw new Error('设置未保存，请重新打开面板后重试');
              settings = result.settings; settingsStatus.textContent = '已保存';
            } catch (error) { report(settingsStatus, error); }
            finally { if (alive()) save.disabled = false; }
          };
          settingsSection.insertBefore(form, settingsStatus); settingsStatus.textContent = '';
        } catch (error) { report(settingsStatus, error); }
      })(),
      (async () => {
        try {
          const result = await invoke('getFullTemplateWorldbook', { name: 'current' }, owner); if (!alive()) return;
          let book = result?.worldbook;
          if (!book?.entries?.length) { bookStatus.textContent = '当前游戏没有可编辑的世界书条目。'; return; }
          const select = el('select'), editor = el('textarea'); select.setAttribute('aria-label', '世界书条目'); editor.setAttribute('aria-label', '条目正文');
          const drafts = new Map(); let selected = 0;
          book.entries.forEach((entry, index) => { const option = el('option', entry.name || entry.comment || String(entry.uid)); option.value = index; select.append(option); });
          editor.value = book.entries[0].content || '';
          select.onchange = () => { drafts.set(selected, editor.value); selected = Number(select.value); editor.value = drafts.get(selected) ?? book.entries[selected].content ?? ''; };
          const code = button('EJS 代码编辑', () => {
            if (!alive()) return;
            const index = selected;
            event.detail.openCodeEditor({ value: editor.value, title: book.entries[index].name || book.entries[index].comment || '世界书条目', onApply: value => {
              if (!alive()) return; drafts.set(index, value); if (selected === index) editor.value = value;
            } });
          });
          code.disabled = typeof event?.detail?.openCodeEditor !== 'function';
          const saveEntry = button('保存条目', async () => {
            if (!alive() || saveEntry.disabled) return;
            saveEntry.disabled = true; select.disabled = true; editor.disabled = true; code.disabled = true; bookStatus.textContent = '正在保存…';
            try {
              drafts.set(selected, editor.value);
              const entries = book.entries.map((entry, i) => drafts.has(i) ? { ...entry, content: drafts.get(i) } : { ...entry });
              const saved = await invoke('replaceFullTemplateWorldbook', { name: book.name, entries, expectedEntries: book.entries }, owner);
              if (!alive()) return; if (!saved.updated) throw new Error('条目未保存，请重新打开面板后重试');
              book = saved.worldbook; drafts.clear(); bookStatus.textContent = '已保存';
            } catch (error) { report(bookStatus, error); }
            finally { if (alive()) { saveEntry.disabled = false; select.disabled = false; editor.disabled = false; code.disabled = typeof event?.detail?.openCodeEditor !== 'function'; } }
          });
          const actions = el('div', '', 'dsh-template-actions'); actions.append(code, saveEntry);
          bookSection.insertBefore(select, bookStatus); bookSection.insertBefore(editor, bookStatus); bookSection.insertBefore(actions, bookStatus); bookStatus.textContent = '';
        } catch (error) { report(bookStatus, error); }
      })()
    ]);
  }
  hostWindow.addEventListener('dsh-template-settings', open);
  return { close, sync(id, view) { const next = view?.chatId && isPlayMode(view.mode || 'story') ? id : ''; if (next !== sessionId) close(); sessionId = next; },
    dispose() { sessionId = ''; close(); hostWindow.removeEventListener('dsh-template-settings', open); } };
}

async function initializeFullOpeningTemplate(response) {
  if (!response.preparationId) return response;
  const prepared = await rpc('initializeOpeningTemplate', { id: response.preparationId }, 'opening:' + response.preparationId);
  for (const opening of response.openings || []) if (opening.openingPreview) opening.openingPreview.runtime = prepared.runtime;
  return response;
}
