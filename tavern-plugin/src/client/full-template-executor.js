// This panel only edits settings. Template code executes in the service.
function createServerTemplatePanel({ window: hostWindow, rpc: invoke, isActive = () => true }) {
  let sessionId = '', panel = null;
  const names = {
    enabled: '启用提示词模板', generate_enabled: '生成时执行模板', generate_loader_enabled: '生成时加载世界书',
    render_enabled: '显示时执行模板', render_loader_enabled: '显示时加载世界书', with_context_disabled: '禁用 with 上下文',
    debug_enabled: '调试日志', autosave_enabled: '自动保存', preload_worldinfo_enabled: '预加载世界书',
    code_blocks_enabled: '处理代码块', raw_message_evaluation_enabled: '永久求值', filter_message_enabled: '过滤聊天消息',
    cache_enabled: '编译缓存模式', cache_size: '编译缓存数量', cache_hasher: '缓存哈希函数',
    inject_loader_enabled: '注入加载器', invert_enabled: '反转处理', depth_limit: '聊天处理深度',
    compile_workers: '异步编译', sandbox: '模板兼容沙箱', preload_only: '仅预加载条目'
  };
  function close() { panel?.remove(); panel = null; }
  async function open(event) {
    if (!sessionId || !isActive() || event?.detail?.handled) return;
    if (event?.detail) event.detail.handled = true;
    close();
    const document = hostWindow.document, owner = sessionId;
    const dialog = document.createElement('dialog'); panel = dialog;
    dialog.style.cssText = 'width:min(800px,90vw);max-height:85vh;overflow:auto;padding:24px;border-radius:12px';
    const title = document.createElement('h2'); title.textContent = '提示词模板';
    const exit = document.createElement('button'); exit.textContent = '关闭'; exit.onclick = close;
    const content = document.createElement('div'), feedback = document.createElement('p'); feedback.setAttribute('role','status');
    dialog.append(title, exit, content, feedback); document.body.appendChild(dialog);
    dialog.addEventListener('cancel', close); dialog.showModal();
    try {
      const state = await invoke('getFullPromptTemplateState', {}, owner);
      if (panel !== dialog) return;
      let settings = state.environment.extension_settings.EjsTemplate || {};
      const fields = [];
      for (const [key, label] of Object.entries(names)) {
        if (settings[key] === undefined) continue;
        const row = document.createElement('label'), input = document.createElement('input');
        row.style.cssText = 'display:block;margin:10px 0'; row.append(document.createTextNode(label + ' '));
        input.type = typeof settings[key] === 'boolean' ? 'checkbox' : typeof settings[key] === 'number' ? 'number' : 'text';
        if (input.type === 'checkbox') input.checked = settings[key]; else input.value = settings[key];
        row.append(input); content.append(row); fields.push({ key, input });
      }
      const save = document.createElement('button'); save.textContent = '保存设置'; content.append(save);
      save.onclick = async () => {
        save.disabled = true;
        try {
          const next = { ...settings };
          for (const { key, input } of fields) next[key] = input.type === 'checkbox' ? input.checked : input.type === 'number' ? Number(input.value) : input.value;
          const result = await invoke('saveFullPromptTemplateSettings', { settings: next, expectedSettings: settings }, owner);
          if (!result.updated) throw new Error('设置未保存');
          settings = result.settings; feedback.textContent = '已保存';
        } catch (error) { feedback.textContent = String(error.message || error); }
        finally { save.disabled = false; }
      };
      const command = document.createElement('textarea'); command.setAttribute('aria-label', '模板命令'); command.placeholder = '/ejs <%= 1 + 1 %>';
      command.style.cssText = 'display:block;width:100%;min-height:100px;margin-top:20px';
      const run = document.createElement('button'); run.textContent = '执行模板命令'; content.append(command, run);
      run.onclick = async () => {
        run.disabled = true;
        try { const result = await invoke('executeFullTemplateCommand', { text: command.value }, owner); feedback.textContent = String(result.pipe || '已执行'); }
        catch (error) { feedback.textContent = String(error.message || error); }
        finally { run.disabled = false; }
      };
      const bookResult = await invoke('getFullTemplateWorldbook', { name: 'current' }, owner);
      if (panel !== dialog || !bookResult?.worldbook) return;
      let book = bookResult.worldbook;
      const select = document.createElement('select'), editor = document.createElement('textarea'), saveEntry = document.createElement('button');
      select.setAttribute('aria-label', '世界书条目'); editor.setAttribute('aria-label', '条目正文');
      editor.style.cssText = 'display:block;width:100%;min-height:200px;margin:12px 0'; saveEntry.textContent = '保存条目';
      for (const [index, entry] of book.entries.entries()) {
        const option = document.createElement('option'); option.value = index; option.textContent = entry.name || entry.comment || String(entry.uid); select.append(option);
      }
      select.onchange = () => { editor.value = book.entries[Number(select.value)]?.content || ''; };
      select.onchange(); content.append(document.createElement('hr'), select, editor, saveEntry);
      saveEntry.onclick = async () => {
        if (!book.entries.length) return;
        saveEntry.disabled = true;
        try {
          const entries = book.entries.map(entry => ({ ...entry })); entries[Number(select.value)].content = editor.value;
          const result = await invoke('replaceFullTemplateWorldbook', { name: book.name, entries, expectedEntries: book.entries }, owner);
          if (!result.updated) throw new Error('条目未保存');
          book = result.worldbook; feedback.textContent = '已保存';
        } catch (error) { feedback.textContent = String(error.message || error); }
        finally { saveEntry.disabled = false; }
      };
    } catch (error) { feedback.textContent = String(error.message || error); }
  }
  hostWindow.addEventListener('dsh-template-settings', open);
  return { sync(id, view) { sessionId = view?.chatId && isPlayMode(view.mode || 'story') ? id : ''; },
    dispose() { sessionId = ''; close(); hostWindow.removeEventListener('dsh-template-settings', open); } };
}

async function initializeFullOpeningTemplate(response) {
  if (!response.preparationId) return response;
  const prepared = await rpc('initializeOpeningTemplate', { id: response.preparationId }, 'opening:' + response.preparationId);
  for (const opening of response.openings || []) if (opening.openingPreview) opening.openingPreview.runtime = prepared.runtime;
  return response;
}
