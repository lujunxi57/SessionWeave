import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Conversation, NodeRun, Workflow, WorkflowRun } from '../shared/types';
import { advanceAlong, buildScene, SceneTransitions, travelPath } from '../src/scene/sceneState';

const sessions: Conversation[] = [
  { id: 'a', harness: 'opencode', title: '开发 A', preview: '', cwd: '/tmp', updatedAt: 1, state: 'idle' },
  { id: 'b', harness: 'codex', title: '评审 B', preview: '', cwd: '/tmp', updatedAt: 1, state: 'idle' },
];
const workflow: Workflow = {
  id: 'office', name: 'A → B → A',
  nodes: ['A1', 'B', 'A3'].map((id, i) => ({ id, conversationRef: sessions[i === 1 ? 1 : 0], purpose: id,
    position: { x: i * 350, y: 100 }, mode: 'kickoff', promptTemplate: '', selectedSkills: [], selectedFiles: [],
    upstreamOutputRefs: i ? [i === 1 ? 'A1' : 'B'] : [], polishBeforeSend: false })),
  edges: [{ id: 'ab', source: 'A1', target: 'B' }, { id: 'ba', source: 'B', target: 'A3' }],
};
function run(states: NodeRun['state'][]): WorkflowRun {
  return { id: 'r', workflow, state: 'running', createdAt: 10,
    nodes: states.map((state, i) => ({ id: `nr${i}`, nodeId: workflow.nodes[i].id, state, inputTemplate: '',
      ...(state !== 'queued' ? { startedAt: 20 + i, nativeTurnOrMessageId: `turn${i}` } : {}) })) };
}
const scene = (r?: WorkflowRun) => buildScene(workflow, r, sessions, {});

test('A → B → A creates three stations and two identities; active A3 relocates the original A', () => {
  const before = scene(run(['running', 'queued', 'queued']));
  assert.equal(before.stations.length, 3); assert.equal(before.employees.length, 1);
  const after = scene(run(['succeeded', 'succeeded', 'running']));
  assert.equal(after.employees.length, 2);
  const a = after.employees.find(employee => employee.id === 'opencode:a')!;
  assert.equal(a.nodeId, 'A3'); assert.equal(a.action, 'working');
  assert.equal(a.palette, before.employees[0].palette); assert.ok(a.position.x > before.employees[0].position.x);
});
test('queued and polishing nodes do not create working employees; listening and approval remain distinct', () => {
  assert.equal(scene().employees.length, 0);
  assert.equal(scene(run(['polishing', 'queued', 'queued'])).employees.length, 0);
  assert.equal(scene(run(['listening', 'queued', 'queued'])).employees[0].action, 'listening');
  assert.equal(scene(run(['approval', 'queued', 'queued'])).employees[0].action, 'approval');
  const paused = run(['running', 'queued', 'queued']); paused.state = 'paused';
  assert.equal(scene(paused).employees[0].action, 'working');
});
test('a failed upstream leaves undispatched downstream workstations blocked and without workers', () => {
  const r = run(['failed', 'queued', 'queued']); r.state = 'failed';
  r.nodes.slice(1).forEach(node => { node.state = 'failed'; node.error = '上游步骤失败，未派发'; node.completedAt = 30; });
  const result = scene(r);
  assert.equal(result.employees.length, 1); assert.equal(result.employees[0].action, 'error');
  assert.deepEqual(result.stations.map(station => station.state), ['failed', 'blocked', 'blocked']);
  assert.equal(result.deliveries.length, 0);
});
test('refresh restores a baseline; duplicate snapshots do not replay delivery or celebration', () => {
  const completed = scene(run(['succeeded', 'succeeded', 'succeeded']));
  const restored = new SceneTransitions(); assert.deepEqual(restored.update(completed), []);
  assert.deepEqual(restored.update(completed), []);
  const live = new SceneTransitions(); live.update(scene(run(['queued', 'queued', 'queued'])));
  const entered = scene(run(['running', 'queued', 'queued']));
  assert.deepEqual(live.update(entered), [{ type: 'spawn', employeeId: 'opencode:a' }]);
  assert.deepEqual(live.update(entered), []);
  const next = scene(run(['succeeded', 'running', 'queued']));
  const events = live.update(next);
  assert.equal(events.filter(event => event.type === 'deliver').length, 1);
  assert.ok(events.some(event => event.type === 'celebrate' && event.employeeId === 'opencode:a'));
  assert.deepEqual(live.update(next), []);
  assert.deepEqual(live.update(completed, false), []);
});
test('an unrelated workflow cannot leak historical employees; delivery endpoints match measured node handles', () => {
  const r = run(['succeeded', 'running', 'queued']);
  const unrelated = { ...r, workflow: { ...workflow, id: 'another' } };
  assert.equal(scene(unrelated).employees.length, 0);
  const measured = buildScene(workflow, r, sessions, { A1: { width: 300, height: 400 }, B: { width: 280, height: 360 } });
  assert.deepEqual(measured.deliveries[0].from, { x: 300, y: 300 });
  assert.deepEqual(measured.deliveries[0].to, { x: 350, y: 280 });
});
test('walking consumes waypoints, handles zero length segments, and stops exactly at the destination', () => {
  const from = { x: 10, y: 20 }, to = { x: 310, y: 20 };
  const path = travelPath(from, to); path.unshift(from);
  const halfway = advanceAlong(from, path, 150); assert.deepEqual(halfway, { x: 35, y: 145 });
  assert.deepEqual(advanceAlong(halfway, path, 1000), to); assert.deepEqual(path, []);
});
