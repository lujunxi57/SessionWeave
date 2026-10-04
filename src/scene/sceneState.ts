import type { Conversation, NodeRun, Step, Workflow, WorkflowRun } from '../../shared/types';

export type StationState = 'ready' | NodeRun['state'] | 'blocked';
export type EmployeeAction = 'idle' | 'working' | 'listening' | 'approval' | 'done' | 'error';
export interface Point { x: number; y: number }
export interface Employee {
  id: string; name: string; harness: Conversation['harness']; palette: number;
  nodeId: string; action: EmployeeAction; position: Point;
}
export interface Station { id: string; state: StationState; position: Point }
export interface Delivery { id: string; source: string; target: string; from: Point; to: Point }
export interface SceneSnapshot { runId?: string; employees: Employee[]; stations: Station[]; deliveries: Delivery[] }
export type SceneEvent = { type: 'spawn' | 'celebrate'; employeeId: string } | { type: 'deliver'; delivery: Delivery };
export type Dimensions = Record<string, { width: number; height: number }>;

export const employeeId = (ref: Step['conversationRef']) => `${ref.harness}:${ref.id}`;
export function paletteFor(id: string): number {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return (hash >>> 0) % 6;
}

// A failed downstream that was never dispatched must not look like a failed worker.
export function stationState(node?: NodeRun): StationState {
  if (!node) return 'ready';
  if (node.state === 'failed' && !node.startedAt && !node.nativeTurnOrMessageId) return 'blocked';
  return node.state;
}
function hasEmployee(node: NodeRun): boolean {
  if (['running', 'listening', 'approval', 'succeeded'].includes(node.state)) return true;
  return node.state === 'failed' && stationState(node) !== 'blocked'
    && !!(node.nativeTurnOrMessageId || node.actualSentPrompt);
}
function actionFor(node: NodeRun): EmployeeAction {
  const actions: Record<NodeRun['state'], EmployeeAction> = {
    queued: 'idle', polishing: 'idle', running: 'working', listening: 'listening', approval: 'approval', succeeded: 'done', failed: 'error',
  };
  return actions[node.state];
}
const active = (node: NodeRun) => ['running', 'listening', 'approval'].includes(node.state);

export function buildScene(workflow: Workflow, run: WorkflowRun | undefined, sessions: Conversation[], dimensions: Dimensions): SceneSnapshot {
  const current = run?.workflow.id === workflow.id ? run : undefined;
  const records = new Map(current?.nodes.map(node => [node.nodeId, node]));
  const stations = workflow.nodes.map(step => ({
    id: step.id, state: stationState(records.get(step.id)),
    // Employees anchor to the station chair, above the card's footer.
    position: { x: step.position.x + (dimensions[step.id]?.width || 290) / 2 - 7,
      y: step.position.y + (dimensions[step.id]?.height || 365) - 103 },
  }));
  const stationById = new Map(stations.map(station => [station.id, station]));
  const choices = new Map<string, { step: Step; node: NodeRun }>();
  for (const step of workflow.nodes) {
    const node = records.get(step.id);
    if (!node || !hasEmployee(node)) continue;
    const id = employeeId(step.conversationRef), prior = choices.get(id);
    const stamp = (n: NodeRun) => n.startedAt || n.completedAt || 0;
    if (!prior || (active(node) && !active(prior.node))
      || (active(node) === active(prior.node) && stamp(node) >= stamp(prior.node))) choices.set(id, { step, node });
  }
  const employees = [...choices].map(([id, { step, node }]) => ({
    id, name: sessions.find(session => employeeId(session) === id)?.title || step.conversationRef.id.slice(0, 12),
    harness: step.conversationRef.harness, palette: paletteFor(id), nodeId: step.id,
    action: actionFor(node), position: stationById.get(step.id)!.position,
  }));
  const deliveries = workflow.edges.flatMap(edge => {
    const source = records.get(edge.source), target = records.get(edge.target);
    if (source?.state !== 'succeeded' || stationState(target) === 'blocked') return [];
    const from = workflow.nodes.find(step => step.id === edge.source), to = workflow.nodes.find(step => step.id === edge.target);
    if (!from || !to) return [];
    return [{ id: `${current!.id}:${edge.id}:${source.nativeTurnOrMessageId || source.id}`,
      source: edge.source, target: edge.target,
      from: { x: from.position.x + (dimensions[from.id]?.width || 290), y: from.position.y + (dimensions[from.id]?.height || 365) / 2 },
      to: { x: to.position.x, y: to.position.y + (dimensions[to.id]?.height || 365) / 2 } }];
  });
  return { runId: current?.id, stations, employees, deliveries };
}

// Restore a baseline without replaying entrance/celebration/delivery after refresh,
// toggling animation, or changing to a previously completed run.
export class SceneTransitions {
  private previous?: SceneSnapshot;
  private seenDeliveries = new Set<string>();
  update(next: SceneSnapshot, live = true): SceneEvent[] {
    const prev = this.previous;
    this.previous = next;
    const events: SceneEvent[] = [];
    if (!prev || !live) {
      next.deliveries.forEach(delivery => this.seenDeliveries.add(delivery.id));
      return events;
    }
    const previousEmployees = new Map(prev.employees.map(employee => [employee.id, employee]));
    for (const employee of next.employees) {
      const old = previousEmployees.get(employee.id);
      if (!old && !['done', 'error'].includes(employee.action)) events.push({ type: 'spawn', employeeId: employee.id });
      if (employee.action === 'done' && (old?.action !== 'done' || old.nodeId !== employee.nodeId || prev.runId !== next.runId))
        events.push({ type: 'celebrate', employeeId: employee.id });
    }
    for (const delivery of next.deliveries) {
      if (!this.seenDeliveries.has(delivery.id)) events.push({ type: 'deliver', delivery });
      this.seenDeliveries.add(delivery.id);
    }
    return events;
  }
}

export function travelPath(from: Point, to: Point): Point[] {
  // Walk out below the desk, across the aisle, then back to the new desk.
  const aisle = Math.max(from.y, to.y) + 125;
  return [{ x: from.x, y: aisle }, { x: to.x, y: aisle }, to];
}
export function advanceAlong(position: Point, path: Point[], distance: number): Point {
  let point = { ...position };
  while (path.length) {
    const target = path[0], dx = target.x - point.x, dy = target.y - point.y, length = Math.hypot(dx, dy);
    if (length <= distance) { point = { ...target }; path.shift(); distance -= length; }
    else { point.x += dx / length * distance; point.y += dy / length * distance; break; }
  }
  return point;
}
