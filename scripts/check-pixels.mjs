import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const artifactDir = process.env.ARTIFACT_DIR ? path.resolve(process.env.ARTIFACT_DIR) : undefined;

// Browser fixtures exercise the production UI without submitting real Harness
// jobs, changing native models, or overwriting the user's saved workflow.
const sessions = [
  { id: 'pixel-a', harness: 'opencode', title: '开发员工 A', preview: '搭建一个简单的待办页面', cwd: '/tmp', updatedAt: Date.now(), state: 'idle', model: 'space-bunny-free', effort: 'low', testing: true },
  { id: 'pixel-b', harness: 'codex', title: '评审员工 B', preview: '检查实现并给出修改意见', cwd: '/tmp', updatedAt: Date.now(), state: 'idle', model: 'gpt-6-luna', effort: 'low', testing: true },
];
const workflow = {
  id: 'pixel-browser-check', name: '待办页面 · 开发、评审、修订',
  nodes: ['A1', 'B', 'A3'].map((id, i) => ({ id, conversationRef: { harness: sessions[i === 1 ? 1 : 0].harness, id: sessions[i === 1 ? 1 : 0].id },
    purpose: ['实现待办页面', '评审代码与交互', '按评审意见修订'][i], mode: 'kickoff',
    promptTemplate: ['实现添加、完成与删除待办。', '检查上游实现，提出一条具体建议。', '完成修订后结束。'][i],
    selectedSkills: [], selectedFiles: [], upstreamOutputRefs: i ? [i === 1 ? 'A1' : 'B'] : [], polishBeforeSend: false,
    position: { x: 50 + i * 350, y: 110 } })),
  edges: [{ id: 'ab', source: 'A1', target: 'B' }, { id: 'ba', source: 'B', target: 'A3' }],
};
let currentRun;
function progress(states, runState = 'running') {
  const createdAt = currentRun?.createdAt || Date.now();
  currentRun = { id: 'pixel-fixture-run', workflow, state: runState, createdAt,
    nodes: states.map((state, i) => ({ id: `nr-${i}`, nodeId: workflow.nodes[i].id, state, inputTemplate: workflow.nodes[i].promptTemplate,
      ...(state !== 'queued' ? { startedAt: createdAt + i + 1, nativeTurnOrMessageId: `turn-${i}` } : {}),
      ...(state === 'succeeded' ? { completedAt: Date.now(), outputSnapshot: '完成本步骤' } : {}) })) };
  return currentRun;
}
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1512, height: 982 } });
const errors = [], checks = []; let fixtureRunPosts = 0, unmatchedApi = 0;
page.on('pageerror', error => errors.push(error.message));
await page.addInitScript(() => {
  const streams = [];
  window.EventSource = class extends EventTarget {
    constructor() { super(); streams.push(this); setTimeout(() => this.dispatchEvent(new Event('open')), 0); }
    close() { const index = streams.indexOf(this); if (index >= 0) streams.splice(index, 1); }
  };
  window.__pixelEmit = data => streams.forEach(stream => stream.dispatchEvent(new MessageEvent('run', { data: JSON.stringify(data) })));
  window.__pixelReconnect = () => streams.forEach(stream => stream.dispatchEvent(new Event('open')));
});
await page.route('**/api/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  let body;
  if (path === '/api/sessions') body = { data: sessions, connections: { codex: { ok: true }, opencode: { ok: true } } };
  else if (path === '/api/workflow') body = workflow;
  else if (path === '/api/runs') {
    if (request.method() === 'POST') { fixtureRunPosts++; body = progress(['queued', 'queued', 'queued']); }
    else body = currentRun ? [currentRun] : [];
  }
  else if (path === '/api/resources') body = { skills: [], commands: [] };
  else if (path === '/api/history') body = [];
  else if (path === '/api/models') {
    const session = sessions.find(session => session.id === request.postDataJSON().id);
    body = { models: [{ id: session.model, providerID: session.harness === 'opencode' ? 'opencode' : undefined, name: session.model,
      providerName: session.harness, efforts: ['low'], defaultEffort: 'low' }],
    current: { id: session.model, effort: 'low' }, conversation: session, source: 'session' };
  } else { unmatchedApi++; return route.abort(); }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
const emit = async run => page.evaluate(data => window.__pixelEmit(data), run);
const employeeA = () => page.locator('.pixel-employee[data-employee-id="opencode:pixel-a"]');
async function fit() { await page.getByRole('button', { name: 'fit view' }).click(); }
async function settleMovement() { await page.waitForFunction(() => [...document.querySelectorAll('.pixel-employee')].every(el => !['walk', 'spawn'].includes(el.dataset.movement))); }
try {
  await page.goto(process.env.DEMO_URL || 'http://127.0.0.1:8787');
  await page.locator('.pixel-station').nth(2).waitFor();
  assert.equal(await page.locator('.pixel-employee').count(), 0);
  checks.push('未运行只有工位，不虚构正在工作的员工');
  const resourceA = page.locator('.session-item').filter({ hasText: '开发员工 A' });
  await resourceA.dragTo(page.locator('.canvas'), { targetPosition: { x: 160, y: 120 } });
  await page.locator('.pixel-station').nth(3).waitFor();
  assert.equal(await page.locator('.station-entering').count(), 1);
  assert.equal(await page.locator('.pixel-employee').count(), 0);
  await page.getByLabel('删除步骤', { exact: true }).click();
  assert.equal(await page.locator('.pixel-station').count(), 3);
  checks.push('重复拖入会话部署新工位，未生成员工分身');
  await page.getByRole('button', { name: '运行', exact: true }).click();
  await page.locator('.pixel-station.queued').nth(2).waitFor();
  assert.equal(await page.locator('.pixel-employee').count(), 0);
  await page.getByLabel('关闭详情', { exact: true }).click();
  await emit(progress(['running', 'queued', 'queued']));
  await employeeA().waitFor();
  await page.waitForFunction(() => document.querySelector('.pixel-employee')?.dataset.movement === 'spawn');
  await settleMovement();
  assert.equal(await page.locator('.pixel-employee').count(), 1);
  assert.equal(await employeeA().getAttribute('data-node-id'), 'A1');
  const paletteA = await employeeA().getAttribute('data-palette');
  const painted = await employeeA().locator('canvas').evaluate(canvas => {
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    return [...pixels].filter((_, index) => index % 4 === 3).some(alpha => alpha > 0);
  });
  assert.ok(painted);
  checks.push('真实精灵表加载、数字雨登场、走向工位及工作帧');
  await emit(progress(['approval', 'queued', 'queued']));
  await page.locator('.pixel-employee.approval').waitFor();
  assert.equal(await page.locator('.pixel-station.approval').count(), 1);
  await emit(progress(['listening', 'queued', 'queued']));
  await page.locator('.pixel-employee.listening').waitFor();
  await emit(progress(['running', 'queued', 'queued'], 'paused'));
  await page.locator('.pixel-employee.working').waitFor();
  checks.push('审批与监听动作区分，暂停后在途员工继续工作');
  await emit(progress(['succeeded', 'running', 'queued']));
  await page.locator('.pixel-parcel').waitFor();
  await page.locator('.pixel-employee[data-employee-id="codex:pixel-b"]').waitFor();
  assert.equal(await page.locator('.pixel-employee').count(), 2);
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('.pixel-parcel').count(), 0);
  await emit(currentRun); await page.waitForTimeout(120);
  assert.equal(await page.locator('.pixel-parcel').count(), 0);
  checks.push('文件夹沿连线接力且重复快照不重播');
  await emit(progress(['succeeded', 'succeeded', 'running']));
  await page.waitForFunction(() => document.querySelector('[data-employee-id="opencode:pixel-a"]')?.dataset.movement === 'walk');
  assert.equal(await employeeA().getAttribute('data-node-id'), 'A3');
  assert.equal(await employeeA().getAttribute('data-palette'), paletteA);
  await settleMovement();
  checks.push('A1 → B → A3 为两个员工，A 返回新工位且外观一致');
  await fit();
  if (artifactDir) {
    await mkdir(artifactDir, { recursive: true });
    await page.screenshot({ path: path.join(artifactDir, 'pixel-running.png') });
  }
  await employeeA().click();
  assert.ok((await page.locator('.step-card.selected .step-id').innerText()).includes('A3'));
  await page.getByLabel('关闭详情', { exact: true }).click();
  const beforeZoom = await employeeA().boundingBox();
  await page.getByRole('button', { name: 'zoom in' }).click();
  await page.waitForTimeout(350);
  const afterZoom = await employeeA().boundingBox(); assert.ok(afterZoom.width > beforeZoom.width);
  checks.push('点击员工定位步骤，缩放员工与节点共享坐标');
  await emit(progress(['succeeded', 'succeeded', 'succeeded'], 'succeeded'));
  await page.reload(); await page.locator('.pixel-employee').nth(1).waitFor();
  assert.equal(await page.locator('.pixel-employee').count(), 2);
  assert.equal(await page.locator('.pixel-parcel').count(), 0);
  await settleMovement(); assert.equal(await employeeA().getAttribute('data-node-id'), 'A3');
  await page.waitForTimeout(150); assert.equal(await page.locator('.station-entering').count(), 0);
  checks.push('刷新恢复完成位置与身份，不重播工位登场和交接');
  await page.getByRole('button', { name: '像素员工', exact: true }).click();
  assert.equal(await page.locator('.pixel-station').count(), 0); assert.equal(await page.locator('.pixel-employee').count(), 0);
  await page.reload(); await page.locator('.step-card').nth(2).waitFor();
  assert.equal(await page.getByRole('button', { name: '像素员工', exact: true }).getAttribute('aria-pressed'), 'false');
  await page.getByRole('button', { name: '像素员工', exact: true }).click();
  await page.locator('.pixel-employee').nth(1).waitFor(); assert.equal(await page.locator('.pixel-parcel').count(), 0);
  checks.push('动画开关记忆，重新启用不重播历史动画');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.locator('.pixel-station.still').nth(2).waitFor();
  assert.ok(await page.locator('.pixel-employee').count() === 2);
  checks.push('系统减少动态效果保留员工与状态');
  const failed = progress(['failed', 'queued', 'queued'], 'failed');
  failed.nodes.slice(1).forEach(node => { node.state = 'failed'; node.error = '上游步骤失败，未派发'; });
  currentRun = failed; await page.evaluate(() => window.__pixelReconnect());
  await page.locator('.pixel-station.blocked').nth(1).waitFor();
  assert.equal(await page.locator('.pixel-employee').count(), 1); assert.equal(await page.locator('.pixel-employee.error').count(), 1);
  checks.push('SSE重连回读最新运行，未派发下游显示阻塞');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.getByRole('button', { name: '像素员工', exact: true }).isVisible(), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  checks.push('390px界面无横向溢出且保留员工开关');
  assert.equal(unmatchedApi, 0); assert.equal(fixtureRunPosts, 1); assert.deepEqual(errors, []);
  const report = { passed: true, mode: 'browser fixtures; no native Harness jobs or model writes', checks, fixtureRunPosts,
    realBusinessDispatches: 0, unmatchedApi, pageErrors: errors };
  if (artifactDir) await writeFile(path.join(artifactDir, 'pixel-check.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
