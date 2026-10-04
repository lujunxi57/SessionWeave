import { useEffect, useState, type CSSProperties } from 'react';
import type { StationState } from './sceneState';
export const stationLabels: Record<StationState, string> = {
  ready: '工位就绪', queued: '等待派发', listening: '监听原客户端', polishing: '整理接力文件',
  running: '正在工作', approval: '等待审批', succeeded: '任务完成', failed: '执行失败', blocked: '上游阻塞',
};

export default function Station({ state, entranceAt, motion }: { state: StationState; entranceAt?: number; motion: boolean }) {
  const [entering, setEntering] = useState(() => !!entranceAt && Date.now() - entranceAt < 1000);
  const [delay, setDelay] = useState(() => Math.max(0, (entranceAt || 0) - Date.now()) / 1000);
  useEffect(() => {
    if (!entranceAt || Date.now() - entranceAt >= 1000) return;
    setDelay(Math.max(0, entranceAt - Date.now()) / 1000);
    setEntering(true);
    const timer = setTimeout(() => setEntering(false), Math.max(0, 1000 - (Date.now() - entranceAt)));
    return () => clearTimeout(timer);
  }, [entranceAt]);
  return <div className={`pixel-station ${state} ${entering && motion ? 'station-entering' : ''} ${motion ? '' : 'still'}`} style={{ '--deploy-delay': `${delay}s` } as CSSProperties} data-station-state={state} aria-label={`工位：${stationLabels[state]}`}>
    <div className="station-floor"/>
    <div className="station-projection"/>
    <svg className="station-art" viewBox="0 0 104 62" width="208" height="124" aria-hidden="true" shapeRendering="crispEdges">
      <ellipse cx="52" cy="52" rx="43" ry="5" fill="#243a3014"/>
      <g className="station-desk">
        <path d="M18 28h68v7H18z" fill="#607969"/><path d="M18 26h68v6H18z" fill="#bbc4a5"/>
        <path d="M22 35h4v16h-4zm54 0h4v16h-4z" fill="#607969"/>
        <path d="M28 35h44v3H28z" fill="#8e9e85"/>
      </g>
      <g className="station-monitor">
        <path d="M41 3h26v20H41z" fill="#243a30"/><path d="M43 5h22v15H43z" fill="#e0e7d4"/>
        <path d="M52 23h4v3h-4zm-4 3h12v2H48z" fill="#52665a"/>
        <g className="station-code" fill="#427d60"><path d="M46 8h11v2H46zm0 4h16v2H46zm0 4h7v2H46z"/></g>
        <path className="station-light" d="M62 21h2v1h-2z" fill="currentColor"/>
      </g>
      <g className="station-props">
        <path d="M70 19h6v7h-6z" fill="#fffdf4"/><path d="M76 20h2v4h-2z" fill="#a6b59d"/>
        <path d="M25 17h7v10h-7z" fill="#82620e"/><path d="M26 18h5v7h-5z" fill="#d3c59b"/>
        <path d="M38 29h28v2H38z" fill="#fffdf4"/>
      </g>
      <g className="station-chair"><path d="M45 39h14v6H45z" fill="#93a589"/><path d="M47 45h10v3H47z" fill="#607969"/><path d="M51 48h2v7h-2zm-6 6h14v2H45z" fill="#52665a"/></g>
    </svg>
    <div className="station-dust"><i/><i/><i/><i/><i/><i/></div>
    <span className="station-caption"><i/>{stationLabels[state]}</span>
  </div>;
}
