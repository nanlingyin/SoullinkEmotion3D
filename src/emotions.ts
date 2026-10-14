import { emotionVADPresets } from '../vendor/soullink/emotion/EmotionPresetRegistry';
import type { VADVector } from '../vendor/soullink/emotion/VADState';
import type { PartialFACSActionUnitState } from '../vendor/soullink/facs/FACSActionUnitState';

export type EmotionGroup = 'positive' | 'connection' | 'low' | 'pressure';
export interface EmotionPreset { name: string; label: string; icon: string; group: EmotionGroup; vad: VADVector; au: PartialFACSActionUnitState; description: string }
const p = (name: string, label: string, icon: string, group: EmotionGroup, vad: VADVector, au: PartialFACSActionUnitState, description: string): EmotionPreset => ({name,label,icon,group,vad,au,description});
/** These are authored animation anchors. They are not universal psychological measurements. */
export const emotionCatalog: EmotionPreset[] = [
  p('neutral','中性','◌','low',emotionVADPresets.neutral,{},'回到自然基线'),
  p('happy','开心','⌣','positive',emotionVADPresets.happy,{au12LipCornerPuller:.65,au06CheekRaiser:.34,au02OuterBrowRaiser:.09},'嘴角上扬，眼周轻轻收紧'),
  p('excited','兴奋','✧','positive',emotionVADPresets.excited,{au12LipCornerPuller:.75,au06CheekRaiser:.26,au02OuterBrowRaiser:.32,au05UpperLidRaiser:.28,au25LipsPart:.2,au26JawDrop:.18},'更大的笑容、外眉上提与轻微张嘴'),
  p('amused','忍俊','⌒','positive',{valence:.72,arousal:.33,dominance:.1},{au12LipCornerPuller:.57,au06CheekRaiser:.56,au07LidTightener:.18,au14Dimpler:.15},'笑眼比张嘴更明显'),
  p('proud','得意','˘','positive',{valence:.68,arousal:.32,dominance:.8},{au12LipCornerPuller:.28,au14Dimpler:.35,au07LidTightener:.13,headY:.09,gazeY:.08},'克制微笑、轻微收眼与抬头'),
  p('confident','自信','◇','positive',{valence:.4,arousal:.12,dominance:.85},{au12LipCornerPuller:.21,au14Dimpler:.19,au23LipTightener:.13,headY:.1,gazeY:.04},'稳住嘴角与头部姿态'),
  p('calm','安心','≈','low',emotionVADPresets.calm,{au12LipCornerPuller:.21,au06CheekRaiser:.12,au07LidTightener:.1},'舒缓眼睑，微弱而安定的笑容'),
  p('relieved','释然','～','low',{valence:.52,arousal:-.48,dominance:.15},{au12LipCornerPuller:.31,au06CheekRaiser:.22,au25LipsPart:.035,headY:-.025},'紧绷释放，笑容舒展'),
  p('affectionate','温柔','♡','connection',emotionVADPresets.affectionate,{au12LipCornerPuller:.38,au06CheekRaiser:.24,au01InnerBrowRaiser:.12,headZ:-.045},'柔和内眉与微笑共同出现'),
  p('shy','害羞','〃','connection',emotionVADPresets.shy,{au12LipCornerPuller:.32,au06CheekRaiser:.29,au01InnerBrowRaiser:.15,au24LipPressor:.08,gazeY:-.13,headY:-.07,headZ:-.09,blush:.4},'眼神下移，微笑带着退让'),
  p('embarrassed','窘迫','⁄','connection',{valence:.08,arousal:.66,dominance:-.7},{au01InnerBrowRaiser:.32,au12LipCornerPuller:.15,au20LipStretcher:.18,au24LipPressor:.2,gazeY:-.2,headY:-.1,blush:.5},'拘谨嘴唇与更明显的回避视线'),
  p('curious','好奇','?','connection',emotionVADPresets.curious,{au02OuterBrowRaiser:.38,au05UpperLidRaiser:.2,au12LipCornerPuller:.09,headZ:.065},'眉与眼展开，轻微歪头'),
  p('concerned','关切','·','connection',emotionVADPresets.concerned,{au01InnerBrowRaiser:.38,au04BrowLowerer:.15,au15LipCornerDepressor:.08,au24LipPressor:.06},'内眉上提与眉心收紧'),
  p('confused','困惑','∿','connection',emotionVADPresets.confused,{au01InnerBrowRaiser:.22,au02OuterBrowRaiser:.18,au04BrowLowerer:.18,au18LipPucker:.08,headZ:.1},'眉眼不确定，嘴唇轻微收拢'),
  p('tired','疲惫','−','low',emotionVADPresets.tired,{au07LidTightener:.14,au15LipCornerDepressor:.08,headY:-.08,gazeY:-.06},'低唤醒度降低眼睑与头部活力'),
  p('sad','低落','⌢','low',emotionVADPresets.sad,{au01InnerBrowRaiser:.6,au15LipCornerDepressor:.45,au17ChinRaiser:.15,headY:-.08,gazeY:-.12},'内眉与下垂嘴角共同表达悲伤'),
  p('lonely','落寞','⋅','low',{valence:-.55,arousal:-.55,dominance:-.65},{au01InnerBrowRaiser:.36,au15LipCornerDepressor:.27,au07LidTightener:.09,gazeY:-.18,headY:-.12},'较安静的悲伤与回避视线'),
  p('disappointed','失望','⤵','low',{valence:-.62,arousal:-.18,dominance:-.12},{au01InnerBrowRaiser:.3,au15LipCornerDepressor:.32,au24LipPressor:.3,au04BrowLowerer:.15},'悲伤中保留绷紧的嘴唇'),
  p('anxiety','紧张','⋯','pressure',emotionVADPresets.anxiety,{au01InnerBrowRaiser:.5,au04BrowLowerer:.21,au05UpperLidRaiser:.22,au20LipStretcher:.34,au24LipPressor:.16},'内眉、眼睑与横向嘴部张力'),
  p('fear','害怕','!','pressure',{valence:-.78,arousal:.85,dominance:-.8},{au01InnerBrowRaiser:.56,au02OuterBrowRaiser:.46,au05UpperLidRaiser:.64,au20LipStretcher:.43,au25LipsPart:.16,au26JawDrop:.17,gazeY:-.08},'睁大眼睛，上提眉毛与退缩姿态'),
  p('anger','生气','⌁','pressure',emotionVADPresets.anger,{au04BrowLowerer:.74,au07LidTightener:.5,au23LipTightener:.44,au24LipPressor:.34,headY:.04},'高支配度下压眉毛并收紧嘴唇'),
  p('frustrated','烦躁','≋','pressure',{valence:-.63,arousal:.58,dominance:.05},{au04BrowLowerer:.51,au07LidTightener:.28,au15LipCornerDepressor:.23,au24LipPressor:.34,au23LipTightener:.2},'较弱主导感，皱眉中混入下垂嘴角'),
  p('disgust','嫌弃','⌜','pressure',{valence:-.7,arousal:.28,dominance:.45},{au04BrowLowerer:.35,au07LidTightener:.37,au09NoseWrinkler:.6,au10UpperLipRaiser:.42,au23LipTightener:.3,au15LipCornerDepressor:.18},'收眼、皱眉与中面部张力；未支持形变保持缺失'),
  p('surprised','惊讶','○','pressure',emotionVADPresets.surprised,{au01InnerBrowRaiser:.2,au02OuterBrowRaiser:.65,au05UpperLidRaiser:.63,au25LipsPart:.26,au26JawDrop:.36,au27MouthStretch:.12},'上提外眉、展开眼睛与嘴巴'),
];
export const emotionByName = new Map(emotionCatalog.map(p=>[p.name,p]));
export const commonEmotions = ['happy','excited','shy','calm','sad','anger','anxiety','surprised'];
