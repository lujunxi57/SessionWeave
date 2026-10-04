import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

// Inspect the saved real demo without sending any new business requests.
const base = process.env.DEMO_URL || 'http://127.0.0.1:8787';
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let dispatches = 0;
page.on('request', request => {
  if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/runs') dispatches++;
});
try {
  await page.goto(base);
  await page.locator('.react-flow__node').nth(2).waitFor();
  await page.getByLabel('搜索会话', { exact: true }).fill('SessionWeave test');
  await page.getByLabel('时间范围', { exact: true }).selectOption('all');
  await page.getByLabel('Harness 筛选').selectOption('opencode');
  await page.locator('.session-item').first().waitFor();
  assert.ok(await page.locator('.session-item').count() > 0);
  assert.equal(await page.locator('.session-item .harness.codex').count(), 0);
  await page.getByLabel('Harness 筛选').selectOption('all');
  const count = await page.locator('.react-flow__node').count();
  const resource = page.locator('.session-item').filter({ hasText: '低思考 A' }).first();
  await resource.dragTo(page.locator('.canvas'), { targetPosition: { x: 160, y: 110 } });
  await page.waitForFunction(n => document.querySelectorAll('.react-flow__node').length === n + 1, count);
  await page.getByLabel('删除步骤').click();
  assert.equal(await page.locator('.react-flow__node').count(), count);

  await page.locator('.react-flow__node[data-id="A1"]').click();
  const historyResponse = page.waitForResponse(response => response.url().endsWith('/api/history'));
  // Force another conversation and return to ensure history has arrived.
  await page.locator('.react-flow__node[data-id="B"]').click();
  await historyResponse;
  const historyA = page.waitForResponse(response => response.url().endsWith('/api/history') && response.request().postDataJSON().harness === 'opencode');
  await page.locator('.react-flow__node[data-id="A1"]').click();
  await historyA;
  const editor = page.locator('.cm-content');
  await editor.fill('保留这份临时草稿，不发送。');
  await editor.press('Control+Home');
  await editor.press('ArrowUp');
  assert.notEqual(await editor.innerText(), '保留这份临时草稿，不发送。');
  await editor.press('Control+End');
  await editor.press('ArrowDown');
  assert.equal(await editor.innerText(), '保留这份临时草稿，不发送。');
  await page.getByLabel('搜索文件', { exact: true }).fill('README');
  await page.locator('.file-search button').click();
  await page.locator('.file-result').filter({ hasText: 'README.md' }).first().click();
  assert.ok(await page.locator('.selected-file').count() > 0);
  const skill = page.locator('.editor-resources .check-row').filter({ hasText: /^OpenCode$/ }).getByRole('checkbox');
  await skill.check();
  assert.equal(await skill.isChecked(), true);
  await page.getByLabel('关闭详情').click();
  // Reload discards unsaved inspection edits and returns the proved workflow.
  await page.reload();
  await page.locator('.step-card.succeeded').nth(2).waitFor();
  await page.getByLabel('搜索会话', { exact: true }).fill('SessionWeave test');
  await page.getByLabel('时间范围', { exact: true }).selectOption('all');
  await page.locator('.session-item').filter({ hasText: '低思考 A' }).first().waitFor();
  await page.locator('.session-item').filter({ hasText: '低思考 A' }).first().getByRole('checkbox').check();
  await page.locator('.session-item').filter({ hasText: 'Luna light B' }).first().getByRole('checkbox').check();
  await page.getByLabel('自然语言需求', { exact: true }).fill('先让 OpenCode A 为咖啡馆取名，由 Codex B 提出一条批评，最后回到 A 修订并结束。');
  await mkdir('docs/evidence', { recursive: true });
  await page.screenshot({ path: 'docs/evidence/demo网页.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('会话列表', { exact: true }).click();
  assert.equal(await page.locator('.sessions-panel').isVisible(), true);
  await page.getByLabel('会话列表', { exact: true }).click();
  await page.getByLabel('计划面板', { exact: true }).click();
  assert.equal(await page.locator('.plan-panel').isVisible(), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.equal(dispatches, 0);
  assert.deepEqual(errors, []);
  const report = { passed: true, checks: ['真实列表筛选', '会话拖放', '删除临时步骤', '历史上下键恢复草稿', '文件选择', 'Skill 选择', '完成状态恢复', '390px 抽屉与布局'], businessRunRequests: dispatches, pageErrors: errors };
  await writeFile('docs/evidence/网页交互验收.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally {
  await browser.close();
}
