import { useEffect, useMemo, useRef, useState } from 'react';
import { getBezierPath, Position, ViewportPortal, useViewport } from '@xyflow/react';
import type { Conversation, Workflow, WorkflowRun } from '../../shared/types';
import { advanceAlong, buildScene, SceneTransitions, travelPath, type Delivery, type Dimensions, type Employee, type Point } from './sceneState';
import { loadFrames, SCALE, spriteFrame, SPRITE_H, SPRITE_W, type Direction } from './sprites';
import { drawSpawn, SPAWN_DURATION } from './matrixEffect';
import './scene.css';

const actionLabels = { idle: '待机', working: '工作中', listening: '监听中', approval: '待审批', done: '已完成', error: '执行失败' };
interface Actor {
  employee: Employee; position: Point; path: Point[]; direction: Direction;
  spawn: number; celebrate: number; seeds: number[];
}
interface Parcel { delivery: Delivery; elapsed: number; path: SVGPathElement; length: number }
const PARCEL_SECONDS = 1.15;

export function usePixelPreferences() {
  const [enabled, setEnabled] = useState(() => {
    try { return localStorage.getItem('sessionweave.pixel-employees') !== 'off'; } catch { return true; }
  });
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => setReduced(query.matches);
    query.addEventListener('change', changed);
    return () => query.removeEventListener('change', changed);
  }, []);
  function toggle() {
    setEnabled(old => {
      try { localStorage.setItem('sessionweave.pixel-employees', old ? 'off' : 'on'); } catch { /* preference can remain in memory */ }
      return !old;
    });
  }
  return { enabled, motion: enabled && !reduced, reduced, toggle };
}

export default function EmployeeLayer({ workflow, run, sessions, dimensions, motion, onSelect }: {
  workflow: Workflow; run?: WorkflowRun; sessions: Conversation[]; dimensions: Dimensions;
  motion: boolean; onSelect: (id: string) => void;
}) {
  const snapshot = useMemo(() => buildScene(workflow, run, sessions, dimensions), [workflow, run, sessions, dimensions]);
  const { zoom } = useViewport();
  const actors = useRef(new Map<string, Actor>());
  const elements = useRef(new Map<string, HTMLButtonElement>());
  const canvases = useRef(new Map<string, HTMLCanvasElement>());
  const tracker = useRef(new SceneTransitions());
  const parcelActors = useRef(new Map<string, Parcel>());
  const parcelElements = useRef(new Map<string, HTMLDivElement>());
  const [parcels, setParcels] = useState<Delivery[]>([]);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const [assetRevision, setAssetRevision] = useState(0);
  const initialRun = useRef(run?.id);
  const mountedAt = useRef(Date.now());
  const renderNow = useRef<() => void>(() => {});

  useEffect(() => {
    let valid = true;
    const palettes = [...new Set(snapshot.employees.map(employee => employee.palette))];
    void Promise.all(palettes.map(palette => loadFrames(palette).catch(() => {
      if (valid) setLoadErrors(old => [...new Set([...old, String(palette)])]);
    }))).then(() => { if (valid) setAssetRevision(old => old + 1); });
    return () => { valid = false; };
  }, [snapshot.employees.map(employee => employee.palette).sort().join(',')]);

  useEffect(() => {
    const present = new Set(snapshot.employees.map(employee => employee.id));
    for (const id of actors.current.keys()) if (!present.has(id)) actors.current.delete(id);
    for (const employee of snapshot.employees) {
      const actor = actors.current.get(employee.id);
      if (!actor) actors.current.set(employee.id, {
        employee, position: { ...employee.position }, path: [], direction: 'down',
        spawn: -1, celebrate: 0, seeds: Array.from({ length: SPRITE_W }, () => Math.random()),
      });
      else {
        if (actor.employee.nodeId !== employee.nodeId) {
          actor.path = motion ? travelPath(actor.position, employee.position) : [];
          if (!motion) actor.position = { ...employee.position };
        } else if (actor.employee.position.x !== employee.position.x || actor.employee.position.y !== employee.position.y) {
          actor.position.x += employee.position.x - actor.employee.position.x;
          actor.position.y += employee.position.y - actor.employee.position.y;
          if (actor.path.length) actor.path = travelPath(actor.position, employee.position);
        }
        actor.employee = employee;
      }
      const current = actors.current.get(employee.id)!;
      if (employee.action === 'done' || employee.action === 'error') {
        current.spawn = -1; current.path = []; current.position = { ...employee.position };
      }
    }
    // Never animate historical snapshots loaded after mount, even if first API
    // responses arrive separately. A live existing run can animate later changes.
    const live = !run || run.id === initialRun.current || run.createdAt >= mountedAt.current;
    const events = tracker.current.update(snapshot, live);
    for (const event of events) {
      if (!motion || document.hidden) continue;
      if (event.type === 'deliver') {
        const { from, to } = event.delivery;
        const [d] = getBezierPath({ sourceX: from.x, sourceY: from.y, sourcePosition: Position.Right, targetX: to.x, targetY: to.y, targetPosition: Position.Left });
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d);
        parcelActors.current.set(event.delivery.id, { delivery: event.delivery, elapsed: 0, path, length: path.getTotalLength() });
        setParcels(old => [...old.filter(parcel => parcel.id !== event.delivery.id), event.delivery]);
      } else {
        const actor = actors.current.get(event.employeeId);
        if (!actor) continue;
        if (event.type === 'spawn') {
          actor.spawn = 0;
          actor.position = { x: actor.employee.position.x - 42, y: actor.employee.position.y + 55 };
          actor.path = [actor.employee.position];
        } else {
          actor.celebrate = .85;
          // Completion takes priority over an unfinished entrance or walk.
          actor.spawn = -1;
          actor.path = [];
          actor.position = { ...actor.employee.position };
        }
      }
    }
    if (!motion || document.hidden) {
      parcelActors.current.clear(); setParcels(old => old.length ? [] : old);
      for (const actor of actors.current.values()) {
        actor.spawn = -1; actor.celebrate = 0; actor.path = []; actor.position = { ...actor.employee.position };
      }
    }
    renderNow.current();
  }, [snapshot, motion, run]);

  useEffect(() => {
    let request = 0, last = 0, clock = 0;
    function draw(dt = 0) {
      clock += dt;
      for (const [id, actor] of actors.current) {
        const element = elements.current.get(id), canvas = canvases.current.get(id);
        if (!element || !canvas) continue;
        const previous = { ...actor.position };
        if (motion && actor.spawn >= 0) { actor.spawn += dt; if (actor.spawn >= SPAWN_DURATION) actor.spawn = -1; }
        else if (motion && actor.path.length) {
          actor.position = advanceAlong(actor.position, actor.path, dt * 230);
          const dx = actor.position.x - previous.x, dy = actor.position.y - previous.y;
          actor.direction = Math.abs(dx) > Math.abs(dy) ? dx < 0 ? 'left' : 'right' : dy < 0 ? 'up' : 'down';
        }
        const walking = motion && actor.path.length > 0 && actor.spawn < 0;
        if (!walking) actor.direction = 'down';
        actor.celebrate = Math.max(0, actor.celebrate - dt);
        const bounce = motion && actor.celebrate > 0 ? Math.abs(Math.sin(actor.celebrate * Math.PI * 5)) * 7 : 0;
        element.style.transform = `translate(${actor.position.x - SPRITE_W * SCALE / 2}px, ${actor.position.y - SPRITE_H * SCALE - bounce}px)`;
        element.dataset.movement = actor.spawn >= 0 ? 'spawn' : walking ? 'walk' : actor.employee.action;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.imageSmoothingEnabled = false;
        const sprite = spriteFrame(actor.employee.palette, actor.employee.action, walking, actor.direction, motion ? clock : 0);
        if (sprite) {
          if (actor.spawn >= 0 && motion) drawSpawn(ctx, sprite, actor.spawn, actor.seeds);
          else ctx.drawImage(sprite, 0, 0, canvas.width, canvas.height);
        }
      }
      const finished: string[] = [];
      for (const [id, parcel] of parcelActors.current) {
        parcel.elapsed += dt;
        const t = Math.min(1, parcel.elapsed / PARCEL_SECONDS);
        const point = parcel.path.getPointAtLength(parcel.length * t);
        const element = parcelElements.current.get(id);
        if (element) element.style.transform = `translate(${point.x - 14}px, ${point.y - 12}px)`;
        if (t >= 1) { parcelActors.current.delete(id); finished.push(id); }
      }
      if (finished.length) setParcels(old => old.filter(parcel => !finished.includes(parcel.id)));
    }
    renderNow.current = () => draw();
    function tick(now: number) {
      if (last && now - last < 1000 / 30) { request = requestAnimationFrame(tick); return; }
      const dt = last ? Math.min(.08, (now - last) / 1000) : 0; last = now;
      draw(dt); request = requestAnimationFrame(tick);
    }
    function visibility() {
      cancelAnimationFrame(request); last = 0;
      // Do not catch up or replay animations that happened in a hidden tab.
      if (document.hidden) {
        parcelActors.current.clear(); setParcels(old => old.length ? [] : old);
        for (const actor of actors.current.values()) { actor.spawn = -1; actor.celebrate = 0; actor.path = []; actor.position = { ...actor.employee.position }; }
      } else if (motion) request = requestAnimationFrame(tick);
      else draw();
    }
    draw(); if (motion && !document.hidden) request = requestAnimationFrame(tick);
    document.addEventListener('visibilitychange', visibility);
    return () => { cancelAnimationFrame(request); document.removeEventListener('visibilitychange', visibility); renderNow.current = () => {}; };
  }, [motion, assetRevision]);

  return <ViewportPortal>
    <div className={`employee-layer ${zoom < .6 ? 'far-away' : ''}`} aria-label="会话员工" style={{ pointerEvents: 'none' }}>
      {snapshot.employees.map(employee => <button key={employee.id}
        ref={element => { if (element) elements.current.set(employee.id, element); else elements.current.delete(employee.id); }}
        className={`pixel-employee ${employee.action} nodrag nopan`} data-employee-id={employee.id} data-node-id={employee.nodeId}
        data-palette={employee.palette} data-action={employee.action}
        aria-label={`${employee.name} · ${actionLabels[employee.action]} · ${employee.nodeId}`}
        title={`${employee.harness === 'codex' ? 'Codex' : 'OpenCode'} · ${employee.name} · ${actionLabels[employee.action]}`}
        onClick={event => { event.stopPropagation(); onSelect(employee.nodeId); }}>
        <span className="employee-shadow"/>
        <canvas ref={canvas => { if (canvas) canvases.current.set(employee.id, canvas); else canvases.current.delete(employee.id); }}
          width={SPRITE_W * SCALE} height={SPRITE_H * SCALE} aria-hidden="true"/>
        {loadErrors.includes(String(employee.palette)) && <span className="employee-fallback">{employee.harness === 'codex' ? 'CX' : 'OC'}</span>}
        <span className="employee-bubble" aria-hidden="true">{employee.action === 'approval' ? '!' : employee.action === 'error' ? '×' : employee.action === 'done' ? '✓' : employee.action === 'listening' ? '◉' : '···'}</span>
        <span className="employee-name">{employee.harness === 'codex' ? 'CX' : 'OC'} · {employee.nodeId}</span>
      </button>)}
      {parcels.map(parcel => <div className="pixel-parcel" data-delivery-id={parcel.id} key={parcel.id}
        ref={element => { if (element) parcelElements.current.set(parcel.id, element); else parcelElements.current.delete(parcel.id); }} aria-hidden="true">
        <svg width="28" height="24" viewBox="0 0 14 12" shapeRendering="crispEdges"><path d="M1 2h5v2h7v7H1z" fill="#82620e"/><path d="M2 4h10v6H2z" fill="#d6c48b"/><path d="M4 1h6v7H4z" fill="#fffdf4"/><path d="M5 3h4v1H5zm0 2h3v1H5z" fill="#607969"/></svg>
      </div>)}
    </div>
  </ViewportPortal>;
}
