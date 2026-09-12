import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'

export async function openBrowser(url, { headed = false, timeoutMs = 300000 } = {}) {
  const browser = await chromium.launch({ headless: !headed })
  try {
    const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 } })
    const page = await context.newPage()
    page.setDefaultTimeout(Math.min(timeoutMs, 60000))
    page.on('dialog', dialog => dialog.dismiss())
    await page.goto(url)
    await page.getByRole('button', { name: '＋ 选择人物卡 · 新开游玩', exact: true }).waitFor()
    return { browser, page }
  } catch (error) { await browser.close(); throw error }
}

async function revealSidebar(page) {
  const button = page.getByRole('button', { name: /^(打开侧边栏|Open sidebar)$/ })
  if (await button.isVisible()) await button.click()
}

export async function openPlay(page, step) {
  await revealSidebar(page)
  await page.getByRole('button', { name: '游玩', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '选择人物卡开始游玩', exact: true })
  if (!await picker.isVisible()) await page.getByRole('button', { name: '＋ 选择人物卡 · 新开游玩', exact: true }).click()
  if (step.card) await picker.locator('input[type=file]').setInputFiles(step.card)
  // The importer selects no chat and performs the same validation as a manual upload.
  const cards = picker.locator('button.dsh-tavern-card-pick')
  await cards.first().waitFor()
  let name = step.cardName
  if (!name && step.card?.endsWith('.json')) { const card = JSON.parse(await readFile(step.card, 'utf8')); name = card.data?.name || card.name }
  if (name) await cards.filter({ hasText: name }).click()
  else if (await cards.count() === 1) await cards.first().click()
  else throw new Error('多张人物卡时请指定 cardName')
  await page.getByRole('button', { name: '开始新游戏', exact: true }).click()
  await page.getByRole('dialog', { name: '游戏准备', exact: true }).waitFor({ state: 'hidden' })
}

export async function openCard(page, step) {
  await revealSidebar(page)
  // Optional import follows the same picker used by play, then enters the workbench.
  if (step.card) {
    await page.getByRole('button', { name: '游玩', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '选择人物卡开始游玩', exact: true })
    if (!await picker.isVisible()) await page.getByRole('button', { name: '＋ 选择人物卡 · 新开游玩', exact: true }).click()
    await picker.locator('input[type=file]').setInputFiles(step.card)
    await picker.locator('button.dsh-tavern-card-pick').first().waitFor()
    await picker.getByRole('button', { name: '关闭', exact: true }).click()
  }
  await page.getByRole('button', { name: '卡片', exact: true }).click()
  const blank = page.getByRole('button', { name: /空白开始/ })
  if (!await blank.isVisible()) await page.getByRole('button', { name: '＋ 新建卡片工作台对话', exact: true }).click()
  if (step.card) {
    await page.getByRole('button', { name: /^修改人物卡/ }).click()
    await page.locator('.dsh-tavern-card-picker button.dsh-tavern-card-pick').last().click()
  } else await blank.click()
}

export async function send(page, input) {
  const composer = page.getByRole('textbox', { name: /发消息或做任务|Message or run a task/ })
  await composer.fill(input)
  await page.getByRole('button', { name: /^(发送消息|Send message)$/ }).click()
}
