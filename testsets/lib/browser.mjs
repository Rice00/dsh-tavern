import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'

export async function openBrowser(url, { headed = false, timeoutMs = 300000, resumeMode = null } = {}) {
  const browser = await chromium.launch({ headless: !headed, handleSIGINT: false, handleSIGTERM: false })
  try {
    const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage()
    page.setDefaultTimeout(Math.min(timeoutMs, 60000))
    page.on('dialog', dialog => dialog.dismiss())
    await page.goto(url)
    await page.getByRole('button', { name: '＋ 选择人物卡 · 新开游玩', exact: true }).waitFor()
    if (resumeMode) {
      await page.getByRole('button', { name: resumeMode, exact: true }).click()
      await page.getByRole('textbox', { name: /发消息或做任务|Message or run a task/ }).waitFor()
      await page.getByRole('button', { name: /^(打开侧边栏|Open sidebar)$/ }).waitFor()
      await revealSidebar(page)
    }
    return { browser, page }
  } catch (error) { await browser.close(); throw error }
}

async function revealSidebar(page) {
  const button = page.getByRole('button', { name: /^(打开侧边栏|Open sidebar)$/ })
  if (await button.isVisible()) await button.click()
}

export async function openPlay(page, step) {
  await revealSidebar(page)
  const playTab = page.getByRole('button', { name: '游玩', exact: true })
  if (!(await playTab.getAttribute('class') || '').split(' ').includes('active')) await playTab.click()
  const picker = page.getByRole('dialog', { name: '选择人物卡开始游玩', exact: true })
  if (!await picker.isVisible()) await clickSidebarButton(page, '＋ 选择人物卡 · 新开游玩')
  const selection = await ensureCard(page, picker, step)
  try { await selection.card.click({ timeout: 2000 }) }
  catch (error) {
    if (error.name !== 'TimeoutError') throw error
    if (!await picker.isVisible()) await clickSidebarButton(page, '＋ 选择人物卡 · 新开游玩')
    await selection.card.click()
  }
  await page.getByRole('button', { name: '开始新游戏', exact: true }).click()
  await page.getByRole('dialog', { name: '游戏准备', exact: true }).waitFor({ state: 'hidden' })
  return { name: selection.name, imported: selection.imported }
}

export async function openCard(page, step) {
  await revealSidebar(page)
  // Optional import follows the same picker used by play, then enters the workbench.
  let selection
  if (step.card) {
    const name = await resolveCardName(step)
    const matches = (step.existingCardNames || []).filter(value => value === name)
    if (matches.length > 1) throw new Error('人物卡名称重复：' + name)
    if (matches.length) selection = { name, imported: false }
    else {
      const playTab = page.getByRole('button', { name: '游玩', exact: true })
      if (!(await playTab.getAttribute('class') || '').split(' ').includes('active')) await playTab.click()
      const picker = page.getByRole('dialog', { name: '选择人物卡开始游玩', exact: true })
      if (!await picker.isVisible()) await clickSidebarButton(page, '＋ 选择人物卡 · 新开游玩')
      selection = await ensureCard(page, picker, step)
      await picker.getByRole('button', { name: '关闭', exact: true }).click()
    }
  }
  const cardTab = page.getByRole('button', { name: '卡片', exact: true })
  if (!(await cardTab.getAttribute('class') || '').split(' ').includes('active')) await cardTab.click()
  const blank = page.getByRole('button', { name: /空白开始/ })
  if (!await blank.isVisible()) await clickSidebarButton(page, '＋ 新建卡片工作台对话')
  if (step.card) {
    await page.getByRole('button', { name: /^修改人物卡/ }).click()
    await namedCard(page, page.locator('.dsh-tavern-card-picker'), selection.name).click()
  } else await blank.click()
  return selection ? { name: selection.name, imported: selection.imported } : null
}

export async function send(page, input) {
  const composer = page.getByRole('textbox', { name: /发消息或做任务|Message or run a task/ })
  await composer.fill(input)
  await page.getByRole('button', { name: /^(发送消息|Send message)$/ }).click()
}

function namedCard(page, picker, name) {
  return picker.locator('button.dsh-tavern-card-pick').filter({ has: page.getByText(name, { exact: true }) })
}
async function ensureCard(page, picker, step) {
  const name = await resolveCardName(step)
  const existing = (step.existingCardNames || []).filter(value => value === name)
  if (existing.length > 1) throw new Error('人物卡名称重复：' + name)
  const imported = existing.length === 0 && Boolean(step.card)
  if (imported) await picker.locator('input[type=file]').setInputFiles(step.card)
  if (!existing.length && !step.card) throw new Error('测试 Profile 中没有人物卡：' + name)
  const card = namedCard(page, picker, name)
  await card.waitFor()
  return { card, name, imported }
}

async function clickSidebarButton(page, name) {
  const deadline = Date.now() + 60000
  while (true) {
    await revealSidebar(page)
    try { await page.getByRole('button', { name, exact: true }).click({ timeout: 1500 }); return }
    catch (error) { if (error.name !== 'TimeoutError' || Date.now() >= deadline) throw error }
  }
}

async function resolveCardName(step) {
  let name = step.cardName
  if (!name && step.card?.endsWith('.json')) {
    const card = JSON.parse(await readFile(step.card, 'utf8'))
    name = card.data?.name || card.name
  }
  if (!name) throw new Error('复用人物卡需要 cardName 或 JSON 人物卡名称')
  return name
}
