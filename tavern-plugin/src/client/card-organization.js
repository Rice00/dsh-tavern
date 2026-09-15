function cardOrganizationSections(cards) {
  const sections = new Map();
  for (const card of cards) {
    const key = card.starred ? 'starred' : 'group:' + (card.group || '');
    if (!sections.has(key)) sections.set(key, { key, title: card.starred ? '星标' : card.group || '未分组', cards: [] });
    sections.get(key).cards.push(card);
  }
  return [...sections.values()].sort((a, b) => {
    const rank = item => item.key === 'starred' ? 0 : item.key === 'group:' ? 1 : 2;
    return rank(a) - rank(b);
  });
}

function useCardOrganization(cards, busy, refresh, onError, batch) {
  const h = React.createElement;
  const [groups, setGroups] = React.useState([]);
  const [query, setQuery] = React.useState('');
  const [filter, setFilter] = React.useState('*');
  const [starsOnly, setStarsOnly] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const running = React.useRef(false);
  React.useEffect(function () {
    let active = true;
    rpc('getCardOrganization', {}).then(result => {
      if (!active) return;
      setGroups(result.groups || []);
      setFilter(previous => previous !== '*' && previous !== 'group:' && !(result.groups || []).includes(previous.slice(6)) ? '*' : previous);
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
  async function nameGroup(rename) {
    await askTavernText({ title: rename ? '重命名分组' : '新建分组', maxLength: 80,
      initialValue: rename ? filter.slice(6) : '',
      onSubmit: async name => {
        await change({ action: rename ? 'rename' : 'create', group: filter.slice(6), name });
        setFilter('group:' + name);
      }
    });
  }
  const disabled = busy || saving;
  const needle = query.trim().toLocaleLowerCase();
  const visible = cards.filter(card => (!needle || (card.name + ' ' + card.path).toLocaleLowerCase().includes(needle))
    && (filter === '*' || (card.group || '') === filter.slice(6)) && (!starsOnly || card.starred));
  function options() {
    return [h('option', { key: '', value: 'group:' }, '未分组'), ...groups.map(group => h('option', { key: group, value: 'group:' + group }, group))];
  }
  function toolbar() {
    return h('div', { className: 'dsh-tavern-card-organization' },
      h('input', { className: 'dsh-tavern-library-search', value: query, placeholder: '搜索名称或文件名', 'aria-label': '搜索人物卡', onChange: event => setQuery(event.target.value) }),
      h('div', { className: 'dsh-tavern-card-organization-tools' },
        h('select', { value: filter, 'aria-label': '筛选分组', onChange: event => setFilter(event.target.value) }, h('option', { value: '*' }, '全部分组'), options()),
        h('label', null, h('input', { type: 'checkbox', checked: starsOnly, onChange: event => setStarsOnly(event.target.checked) }), '仅看星标'),
        h('button', { className: 'dsh-tavern-btn', disabled, onClick: () => nameGroup(false) }, '新建分组'),
        filter !== '*' && filter !== 'group:' ? h(React.Fragment, null,
          h('button', { className: 'dsh-tavern-btn', disabled, onClick: () => nameGroup(true) }, '重命名分组'),
          h('button', { className: 'dsh-tavern-btn', disabled, onClick: () => {
            if (window.confirm('删除分组“' + filter.slice(6) + '”？卡片会回到未分组。')) submit({ action: 'delete', group: filter.slice(6) });
          } }, '删除分组')) : null,
        batch.managing ? h('select', { value: '', disabled: disabled || !batch.paths.length, 'aria-label': '移动所选人物卡到分组', onChange: event => {
          submit({ action: 'cards', paths: batch.paths, group: event.target.value.slice(6) });
        } }, h('option', { value: '', disabled: true }, '移动所选到…'), options()) : null));
  }
  function actions(card) {
    return h('div', { className: 'dsh-tavern-card-organization-actions' },
      h('button', { className: 'dsh-tavern-btn dsh-tavern-card-star', disabled, 'aria-label': (card.starred ? '取消星标：' : '星标：') + card.name,
        'aria-pressed': Boolean(card.starred), title: card.starred ? '取消星标' : '加星标',
        onClick: () => submit({ action: 'cards', paths: [card.path], starred: !card.starred }) }, card.starred ? '★' : '☆'),
      h('select', { value: 'group:' + (card.group || ''), disabled, 'aria-label': card.name + '的分组',
        onChange: event => submit({ action: 'cards', paths: [card.path], group: event.target.value.slice(6) }) }, options()));
  }
  function renderCards(render) {
    return cardOrganizationSections(visible).map(section => h('section', { key: section.key, className: 'dsh-tavern-card-group' },
      h('h3', { className: 'dsh-tavern-card-group-title' }, section.title, h('span', null, ' · ' + section.cards.length)), section.cards.map(render)));
  }
  return { visible, toolbar, actions, renderCards };
}
