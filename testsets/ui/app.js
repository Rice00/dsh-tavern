const $ = selector => document.querySelector(selector)
const labels = { passed: '成功', completed: '已完成', failed: '失败', interrupted: '已中断', running: '运行中', incomplete: '未完成', 'not-run': '未执行', 'not-covered': '未覆盖', 'not-invoked': '未调用', unreadable: '读取失败', cancelled: '已取消' }
const roles = { foreground: '前台正文', background: '后台结算', image: '文生图', card: '卡片 Agent' }
let runs = [], filter = 'all', selected = '', selectionVersion = 0
function el(tag, className, text) { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n }
function badge(status, text) { return el('span', 'badge ' + (['passed', 'completed'].includes(status) ? 'good' : ['failed', 'interrupted', 'unreadable', 'incomplete'].includes(status) ? 'bad' : status === 'running' ? 'busy' : 'muted'), text || labels[status] || status || '未知') }
function notify(message) { $('#notice').textContent = message; setTimeout(() => { if ($('#notice').textContent === message) $('#notice').textContent = '' }, 5000) }
function button(text, action) { const b = el('button', '', text); b.onclick = () => Promise.resolve().then(action).catch(error => notify(error.message)); return b }
async function get(url, json = true) { const response = await fetch(url); if (!response.ok) throw new Error('无法读取报告文件，请刷新重试'); return json ? response.json() : response.text() }
const fileUrl = (id, name) => '/api/file?' + new URLSearchParams({ id, name })
const date = value => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '时间未记录'
function renderRuns() {
  const query = $('#search').value.toLowerCase()
  const visible = runs.filter(r => (filter === 'all' || (filter === 'failed' ? ['failed', 'interrupted', 'unreadable'].includes(r.status) : r.status === filter)) && `${r.name} ${r.directory} ${r.model?.model || ''}`.toLowerCase().includes(query))
  $('#count').textContent = `${visible.length} 条`
  $('#runs').replaceChildren()
  for (const run of visible) {
    const b = button('', () => selectRun(run.id)); b.className = 'run' + (run.id === selected ? ' active' : '')
    b.setAttribute('aria-current', String(run.id === selected))
    const top = el('div', 'run-meta'); top.append(badge(run.status), el('span', '', `${run.rounds} 轮输入`))
    b.append(top, el('div', 'run-name', run.name), el('div', 'run-meta', date(run.startedAt || run.updatedAt)), el('div', 'run-meta', run.directory))
    $('#runs').append(b)
  }
  if (!visible.length) $('#runs').append(el('div', 'empty', '没有匹配的测试记录'))
}
async function refresh() {
  runs = await get('/api/runs'); renderRuns()
  if (selected && runs.some(r => r.id === selected)) await selectRun(selected)
  else if (runs.length) await selectRun(runs[0].id)
  else $('#detail').replaceChildren(el('div', 'empty', '暂无测试报告。运行测试后，点击“刷新报告”。'))
}
async function selectRun(id) {
  const version = ++selectionVersion; selected = id; location.hash = id; renderRuns()
  $('#detail').replaceChildren(el('div', 'empty', '正在读取报告…'))
  let data
  try { data = await get('/api/run?' + new URLSearchParams({ id })) }
  catch (error) { if (version === selectionVersion) $('#detail').replaceChildren(el('div', 'error', error.message)); return }
  if (version !== selectionVersion) return
  const { report, files } = data, detail = $('#detail'); detail.replaceChildren()
  detail.append(el('div', 'eyebrow', 'EXECUTION REPORT / 执行记录'))
  const heading = el('div', 'report-title'); heading.append(el('h2', '', report.name || runs.find(r => r.id === id)?.directory || '测试报告'), badge(report.status)); detail.append(heading)
  detail.append(el('div', 'meta', [report.model?.provider, report.model?.model, report.model?.reasoningEffort && '推理强度 ' + report.model.reasoningEffort].filter(Boolean).join(' · ') || '模型配置未记录'))
  detail.append(el('div', 'meta', `${date(report.startedAt)}  ·  ${report.steps?.filter(s => s.action === 'say').length || 0} 轮输入  ·  ${report.commit ? report.commit.slice(0, 8) + (report.dirty ? '（含未提交改动）' : '') : '提交未记录'}`))
  const stats = el('div', 'stats')
  for (const [role, title] of Object.entries(roles)) { const card = el('div', 'stat'); card.append(el('span', 'stat-label', title), badge(report.agents?.[role] || 'not-covered')); stats.append(card) }
  detail.append(stats)
  if (report.error) detail.append(el('div', 'error', report.error))
  if (report.captureError || report.cleanupErrors?.length) detail.append(el('div', 'error', '日志采集 / 清理异常：' + JSON.stringify(report.captureError || report.cleanupErrors)))
  const tabs = el('div', 'tabs'), content = el('div'); const stepsButton = button('轮次详情', () => showSteps()), filesButton = button(`文件与日志 · ${files.length}`, () => showFiles())
  tabs.append(stepsButton, filesButton); detail.append(tabs, content)
  function showFiles() { stepsButton.className = ''; filesButton.className = 'active'; content.replaceChildren(); for (const file of files) { const row = el('div', 'file-row'); row.append(button(file.name, () => preview(id, file.name)), el('span', '', `${(file.bytes / 1024).toFixed(1)} KB`)); content.append(row) } }
  function showSteps() {
    stepsButton.className = 'active'; filesButton.className = ''; content.replaceChildren()
    const first = report.steps?.find(s => s.action === 'say') || report.steps?.[0]
    for (const step of report.steps || []) {
      const block = el('details', 'step'), summary = el('summary'), title = step.action === 'say' ? `第 ${step.round || report.steps.filter(s => s.action === 'say' && s.index <= step.index).length} 轮` : step.action === 'play' ? '新开游戏' : step.action === 'card' ? '打开卡片工作台' : '生成图片'
      summary.append(el('span', 'step-title', `${String(step.index).padStart(2, '0')}  ${title}`), el('span', 'duration', step.durationMs ? `${(step.durationMs / 1000).toFixed(1)} s` : ''), badge(step.status))
      const body = el('div', 'step-body'); block.append(summary, body)
      let loaded = false
      block.addEventListener('toggle', () => { if (block.open && !loaded) { loaded = true; renderStep(id, step, files, body).catch(error => { loaded = false; body.replaceChildren(el('div', 'error', error.message)) }) } })
      content.append(block); if (step === first) block.open = true
    }
    if (!report.steps?.length) content.append(el('div', 'empty', '本次测试未进入执行步骤。请查看错误信息或原始报告。'))
  }
  showSteps()
}
async function renderStep(id, step, files, body) {
  const prefix = String(step.index).padStart(2, '0'), names = new Set(files.map(f => f.name))
  const read = async (name, fallback = null, json = true) => names.has(name) ? get(fileUrl(id, name), json) : fallback
  if (step.input) { const input = el('div', 'input-block'); input.append(el('div', 'label', '前台输入 / 测试 PROMPT'), el('div', 'prose', step.input)); body.append(input) }
  if (step.error || step.reason) body.append(el('div', 'error', step.error || step.reason))
  if (step.background) body.append(el('p', 'hint', `后台链路：${labels[step.background.status] || step.background.status} · ${step.background.requestIds?.length || 0} 个请求${step.background.required ? ' · 必须完成后再进入下一轮' : ''}`))
  if (step.candidates) body.append(el('p', 'hint', `候选项：${labels[step.candidates.status] || step.candidates.status}${step.candidates.count ? ' · ' + step.candidates.count + ' 项' : ''}`))
  if (step.cardSelection) body.append(el('p', 'hint', `人物卡：${step.cardSelection.name} · ${step.cardSelection.imported ? '首次导入' : '复用已有卡'}`))
  if (step.modelControl) body.append(el('p', 'hint', step.modelControl))
  const requests = await read(prefix + '-requests.json', [])
  let agents = await read(prefix + '-agents.json', null)
  if (!agents) {
    agents = []
    for (const request of requests) {
      const candidates = files.filter(f => f.name.startsWith(prefix + '-') && f.name.includes('native') && (!request.sessionId || f.name.includes(request.sessionId)))
      let events = candidates.length ? await read(candidates[0].name, []) : []
      agents.push({ ...request, model: request.request, outputEvents: events.filter(e => e.data?.turn === request.agentTurn) })
    }
  }
  if (!agents.length && step.action === 'say' && step.status !== 'not-run') {
    const events = await read(prefix + '-native.json', [])
    const text = await read(prefix + '-reply.md', '', false)
    agents = [{ scope: step.role || step.agent || 'foreground', status: step.status, response: { text }, outputEvents: events }]
  }
  if (['play', 'card'].includes(step.action)) agents = agents.filter(agent => agent.response?.text || agent.outputEvents?.some(event => ['assistant/message', 'tool/call'].includes(event.type)))
  const grid = el('div', 'agents')
  for (const agent of agents) {
    const role = step.role === 'card' || step.action === 'card' ? 'card' : /image|scene|illustration/.test(agent.task || '') ? 'image' : agent.scope || 'foreground'
    const card = el('div', 'agent'), head = el('div', 'agent-head'); head.append(el('strong', '', agent.task === 'candidate' ? '候选项生成' : roles[role] || role), badge(agent.status)); card.append(head)
    card.append(el('div', 'meta', [agent.model?.model, agent.model?.reasoningEffort, agent.task].filter(Boolean).join(' · ')))
    const check = (step.responseChecks || []).find(c => c.requestId === (agent.requestId || agent.id)) || (step.response?.agent === role ? step.response : null)
    if (check) { card.append(badge(check.refused ? 'failed' : check.refused === false ? 'passed' : 'incomplete', check.refused ? '拒绝' : check.refused === false ? '未发现拒绝' : '执行异常')); if (check.refused && check.evidence) card.append(el('div', 'error', check.evidence)) }
    const outputEvents = agent.outputEvents || []
    const text = agent.response?.text || outputEvents.filter(e => e.type === 'assistant/message').flatMap(e => e.data?.message?.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n')
    card.append(el('div', text ? 'prose' : 'hint', text || (outputEvents.some(e => e.type === 'tool/call') ? '通过工具调用提交结果，详见下方。' : '暂无文本输出，原始事件见日志。')))
    if (agent.response?.error) card.append(el('div', 'error', String(agent.response.error)))
    const calls = outputEvents.filter(e => ['tool/call', 'tool/result'].includes(e.type))
    if (calls.length) {
      const tools = el('details', 'tools'); tools.append(el('summary', '', `工具调用与返回 · ${calls.length} 条`))
      for (const event of calls) { const row = el('div', 'tool'); row.append(el('strong', '', event.type === 'tool/call' ? '调用 ' + (event.data?.name || '') : '工具返回'), el('pre', '', JSON.stringify(event.data, null, 2).slice(0, 30000))); tools.append(row) } card.append(tools)
    }
    grid.append(card)
  }
  if (grid.childNodes.length) body.append(grid)
  for (const assertion of step.assertions || []) if (!assertion.passed) body.append(el('div', 'assertion', '断言未通过：' + JSON.stringify(assertion)))
  if (step.captureErrors?.length) body.append(el('div', 'error', '证据采集异常：' + JSON.stringify(step.captureErrors)))
  if (step.imageFile && names.has(step.imageFile)) { const b = button('查看生成图片', () => preview(id, step.imageFile)); body.append(b) }
  const links = el('div', 'step-links')
  for (const name of [prefix + '-candidates.json', prefix + '-chat.json', prefix + '-requests.json', prefix + '-native.json', prefix + '.png', 'events.jsonl']) if (names.has(name)) links.append(button(name.endsWith('-candidates.json') ? '候选项结果' : name.endsWith('.png') ? '界面截图' : name.endsWith('chat.json') ? '存档快照' : name.endsWith('requests.json') ? '完整请求与输出' : name.endsWith('native.json') ? '原生事件' : '运行时间线', () => preview(id, name)))
  body.append(links)
}
async function preview(id, name) {
  $('#preview-title').textContent = name; $('#preview-body').replaceChildren(el('p', 'hint', '正在读取…')); if (!$('#preview').open) $('#preview').showModal()
  if (/\.(png|jpe?g|webp|gif)$/.test(name)) { const img = el('img'); img.src = fileUrl(id, name); img.alt = name; $('#preview-body').replaceChildren(img); return }
  try { const text = await get(fileUrl(id, name), false); $('#preview-body').replaceChildren(el('pre', '', text.slice(0, 200000))); if (text.length > 200000) $('#preview-body').append(el('p', 'hint', '预览前 200,000 字符，完整内容请打开本地文件。')) }
  catch (error) { $('#preview-body').replaceChildren(el('div', 'error', error.message)) }
}
$('#close-preview').onclick = () => $('#preview').close()
$('#search').oninput = renderRuns
$('#filters').onclick = event => { if (!event.target.dataset.filter) return; filter = event.target.dataset.filter; for (const b of $('#filters').children) b.classList.toggle('selected', b.dataset.filter === filter); renderRuns() }
$('#refresh').onclick = () => refresh().catch(error => notify(error.message))
selected = location.hash.slice(1)
refresh().catch(error => { $('#detail').replaceChildren(el('div', 'error', error.message)) })
