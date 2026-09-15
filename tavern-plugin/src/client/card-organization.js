function filterOrganizedCards(cards, filter, query) {
  const needle = query.trim().toLocaleLowerCase();
  return cards.filter(card => (!needle || (card.name + ' ' + card.path).toLocaleLowerCase().includes(needle))
    && (filter === '*' || (filter === 'favorites' ? card.starred : (card.group || '') === filter.slice(6))));
}

function useCardOrganization(cards, busy, refresh, onError, batch) {
  const h = React.createElement;
  const [groups, setGroups] = React.useState([]);
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState('*');
  const [managing, setManaging] = React.useState(false);
  const menu = React.useRef(null);
  const manager = React.useRef(null);
  const [saving, setSaving] = React.useState(false);
  const running = React.useRef(false);
  React.useEffect(function () {
    let active = true;
    rpc('getCardOrganization', {}).then(result => {
      if (!active) return;
      setGroups(result.groups || []);
      setFilter(previous => previous !== '*' && previous !== 'favorites' && previous !== 'group:' && !(result.groups || []).includes(previous.slice(6)) ? '*' : previous);
    }, error => { if (active) onError(String(error.message || error)); });
    return () => { active = false; };
  }, [cards]);
  async function change(input) {
    if (running.current || busy) return;
    running.current = true; setSaving(true);
    try {
      const result = await rpc('organizeCards', input);
      setGroups(result.groups || []);
      await refresh();
      notifyTavernDataChanged(['cards'], 'card-organization');
    } finally { running.current = false; setSaving(false); }
  }
  function submit(input) { void change(input).catch(error => onError(String(error.message || error))); }
  async function nameGroup(group) {
    await askTavernText({ title: group !== undefined ? '重命名分组' : '创建分组', maxLength: 80,
      initialValue: group || '',
      onSubmit: async name => {
        await change({ action: group !== undefined ? 'rename' : 'create', group, name });
        setFilter('group:' + name);
      }
    });
  }
  const disabled = busy || saving;
  const visible = filterOrganizedCards(cards, filter, query);
  function options() {
    return [h('option', { key: '', value: 'group:' }, '未分组'), ...groups.map(group => h('option', { key: group, value: 'group:' + group }, group))];
  }
  function closeMenu() { if (menu.current) menu.current.open = false; }
  function toolbar() {
    const choices = [{ value: '*', label: '全部' }, { value: 'favorites', label: '收藏' },
      { value: 'group:', label: '未分组' }, ...groups.map(group => ({ value: 'group:' + group, label: group }))];
    const selected = choices.find(choice => choice.value === filter)?.label || '全部';
    return h(React.Fragment, null,
      h('div', { className: 'dsh-tavern-card-organization' },
        h('details', { ref: menu, className: 'dsh-tavern-group-picker', onBlur: event => {
          if (!event.currentTarget.contains(event.relatedTarget)) closeMenu();
        }, onKeyDown: event => { if (event.key === 'Escape') { closeMenu(); menu.current.querySelector('summary').focus(); } } },
          h('summary', { 'aria-label': '选择分组：' + selected }, h('span', null, selected), h('span', { 'aria-hidden': true }, '⌄')),
          h('div', { className: 'dsh-tavern-group-menu' },
            h('div', { className: 'dsh-tavern-group-options' }, choices.map(choice => h('button', {
              key: choice.value, type: 'button', 'aria-pressed': filter === choice.value,
              onClick: () => { setFilter(choice.value); closeMenu(); }
            }, h('span', { 'aria-hidden': true }, filter === choice.value ? '✓' : ''), choice.label))),
            h('div', { className: 'dsh-tavern-group-menu-footer' },
              h('button', { type: 'button', disabled, onClick: () => { closeMenu(); void nameGroup(); } }, '＋ 创建分组'),
              h('button', { type: 'button', onClick: () => { closeMenu(); setManaging(true); } }, '管理分组')))),
        h('input', { className: 'dsh-tavern-library-search', value: query, placeholder: '搜索人物卡', 'aria-label': '搜索人物卡', onChange: event => setQuery(event.target.value) })),
      batch.managing ? h('div', { className: 'dsh-tavern-card-batch-panel' }, batch.toolbar(visible),
        h('select', { value: '', disabled: disabled || !batch.paths.length, 'aria-label': '移动所选人物卡到分组', onChange: event => {
          submit({ action: 'cards', paths: batch.paths, group: event.target.value.slice(6) });
        } }, h('option', { value: '', disabled: true }, '移动所选到…'), options())) : null,
      managing ? h('dialog', { className: 'dsh-tavern-group-manager', 'aria-label': '管理分组',
        ref: element => { manager.current = element; if (element && !element.open) element.showModal(); },
        onCancel: () => setManaging(false), onClick: event => { if (event.target === event.currentTarget && !disabled) setManaging(false); }
      }, h('div', { className: 'dsh-tavern-group-manager-content' },
        h('div', { className: 'dsh-tavern-group-manager-head' }, h('h3', null, '管理分组'),
          h('button', { className: 'dsh-tavern-btn', onClick: () => setManaging(false) }, '关闭')),
        groups.length ? groups.map(group => h('div', { key: group, className: 'dsh-tavern-group-manager-row' },
          h('span', null, group),
          h('button', { className: 'dsh-tavern-btn', disabled, 'aria-label': '重命名分组：' + group, onClick: () => nameGroup(group) }, '重命名'),
          h('button', { className: 'dsh-tavern-btn', disabled, 'aria-label': '删除分组：' + group, onClick: () => {
            if (window.confirm('删除分组“' + group + '”？卡片会回到未分组。')) submit({ action: 'delete', group });
          } }, '删除'))) : h('p', { className: 'dsh-tavern-question-sub' }, '还没有自定义分组'),
        h('div', { className: 'dsh-tavern-group-manager-footer' },
          h('button', { className: 'dsh-tavern-btn', disabled, onClick: () => nameGroup() }, '＋ 创建分组'),
          h('button', { className: 'dsh-tavern-btn', disabled, onClick: () => { setManaging(false); batch.begin(); } }, '批量整理人物卡')))) : null);
  }
  function detailSettings(card) {
    if (!card) return null;
    return h('div', { className: 'dsh-tavern-card-detail-organization' },
      h('button', { className: 'dsh-tavern-btn', disabled, 'aria-pressed': Boolean(card.starred),
        onClick: () => submit({ action: 'cards', paths: [card.path], starred: !card.starred }) }, card.starred ? '★ 已收藏' : '☆ 收藏'),
      h('label', null, '所属分组', h('select', { value: 'group:' + (card.group || ''), disabled, 'aria-label': '所属分组',
        onChange: event => submit({ action: 'cards', paths: [card.path], group: event.target.value.slice(6) }) }, options())),
      h('button', { className: 'dsh-tavern-btn', disabled, onClick: () => nameGroup() }, '创建分组'));
  }
  return { visible, toolbar, detailSettings, renderCards: render => visible.map(render) };
}
