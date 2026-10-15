# 文本语义 → VAD / 动作（v0.4）

本地项目新增 OpenRouter JEV 语义输入。原有情绪、AU、ARKit、模型映射和渲染仍可独立运行。

动作现已支持情绪联动、数字幅度/时长/次数/速度，以及连续的 AU、头部、视线过渡。详见 [动作控制](motion-control.md)。

## 启动

把 `.env.example` 复制为 `.env.local`，设置 `OPENROUTER_API_KEY`，执行 `npm run dev`，访问 http://localhost:4173/。

默认模型为 `~typesafe/jev-latest`，实际回答版本出现在每次结果的 `model` 中；需要固定实验版本时可修改 `JEV_MODEL`。修改环境配置后重启服务。不要给 Key 加 `VITE_` 前缀。

在「情绪 & VAD」上方输入文本，点击「分析并触发」或按 Ctrl / Command + Enter。示例按钮会立即提交一次请求。

- **角色回应**：把文本视为用户的话，结合角色设定决定角色的反应；不直接复制用户的情绪。
- **按文本表演**：把文本视为角色自己的台词或表演描述。第一人称「我」指角色。
- 两种模式都优先处理直接表演指令、否定和引用。模型可能误判，结果区域可检查。
- 「角色设定与上下文」支持编辑性格，保留最近 4 次输入。切换模式或修改角色设定会清空上下文。

## 数据流与强度

一次 `POST /api/semantic/analyze` 对情绪操作、风格、V/A/D、影响强度、D 依据、视线和短动作并行提问；调用的是 OpenRouter Decisions API，不是 Chat Completions。

V/A/D 各有 5 个带语义描述的档位，JEV 返回连续期望评分，转换到 [-1, 1]。D 缺少语义依据时保留应用时的旧目标，不以音量、脏话或置信度猜测支配度。

- `targetVAD` 是语义目标坐标，决定情绪的方向和状态。
- `intensity` 是本次事件推动当前目标接近语义目标的程度，[0, 1]。
- `confidence` 是模型各判断的分布集中程度；不是表情幅度或本领域准确率保证。
- 不把强度再次乘到 AU 上。全局表情增益和区域增益仍由原来的滑块控制。
- 影响为零、普通事实和单纯引用不新增情绪脉冲；现有状态继续保持/衰减，不被强制清零。
- 一个文本事件只推动一次状态；保持、指数衰减和眉眼嘴平滑仍由 FaceEngine 负责。
- 视线指令以角色自身左右为准，侧向注视约保持 3 秒；明确「看回来」回到正前方。支持点头、摇头和眨眼，不声称支持未实现的手部动作。

## 生命周期

新请求会取消旧请求，过期结果即使晚到也不会写入模型。编辑输入、手动改 VAD/AU/视线、切模型或重置会取消未完成的语义结果。重置同时清空语义上下文。

服务错误/超时时只显示错误，角色继续按原状态运行；不伪装成本地关键词识别成功。手动锁定的 AU 保持最高优先级。

## 接口

```js
await window.soullinkFace.reactToText('你开心地笑一下，再点点头。');
await window.soullinkFace.reactToText('我好害怕，完全不知道怎么办。', { mode: 'perform' });
await window.soullinkFace.analyzeText('他说“我气死了”', { mode: 'react' }); // 仅分析
window.soullinkFace.getSemanticState();
window.soullinkFace.cancelSemantic();
window.soullinkFace.clearSemanticHistory();
```

`GET /api/semantic/status` 只返回是否配置、服务名和模型名；Key 保留在本机服务端环境中。前端不会拿到 Key。

## 验证

```sh
npm test
npm run build
npm run test:semantic:live
```

最后一项使用 `.env.local` 配置发起 16 次真实模型请求，比较强弱、D、否定、引用、动作和模式语义，并记录 P50/P95、实际模型版本及费用。结果写入已忽略的 `output/semantic-live-results.json`。这些是小规模功能验收，不是心理测量标注集或情绪识别准确率证明。

真实时延受网络、输入长度、问题数量和服务负载影响；前端动画不等待分析，只有语义目标更新等待结果。

## 部署范围

`npm run dev` 和 `npm run preview` 都提供本机 API。只上传 `dist/` 到纯静态服务器时，手动控制可以使用，但不会包含 JEV 后端；语义输入需要另行部署对应服务。页面下载入口保留的是 v0.2 基础版源码包。
