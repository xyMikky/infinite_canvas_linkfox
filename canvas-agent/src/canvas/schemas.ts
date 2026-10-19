import { z } from "zod";

const recordSchema = z.record(z.unknown());
const positionSchema = z.object({ x: z.number(), y: z.number() });
const viewportSchema = z.object({ x: z.number(), y: z.number(), k: z.number() });
const nodeTypeSchema = z.enum(["image", "text", "config", "video", "audio", "mind-node", "group", "smart-preview"]);
const connectionLinkSchema = z.object({
    fromNodeId: z.string(),
    toNodeId: z.string(),
    kind: z.enum(["mind", "annotation"]).optional(),
    fromSide: z.enum(["left", "right", "top", "bottom"]).optional(),
    toSide: z.enum(["left", "right", "top", "bottom"]).optional(),
    label: z.string().optional(),
});

const mindNodeMetadataHint =
    "mind-node：自由图画布。空选区≠无图，落图前须 get_state 防重复。分步落盘（先主链再逐条分支，单次 add_node≤12）；坐标仅初值（系统会消重叠/箍组框）。细节清单用 smart-preview，勿塞进一张导图。metadata：mindRole/mindKind/mindShape/mindColor/fontSize/content。";
const groupNodeMetadataHint =
    "group 数据组：仅同一分支≥3并列叶子才打组；metadata.memberIds=[子id…]；勿传超大宽高；一张图组数宜少（通常≤4～6）；流程只连 group 整框，禁止对每个叶子拉远距边；禁止整图包一层大 group。";
const smartPreviewMetadataHint =
    "smart-preview 独立预览：表/图/多页交付等高压内容放这里。metadata.smartPreviewKind=canvasTsx|html|markdown|text|…；smartPreviewPath；content=源码/正文。从对应 Step connect（普通连线即可）。";

const generationModeSchema = z.enum(["text", "image", "video", "audio"]);

/** Canvas Agent 对外提供的工具名称。 */
export const toolNames = [
    "site_navigate",
    "canvas_list_projects",
    "canvas_get_state",
    "canvas_get_selection",
    "canvas_export_snapshot",
    "canvas_apply_ops",
    "canvas_create_node",
    "canvas_create_attachment_nodes",
    "canvas_create_text_node",
    "canvas_create_text_nodes",
    "canvas_create_config_node",
    "canvas_create_image_prompt_flow",
    "canvas_create_generation_flow",
    "canvas_generate_text",
    "canvas_generate_image",
    "canvas_generate_video",
    "canvas_generate_audio",
    "canvas_update_node",
    "canvas_update_node_text",
    "canvas_move_nodes",
    "canvas_resize_node",
    "canvas_delete_nodes",
    "canvas_connect_nodes",
    "canvas_update_connection",
    "canvas_select_nodes",
    "canvas_set_viewport",
    "canvas_run_generation",
    "generation_get_status",
    "workbench_image_get_config",
    "workbench_image_generate",
    "workbench_video_get_config",
    "workbench_video_generate",
    "prompts_search",
    "assets_list",
    "assets_add",
] as const;
export type ToolName = (typeof toolNames)[number];

export const canvasOpSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("add_node"), nodeType: nodeTypeSchema.optional(), id: z.string().optional(), title: z.string().optional(), x: z.number().optional(), y: z.number().optional(), width: z.number().optional(), height: z.number().optional(), position: positionSchema.optional(), metadata: recordSchema.optional() }).passthrough(),
    z.object({ type: z.literal("update_node"), id: z.string(), patch: recordSchema.optional(), metadata: recordSchema.optional() }).passthrough(),
    z.object({ type: z.literal("delete_node"), id: z.string().optional(), ids: z.array(z.string()).optional() }).passthrough(),
    z.object({ type: z.literal("delete_connections"), id: z.string().optional(), ids: z.array(z.string()).optional(), all: z.boolean().optional() }).passthrough(),
    z.object({ type: z.literal("connect_nodes"), id: z.string().optional(), fromNodeId: z.string(), toNodeId: z.string(), kind: z.enum(["mind", "annotation"]).optional(), fromSide: z.enum(["left", "right", "top", "bottom"]).optional(), toSide: z.enum(["left", "right", "top", "bottom"]).optional(), label: z.string().optional() }).passthrough(),
    z.object({ type: z.literal("update_connection"), id: z.string().optional(), fromNodeId: z.string().optional(), toNodeId: z.string().optional(), label: z.string().optional(), kind: z.enum(["mind", "annotation"]).optional(), fromSide: z.enum(["left", "right", "top", "bottom"]).optional(), toSide: z.enum(["left", "right", "top", "bottom"]).optional() }).passthrough(),
    z.object({ type: z.literal("set_viewport"), viewport: viewportSchema }).passthrough(),
    z.object({ type: z.literal("select_nodes"), ids: z.array(z.string()) }).passthrough(),
    z.object({ type: z.literal("run_generation"), nodeId: z.string(), mode: generationModeSchema.optional(), prompt: z.string().optional() }).passthrough(),
]);

const textNodeSchema = z.object({
    text: z.string(),
    title: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    width: z.number().optional(),
    height: z.number().optional(),
});

const generationOptionsSchema = z.object({
    model: z.string().optional(),
    size: z.string().optional(),
    quality: z.string().optional(),
    count: z.number().optional(),
    seconds: z.string().optional(),
    vquality: z.string().optional(),
    generateAudio: z.string().optional(),
    watermark: z.string().optional(),
    audioVoice: z.string().optional(),
    audioFormat: z.string().optional(),
    audioSpeed: z.string().optional(),
    audioInstructions: z.string().optional(),
});

const generationFlowSchema = z.object({
    prompt: z.string(),
    title: z.string().optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    referenceNodeIds: z.array(z.string()).optional(),
    /** 生成流程与占位框贴着该节点放置（如 Codex 智能节点 id） */
    anchorNodeId: z.string().optional(),
});

export const toolInputSchemas = {
    site_navigate: z.object({ path: z.string() }),
    canvas_list_projects: z.object({ keyword: z.string().optional(), page: z.number().optional(), pageSize: z.number().optional() }),
    canvas_get_state: z.object({}).passthrough(),
    canvas_get_selection: z.object({}).passthrough(),
    canvas_export_snapshot: z.object({}).passthrough(),
    canvas_apply_ops: z.object({ ops: z.array(canvasOpSchema) }),
    canvas_create_node: z.object({ nodeType: nodeTypeSchema, title: z.string().optional(), x: z.number().optional(), y: z.number().optional(), width: z.number().optional(), height: z.number().optional(), metadata: recordSchema.optional() }),
    canvas_create_attachment_nodes: z.object({ attachmentIds: z.array(z.string()).min(1), x: z.number().optional(), y: z.number().optional(), gap: z.number().optional(), direction: z.enum(["row", "column"]).optional() }),
    canvas_create_text_node: z.object({ text: z.string().optional(), x: z.number().optional(), y: z.number().optional(), title: z.string().optional(), width: z.number().optional(), height: z.number().optional() }),
    canvas_create_text_nodes: z.object({ items: z.array(textNodeSchema).min(1), x: z.number().optional(), y: z.number().optional(), gap: z.number().optional(), direction: z.enum(["row", "column"]).optional() }),
    canvas_create_config_node: z.object({ prompt: z.string().optional(), mode: generationModeSchema.optional(), title: z.string().optional(), x: z.number().optional(), y: z.number().optional(), width: z.number().optional(), height: z.number().optional(), autoRun: z.boolean().optional() }).merge(generationOptionsSchema),
    canvas_create_image_prompt_flow: z.object({ prompt: z.string(), x: z.number().optional(), y: z.number().optional(), autoRun: z.boolean().optional() }).merge(generationOptionsSchema),
    canvas_create_generation_flow: generationFlowSchema.extend({ mode: generationModeSchema.optional(), autoRun: z.boolean().optional() }).merge(generationOptionsSchema),
    canvas_generate_text: generationFlowSchema.merge(generationOptionsSchema),
    canvas_generate_image: generationFlowSchema.merge(generationOptionsSchema),
    canvas_generate_video: generationFlowSchema.merge(generationOptionsSchema),
    canvas_generate_audio: generationFlowSchema.merge(generationOptionsSchema),
    canvas_update_node: z.object({ id: z.string(), patch: recordSchema.optional(), metadata: recordSchema.optional() }),
    canvas_update_node_text: z.object({ id: z.string(), text: z.string(), title: z.string().optional() }),
    canvas_move_nodes: z.object({ items: z.array(z.object({ id: z.string(), x: z.number().optional(), y: z.number().optional(), dx: z.number().optional(), dy: z.number().optional() })).min(1) }),
    canvas_resize_node: z.object({ id: z.string(), width: z.number(), height: z.number(), freeResize: z.boolean().optional() }),
    canvas_delete_nodes: z.object({ ids: z.array(z.string()).min(1) }),
    canvas_connect_nodes: z.object({ connections: z.array(connectionLinkSchema).min(1) }),
    canvas_update_connection: z.object({ id: z.string().optional(), fromNodeId: z.string().optional(), toNodeId: z.string().optional(), label: z.string().optional(), kind: z.enum(["mind", "annotation"]).optional(), fromSide: z.enum(["left", "right", "top", "bottom"]).optional(), toSide: z.enum(["left", "right", "top", "bottom"]).optional() }),
    canvas_select_nodes: z.object({ ids: z.array(z.string()) }),
    canvas_set_viewport: z.object({ viewport: viewportSchema }),
    canvas_run_generation: z.object({ nodeId: z.string(), mode: generationModeSchema.optional(), prompt: z.string().optional() }),
    generation_get_status: z.object({ scope: z.enum(["all", "canvas", "image", "video"]).optional(), taskId: z.string().optional(), nodeIds: z.array(z.string()).optional(), limit: z.number().optional() }),
    workbench_image_get_config: z.object({}).passthrough(),
    workbench_image_generate: z.object({ prompt: z.string(), model: z.string().optional(), quality: z.string().optional(), size: z.string().optional(), count: z.number().optional(), run: z.boolean().optional() }),
    workbench_video_get_config: z.object({}).passthrough(),
    workbench_video_generate: z.object({ prompt: z.string(), model: z.string().optional(), size: z.string().optional(), seconds: z.string().optional(), resolution: z.string().optional(), generateAudio: z.boolean().optional(), watermark: z.boolean().optional(), run: z.boolean().optional() }),
    prompts_search: z.object({ keyword: z.string().optional(), category: z.string().optional(), tags: z.array(z.string()).optional(), page: z.number().optional(), pageSize: z.number().optional() }),
    assets_list: z.object({ kind: z.enum(["all", "text", "image", "video"]).optional(), keyword: z.string().optional(), page: z.number().optional(), pageSize: z.number().optional() }),
    assets_add: z.object({ kind: z.enum(["text", "image"]), title: z.string(), content: z.string().optional(), imageUrl: z.string().optional(), tags: z.array(z.string()).optional(), source: z.string().optional(), note: z.string().optional() }),
} satisfies Record<ToolName, z.AnyZodObject>;

export const toolDescriptions: Record<ToolName, string> = {
    site_navigate: "跳转网站页面。path 可为 / (首页)、/canvas (我的画布)、/canvas/:id (指定画布)、/image (生图工作台)、/video (视频创作台)、/prompts (提示词库)、/assets (我的素材)、/config (配置)。操作画布前若不在画布页，先用本工具打开画布。",
    canvas_list_projects: "列出用户全部画布（仅标题、创建/更新时间、节点数、连线数，不含完整数据），支持 keyword 搜索和 page/pageSize 分页。返回的 id 可配合 site_navigate 跳转到 /canvas/:id 打开对应画布。",
    canvas_get_state: "读取当前网页画布的节点、连线、选区和视口。导图节点含 mindKind/mindShape/mindColor/fontSize；连线含 label、kind、fromSide/toSide、id。mindMaps 大纲含层级与连线清单。mindMapSelfCheck 含 overlapPairs（应为 0）。空选区时仍须用本工具确认是否已有导图，禁止仅凭无选中就再造一套。宣称导图完成前必须再读一次并自检。",
    canvas_get_selection: "读取当前网页画布选中的节点。无选中不代表画布为空；要判断是否已有导图请改用 canvas_get_state。",
    canvas_export_snapshot: "导出当前画布快照，用于理解布局。",
    canvas_apply_ops: `批量操作当前网页画布。导图：分多次调用（先主链→逐条分支→收尾）；禁止单次倒入整图；续画/重画前先 canvas_get_state，禁止空选区时重复生成第二套导图。落盘后系统消重叠并箍组框，坐标只是初值。${groupNodeMetadataHint} ${smartPreviewMetadataHint}`,
    canvas_create_node: `创建画布节点：text、image、config、video、audio、mind-node、group、smart-preview。不传 x/y 时落在视口中心。${mindNodeMetadataHint} ${groupNodeMetadataHint} ${smartPreviewMetadataHint}`,
    canvas_create_attachment_nodes: "仅把「聊天上传且画布上还没有」的图片附件建成画布节点。若提示里已给出 canvasNodeId（上游已有节点），禁止调用本工具复制；直接把那些 ID 传给 canvas_generate_image.referenceNodeIds。",
    canvas_create_text_node: "在当前画布创建单个文本节点。",
    canvas_create_text_nodes: "批量创建文本节点，适合生成标题、段落、脚本、说明等内容块。",
    canvas_create_config_node: "仅当用户明确要求在画布上建工作台/配置节点时使用。不要用来回答聊天问题或反推提示词。不要传 model，除非用户明确指定了已配置的模型；省略则使用用户默认模型。",
    canvas_create_image_prompt_flow: "仅当用户明确要求在画布上搭「提示词+生图」流程时使用。聊天里写/反推提示词不要调用。不要传 model，除非用户明确指定了已配置的模型。",
    canvas_create_generation_flow: "仅当用户明确要求在画布上创建生成流程时使用。问答、反推提示词、写文案不要调用。不要传 model，除非用户明确指定了已配置的模型。",
    canvas_generate_text: "仅当用户明确要求在画布上生成文本节点时使用。对话里回答问题、反推/改写提示词、写文案必须直接回复，禁止调用本工具。不要传 model，除非用户明确指定了已配置的模型。",
    canvas_generate_image: "创建通用图片生成流程并立即触发生成。会立刻在参考图/锚点旁挂上「生成中」占位图节点。参考图优先传画布上已有节点的 referenceNodeIds（上游连线），不要先复制附件节点。不要传 model，除非用户明确指定了已配置的模型；省略则使用用户在设置里的默认生图模型。禁止自行填写 BANANA_PRO 等未配置渠道的模型。",
    canvas_generate_video: "创建通用视频生成流程并立即触发生成。不要传 model，除非用户明确指定了已配置的模型。",
    canvas_generate_audio: "创建通用音频生成流程并立即触发生成。不要传 model，除非用户明确指定了已配置的模型。",
    canvas_update_node: `更新节点字段或 metadata。导图可改 mindColor、mindShape、fontSize、mindKind 等。${mindNodeMetadataHint}`,
    canvas_update_node_text: "更新节点文案。text/ mind-node 会写入 content；可传 title。",
    canvas_move_nodes: "移动一个或多个节点，支持绝对坐标或 dx/dy 偏移。",
    canvas_resize_node: "调整节点尺寸。",
    canvas_delete_nodes: "删除指定节点及相关连线。",
    canvas_connect_nodes: "批量连接节点。导图：相邻主链串行；分支连旁侧 group 整框或直接子题；禁止远距蛛网。judgment/decision 出边必须带 label（是/否等）。标注：标注 from→主题 to，kind=annotation。",
    canvas_update_connection: "更新已有连线：改 label（连线中点文字，等同用户双击连线编辑）、kind、fromSide、toSide。用 id 或 fromNodeId+toNodeId 定位。",
    canvas_select_nodes: "设置当前选中节点。",
    canvas_set_viewport: "调整画布视口。导图收尾应对准中心/当前分支且保持文字可读（k 约 0.85～1.2）；禁止为塞进全图而把缩放压到极小。",
    canvas_run_generation: "触发指定节点生成，通常用于配置节点或文本/图片/视频/音频节点。",
    generation_get_status: "查询当前活动网页的生成任务状态。默认返回画布、生图工作台和视频工作台最近任务；可用 scope 过滤来源，用 taskId 查询工作台任务，用 nodeIds 查询画布节点。",
    workbench_image_get_config: "读取生图工作台的当前参数和可选项（可用模型、质量、尺寸/宽高比、张数范围），在调用 workbench_image_generate 前先了解可选值。",
    workbench_image_generate: "在生图工作台填入提示词并按需设置 model、quality、size（如 1:1 或 1024x1024）、count，run 默认 true 会自动点击生成按钮。会自动跳转到生图工作台。生成为异步过程，提交后返回 taskId，可用 generation_get_status 查询状态。",
    workbench_video_get_config: "读取视频创作台的当前参数和可选项（可用模型、尺寸/比例、时长、清晰度/分辨率、是否生成声音与水印）。",
    workbench_video_generate: "在视频创作台填入提示词并按需设置 model、size、seconds、resolution、generateAudio、watermark，run 默认 true 会自动点击生成按钮。会自动跳转到视频创作台。生成为异步过程，提交后返回 taskId，可用 generation_get_status 查询状态。",
    prompts_search: "搜索提示词库（第三方提示词合集），支持 keyword、category、tags 过滤和 page/pageSize 分页，返回标题、提示词、分类、标签、封面等。",
    assets_list: "列出用户「我的素材」，支持 kind（text/image/video）过滤、keyword 搜索和 page/pageSize 分页。为控制体积不返回图片/视频原始 data，仅返回封面与元信息。",
    assets_add: "向「我的素材」新增素材。kind=text 时用 content 传文本内容；kind=image 时用 imageUrl 传图片地址或 dataURL。可附带 title、tags、source、note。",
};
