import type { VADVector } from './engine';
import { emotionCatalog } from './emotions';
export type Plane='va'|'vd'|'ad';
export const planeAxes:Record<Plane,{x:keyof VADVector;y:keyof VADVector;xLabel:string;yLabel:string;left:string;right:string;top:string;bottom:string;quadrants:string[]}>= {
  va:{x:'valence',y:'arousal',xLabel:'V',yLabel:'A',left:'消极',right:'愉悦',top:'唤醒 ↑',bottom:'↓ 舒缓',quadrants:['紧张','兴奋','低落','安心']},
  vd:{x:'valence',y:'dominance',xLabel:'V',yLabel:'D',left:'消极',right:'愉悦',top:'主导 ↑',bottom:'↓ 退让',quadrants:['强势不满','自信愉悦','退缩低落','羞涩亲近']},
  ad:{x:'arousal',y:'dominance',xLabel:'A',yLabel:'D',left:'舒缓',right:'激动',top:'主导 ↑',bottom:'↓ 退让',quadrants:['沉稳主导','高能主导','疲惫退让','紧张退缩']},
};
export function planePosition(v:VADVector,plane:Plane){const p=planeAxes[plane];return {x:(v[p.x]+1)/2,y:(1-v[p.y])/2};}
export function editPlane(v:VADVector,plane:Plane,x:number,y:number):VADVector{const p=planeAxes[plane];return {...v,[p.x]:Math.max(-1,Math.min(1,x*2-1)),[p.y]:Math.max(-1,Math.min(1,1-y*2))};}
/** Orthographic 3D projection. All three coordinates contribute, including dominance. */
export function projectVAD(v:VADVector,yaw=.65,pitch=.35){const x=v.valence*Math.cos(yaw)+v.dominance*Math.sin(yaw),z=-v.valence*Math.sin(yaw)+v.dominance*Math.cos(yaw);return {x,y:v.arousal*Math.cos(pitch)-z*Math.sin(pitch),depth:v.arousal*Math.sin(pitch)+z*Math.cos(pitch)};}
export class EmotionSpace {
  private yaw=.65;private pitch=.35;private current:VADVector={valence:0,arousal:0,dominance:0};private target:VADVector={...this.current};private dragging:{x:number;y:number}|null=null;
  constructor(private canvas:HTMLCanvasElement){
    canvas.onpointerdown=e=>{this.dragging={x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);};
    canvas.onpointermove=e=>{if(this.dragging){this.yaw+=(e.clientX-this.dragging.x)*.01;this.pitch=Math.max(-1.1,Math.min(1.1,this.pitch+(e.clientY-this.dragging.y)*.008));this.dragging={x:e.clientX,y:e.clientY};this.draw();}};
    canvas.onpointerup=()=>this.dragging=null;canvas.onpointercancel=()=>this.dragging=null;
    canvas.onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();this.yaw+=e.key==='ArrowRight'?.1:-.1;this.draw();}if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();this.pitch=Math.max(-1.1,Math.min(1.1,this.pitch+(e.key==='ArrowUp'?.1:-.1)));this.draw();}if(e.key==='Home')this.reset();};
    new ResizeObserver(()=>this.draw()).observe(canvas);
  }
  reset(){this.yaw=.65;this.pitch=.35;this.draw();}
  update(current:VADVector,target:VADVector){this.current=current;this.target=target;this.canvas.setAttribute('aria-label',`三维 VAD：V ${current.valence.toFixed(2)}，A ${current.arousal.toFixed(2)}，D ${current.dominance.toFixed(2)}。拖动或方向键旋转视角。`);this.draw();}
  private draw(){const ctx=this.canvas.getContext('2d');if(!ctx)return;const width=this.canvas.clientWidth,height=this.canvas.clientHeight;if(!width||!height)return;const ratio=Math.min(window.devicePixelRatio||1,2);this.canvas.width=Math.round(width*ratio);this.canvas.height=Math.round(height*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);ctx.clearRect(0,0,width,height);const scale=Math.min(width*.23,height*.28);const point=(v:VADVector)=>{const p=projectVAD(v,this.yaw,this.pitch);return {x:width/2+p.x*scale,y:height/2-p.y*scale,depth:p.depth};};
    const line=(a:VADVector,b:VADVector,color:string,dashed=false)=>{const pa=point(a),pb=point(b);ctx.strokeStyle=color;ctx.lineWidth=1;ctx.setLineDash(dashed?[3,3]:[]);ctx.beginPath();ctx.moveTo(pa.x,pa.y);ctx.lineTo(pb.x,pb.y);ctx.stroke();ctx.setLineDash([]);};
    const corners:VADVector[]=[];for(const v of [-1,1])for(const a of [-1,1])for(const d of [-1,1])corners.push({valence:v,arousal:a,dominance:d});for(const a of corners)for(const b of corners)if(['valence','arousal','dominance'].filter(k=>a[k as keyof VADVector]!==b[k as keyof VADVector]).length===1)line(a,b,'#dfd6e8');
    const zero={valence:0,arousal:0,dominance:0};
    for(const [key,label,color] of [['valence','V · 愉悦','#9673c2'],['arousal','A · 唤醒','#ce9472'],['dominance','D · 支配','#71a79b']] as const){const a={...zero,[key]:-1.2},b={...zero,[key]:1.3};line(a,b,color);ctx.fillStyle=color;ctx.font='10px sans-serif';const p=point(b);ctx.fillText(label,p.x+3,p.y-4);const n=point(a);ctx.font='8px monospace';ctx.fillText('−1',n.x-8,n.y+11);}
    const anchors=emotionCatalog.filter(e=>e.name!=='neutral').map(e=>({preset:e,...point(e.vad)})).sort((a,b)=>a.depth-b.depth);for(const p of anchors){ctx.fillStyle='#bcaacc65';ctx.beginPath();ctx.arc(p.x,p.y,2,0,Math.PI*2);ctx.fill();}
    for(const v of [this.target,this.current]){line(v,{...v,arousal:0},'#b9a2ce88',true);line({...v,arousal:0},{valence:0,arousal:0,dominance:v.dominance},'#87afa377',true);}
    const target=point(this.target),current=point(this.current);line(this.current,this.target,'#bea7d4',true);ctx.strokeStyle='#9571c3';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(target.x,target.y,6,0,Math.PI*2);ctx.stroke();ctx.fillStyle='#8b66b7';ctx.beginPath();ctx.arc(current.x,current.y,4.5,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#fff';ctx.lineWidth=2;ctx.stroke();ctx.fillStyle='#9c87af';ctx.font='8px sans-serif';ctx.fillText('拖动旋转 · Home 复位',12,height-12);
  }
}
