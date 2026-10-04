import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type KeyboardEvent } from 'react';

const defaults={left:278,right:345};
export function usePanelResize() {
  const workspace=useRef<HTMLElement>(null);
  const [widths,setWidths]=useState(()=>{try{const w=JSON.parse(localStorage.getItem('sessionweave:panels')||'null');return w&&Number.isFinite(w.left)&&Number.isFinite(w.right)?w:defaults;}catch{return defaults;}});
  const current=useRef(widths);current.current=widths;
  const drag=useRef<{side:'left'|'right';x:number;width:number}|null>(null);
  function bounds(side:'left'|'right') {
    const other=side==='left'?current.current.right:current.current.left;
    return {min:side==='left'?220:280,max:Math.max(side==='left'?220:280,Math.min(side==='left'?420:520,(workspace.current?.clientWidth||innerWidth)-other-480-16))};
  }
  function update(side:'left'|'right',value:number){const {min,max}=bounds(side);setWidths((w:typeof defaults)=>({...w,[side]:Math.round(Math.max(min,Math.min(max,value)))}));}
  useEffect(()=>{
    const resize=new ResizeObserver(()=>{
      if(!workspace.current||workspace.current.clientWidth<=1050)return;
      // Clamp both saved widths together when the viewport shrinks.
      setWidths((w:typeof defaults)=>{const available=workspace.current!.clientWidth-496;let left=Math.max(220,Math.min(420,w.left)),right=Math.max(280,Math.min(520,w.right));right=Math.min(right,available-220);left=Math.min(left,available-right);return left===w.left&&right===w.right?w:{left,right};});
    });if(workspace.current)resize.observe(workspace.current);return()=>resize.disconnect();
  },[]);
  useEffect(()=>{localStorage.setItem('sessionweave:panels',JSON.stringify(widths));},[widths]);
  function separator(side:'left'|'right') {
    const {min,max}=bounds(side);
    return <div className="panel-separator" role="separator" tabIndex={0} aria-label={side==='left'?'调整会话区宽度':'调整计划区宽度'} aria-orientation="vertical" aria-valuemin={min} aria-valuemax={max} aria-valuenow={widths[side]}
      onPointerDown={(e:PointerEvent<HTMLDivElement>)=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);drag.current={side,x:e.clientX,width:current.current[side]};e.currentTarget.classList.add('dragging');}}
      onPointerMove={(e:PointerEvent<HTMLDivElement>)=>{const d=drag.current;if(d?.side===side)update(side,d.width+(e.clientX-d.x)*(side==='left'?1:-1));}}
      onPointerUp={e=>{drag.current=null;e.currentTarget.classList.remove('dragging');}}
      onLostPointerCapture={e=>{drag.current=null;e.currentTarget.classList.remove('dragging');}}
      onDoubleClick={()=>update(side,defaults[side])}
      onKeyDown={(e:KeyboardEvent<HTMLDivElement>)=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();update(side,e.key==='Home'?min:e.key==='End'?max:current.current[side]+(e.key==='ArrowRight'?1:-1)*(side==='left'?1:-1)*(e.shiftKey?30:10));}} title="拖动调整宽度 · 双击恢复默认 · 方向键微调"><span/></div>;
  }
  return {workspace,separator,style:{'--sessions-width':`${widths.left}px`,'--plan-width':`${widths.right}px`} as CSSProperties};
}
