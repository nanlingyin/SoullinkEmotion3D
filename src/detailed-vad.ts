import { VADExpressionMapper } from '../vendor/soullink/emotion/VADExpressionMapper';
import { ActionUnitSolver } from '../vendor/soullink/expression/ActionUnitSolver';
import { createDefaultActionUnitState } from '../vendor/soullink/facs/defaultActionUnitState';
import { actionUnitDefinitions, type FACSActionUnitState } from '../vendor/soullink/facs/FACSActionUnitState';
import type { VADVector } from '../vendor/soullink/emotion/VADState';
import { emotionCatalog, emotionByName } from './emotions';

const clamp=(v:number,min=0,max=1)=>Math.min(max,Math.max(min,Number.isFinite(v)?v:0));
const magnitude=(v:VADVector)=>Math.hypot(v.valence,v.arousal*.85,v.dominance*.7);
const distance=(a:VADVector,b:VADVector)=>(a.valence-b.valence)**2*1.1+(a.arousal-b.arousal)**2*.95+(a.dominance-b.dominance)**2*1.35;
export interface EmotionContribution {name:string;label:string;weight:number}
export interface DetailState { blend:EmotionContribution[]; dominant:string; eyelidRelaxation:number; regions:{brow:number;eyes:number;mouth:number}; sourceStrength:number }
export interface MappingSettings {gain:number;detailMix:number;browGain:number;eyeGain:number;mouthGain:number}

export class DetailedVADMapper {
  private original = new VADExpressionMapper();
  private solver = new ActionUnitSolver();
  map(input:VADVector, settings:MappingSettings, intent?:{name:string;strength:number}):{aus:FACSActionUnitState;details:DetailState} {
    const vad={valence:clamp(input.valence,-1,1),arousal:clamp(input.arousal,-1,1),dominance:clamp(input.dominance,-1,1)};
    const p=Math.max(0,vad.valence),n=Math.max(0,-vad.valence),a=Math.max(0,vad.arousal),c=Math.max(0,-vad.arousal),d=Math.max(0,vad.dominance),s=Math.max(0,-vad.dominance);
    const activation=1-Math.exp(-magnitude(vad)*2.5);
    // Smooth radial interpolation has no nearest-emotion boundaries. D is a full third coordinate.
    const scores=emotionCatalog.filter(p=>p.name!=='neutral').map(p=>({preset:p,score:Math.exp(-distance(vad,p.vad)/(2*.24**2))}));
    const sum=scores.reduce((v,x)=>v+x.score,0)||1;
    const prototype=createDefaultActionUnitState({breath:0});
    for(const {preset,score} of scores)for(const [key,value] of Object.entries(preset.au))prototype[key as keyof FACSActionUnitState]+=(value??0)*score/sum;
    // Related emotional intents keep their own authored style even when VAD coordinates are close.
    const style=emotionByName.get(intent?.name??'');
    const residue=style?clamp(intent?.strength??0)*.48:0;
    if(style)for(const definition of actionUnitDefinitions)prototype[definition.key]=prototype[definition.key]*(1-residue)+(style.au[definition.key]??0)*residue;
    // Retain Soullink's continuous base map without the discrete archetype switch.
    const base=this.solver.project(this.original.toFACS(vad,1,{dominantEmotion:'neutral'}));
    const rules:FACSActionUnitState={...createDefaultActionUnitState({breath:0}),...base,
      au01InnerBrowRaiser:.28*n*(.4+.6*s)+.12*s*(.3+.7*a),
      au02OuterBrowRaiser:.3*a*(.4+.6*p)+.21*n*a*s,
      au04BrowLowerer:.65*n*d+.1*n*a*(1-s),
      au05UpperLidRaiser:.27*a+.23*n*a*s,
      au06CheekRaiser:.28*p*(.55+.45*c),
      au07LidTightener:.38*n*d+.1*c,
      au12LipCornerPuller:.5*p*(.55+.45*Math.max(a,c)),
      au14Dimpler:.2*p*d,
      au15LipCornerDepressor:.32*n*(.4+.6*Math.max(c,s)),
      au17ChinRaiser:.16*n*s,
      au20LipStretcher:.3*n*a*s,
      au23LipTightener:.32*n*d+.07*d,
      au24LipPressor:.24*n*(d+.5*a),
      au25LipsPart:.05*a,
      au26JawDrop:.05*a*(.4+.6*s),
      gazeY:-.1*s+.035*d,
      headY:-.065*s+.065*d,
      headZ:-.03*p*s,
    };
    const mix=clamp(settings.detailMix);
    const aus=createDefaultActionUnitState();
    for(const definition of actionUnitDefinitions){
      const key=definition.key;if(key==='breath')continue;
      const region=definition.group==='brow'?settings.browGain:definition.group==='eye'?settings.eyeGain:definition.group==='mouth'||definition.group==='midface'?settings.mouthGain:1;
      const value=(rules[key]*(1-mix)+prototype[key]*activation*mix)*settings.gain*region;
      aus[key]=clamp(value,definition.min,definition.max);
    }
    aus.au45Blink=0; // Lifecycle controller owns blinks, so calm and tired never cause closed-eye lock.
    const blend=scores.map(({preset,score})=>({name:preset.name,label:preset.label,weight:score/sum})).sort((a,b)=>b.weight-a.weight);
    return {aus,details:{blend:activation>.025?blend.slice(0,3):[],dominant:activation>.025?(residue>.15?style!.name:blend[0].name):'neutral',eyelidRelaxation:clamp(c*.2+Math.max(0,s)*c*.08,0,.3),regions:{brow:Math.max(aus.au01InnerBrowRaiser,aus.au02OuterBrowRaiser,aus.au04BrowLowerer),eyes:Math.max(aus.au05UpperLidRaiser,aus.au06CheekRaiser,aus.au07LidTightener),mouth:Math.max(aus.au12LipCornerPuller,aus.au15LipCornerDepressor,aus.au26JawDrop,aus.au24LipPressor)},sourceStrength:residue}};
  }
}
