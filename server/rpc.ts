// Dispatcher structure adapted from Harnss shared/lib/codex-rpc.ts.
// MIT source and modifications documented in THIRD_PARTY_NOTICES.md.
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
export class CodexRpc extends EventEmitter {
  private socket?: WebSocket;
  private sequence = 0;
  private pending = new Map<number, { resolve: (x: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private connecting?: Promise<void>;
  constructor(readonly socketPath: string) { super(); }
  async connect() {
    if (this.socket?.readyState === WebSocket.OPEN) return;
    if (this.connecting) return this.connecting;
    this.connecting = this.open().finally(() => { this.connecting = undefined; });
    return this.connecting;
  }
  private async open() {
    const ws = this.socket = new WebSocket(`ws+unix:${this.socketPath}:/`);
    ws.on('message', data => {
      try {
        const m = JSON.parse(data.toString());
        if (m.id != null && !m.method) {
          const p = this.pending.get(m.id); if (!p) return;
          clearTimeout(p.timer); this.pending.delete(m.id);
          m.error ? p.reject(new Error(m.error.message || JSON.stringify(m.error))) : p.resolve(m.result);
        } else if (m.method && m.id != null) this.emit('request', m);
        else if (m.method) this.emit('notification', m);
      } catch (error) { this.emit('diagnostic', String(error)); }
    });
    const rejectAll = () => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('Codex 连接断开；投递状态需核对，未自动重发')); } this.pending.clear(); this.emit('disconnected'); };
    ws.on('close', rejectAll); ws.on('error', e => this.emit('diagnostic', e.message));
    await new Promise<void>((resolve,reject) => { const timer = setTimeout(() => { ws.close(); reject(new Error('Codex 连接超时')); }, 10000); ws.once('open', () => { clearTimeout(timer); resolve(); }); ws.once('error', e => { clearTimeout(timer); reject(e); }); });
    await this.request('initialize', { clientInfo: { name: 'sessionweave', version: '0.1.0', title: 'SessionWeave' }, capabilities: { experimentalApi: true } });
    this.notify('initialized', {});
  }
  request(method: string, params: unknown = {}, timeout = 30000): Promise<any> {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('Codex 未连接'));
    const id = ++this.sequence;
    return new Promise((resolve,reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Codex ${method} 响应超时；未自动重发`)); }, timeout);
      this.pending.set(id, { resolve,reject,timer }); this.socket!.send(JSON.stringify({ id, method, params }));
    });
  }
  notify(method: string, params: unknown) { this.socket?.send(JSON.stringify({ method, params })); }
  respond(id: string | number, result: unknown) { this.socket?.send(JSON.stringify({ id, result })); }
  close() { this.socket?.close(); } // Disconnect this client only; never kill the shared daemon.
}
