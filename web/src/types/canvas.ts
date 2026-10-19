import type { VideoLocalEditPlan } from "@/lib/canvas/video-local-edit";

export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

export enum CanvasNodeType {
    Image = "image",
    Text = "text",
    Config = "config",
    Video = "video",
    Audio = "audio",
    Group = "group",
}

// Node types are open strings: built-ins use CanvasNodeType and plugins use "<pluginId>:<name>".
export type CanvasNodeTypeId = CanvasNodeType | (string & {});

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio" | "model";
export type CanvasImageGenerationType = "generation" | "edit";

export type CanvasNodeImage = {
    id: string;
    status: CanvasNodeStatus;
    errorDetails?: string;
    content: string;
    storageKey: string;
    naturalWidth: number;
    naturalHeight: number;
    bytes: number;
    mimeType: string;
};

export type CanvasFolderEntry = {
    path: string;
    name: string;
    kind: "file" | "directory";
    size?: number;
};

export type CanvasNodeMetadata = {
    content?: string;
    composerContent?: string;
    prompt?: string;
    status?: CanvasNodeStatus;
    errorDetails?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    model?: string;
    reasoningEffort?: "auto" | "low" | "medium" | "high" | "xhigh";
    size?: string;
    quality?: string;
    background?: string;
    /** RunningHub/Midjourney 等模型扩展参数（chaos、stylize、raw…）。 */
    modelParams?: Record<string, string | number | boolean>;
    /** 生成张数；Codex 节点约定：0 / 缺省 = auto（由对话判断），1–4 = 强制张数 */
    count?: number;
    seconds?: string;
    vquality?: string;
    generateAudio?: string;
    videoReferenceMode?: string;
    watermark?: string;
    realPersonMode?: string;
    audioVoice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    audioEmotion?: string;
    audioTitle?: string;
    audioInstrumental?: string;
    audioTags?: string;
    audioLyrics?: string;
    audioStyle?: string;
    audioCloneModel?: string;
    audioNoiseReduction?: string;
    audioVolumeNormalization?: string;
    references?: string[];
    /** 滑块对比用的参考图（可与 references 不同；局部编辑结果应对完整原图） */
    compareReferences?: string[];
    naturalWidth?: number;
    naturalHeight?: number;
    /** 局部编辑预处理：框选区域 + 画笔合成图，生图时用裁剪图并贴回原图 */
    localEditPreprocess?: boolean;
    /** 节点当前查看原图（true）或画笔合成图（false，默认） */
    localEditViewOriginal?: boolean;
    /** 用户框选归一化区域，用于节点叠层 */
    localEditSelection?: { x: number; y: number; width: number; height: number };
    localEditOriginalContent?: string;
    localEditOriginalStorageKey?: string;
    localEditProcessedContent?: string;
    localEditProcessedStorageKey?: string;
    localEditCropBox?: { x: number; y: number; w: number; h: number };
    localEditCroppedContent?: string;
    localEditCroppedStorageKey?: string;
    localEditChosenRatio?: string;
    /** 视频局部编辑：原片、24fps 输入与手动关键帧，成功前不替换当前媒体。 */
    videoLocalEdit?: VideoLocalEditPlan;
    /** 局部视频工作台唯一回写目标。 */
    videoLocalEditTargetId?: string;
    videoLocalEditRunId?: string;
    /** 扩图预处理：节点显示透明底工作图，生图时用品红工作图 */
    outpaintPreprocess?: boolean;
    outpaintWorkContent?: string;
    outpaintWorkStorageKey?: string;
    outpaintPreviewContent?: string;
    outpaintPreviewStorageKey?: string;
    freeResize?: boolean;
    images?: CanvasNodeImage[];
    primaryImageId?: string;
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    durationMs?: number;
    /** 3D 模型原始文件名（用于扩展名识别） */
    modelFileName?: string;
    /** 模型预览是否显示贴图；缺省 false（白膜） */
    modelShowTextures?: boolean;
    /** 模型预览背景：深色 / 浅色；缺省 dark */
    modelPreviewBg?: "dark" | "light";
    /** 视频/音频播放、下载与参考用的入点（毫秒）；缺省为片头 */
    clipStartMs?: number;
    /** 视频/音频播放、下载与参考用的出点（毫秒）；缺省为片尾 */
    clipEndMs?: number;
    /** 播放与生成是否带上原视频音轨；缺省 true */
    includeAudio?: boolean;
    groupId?: string;
    /** 分组显式登记的成员，侧栏大纲与数据组读取时使用。 */
    memberIds?: string[];
    /** 数据组：聚合子节点文本供 @ / 连线 / Agent 输入；空视觉组不设 */
    groupKind?: "data" | "visual";
    /** 打组时缓存的聚合文本快照；读取时优先动态聚合子节点 */
    groupBundleText?: string;
    interactive?: boolean; // Plugin node interaction/move state; see CanvasNodeDefinition.interactionToggle.
    /** RH综合节点：workflow | scale */
    rhMode?: string;
    /** RH综合节点结果占位图 id */
    rhPlaceholderId?: string;
    /** Codex 智能节点：智能体模式 | 生图模式 */
    codexMode?: "agent" | "image";
    /** Codex 生图节点：idle | running */
    codexPhase?: string;
    /** Codex 节点最近一次任务的思考/输出日志快照 */
    thinkingLog?: string;
    /** Codex 智能节点最近一次任务独占的 Codex 线程，可在右侧面板切换查看 */
    codexThreadId?: string;
    /** Codex 智能节点：最近一次任务总运行时长（毫秒） */
    codexElapsedMs?: number;
    /** Codex 智能体模式的联网执行档：开放网络与命令权限，产物落盘后挂成文件夹节点 */
    codexExec?: boolean;
    /** canvas.tsx 的 JSON 交互状态，按文件路径与 useCanvasState 的 key 分隔。 */
    canvasTsxState?: Record<string, Record<string, unknown>>;
    /** 星小驰本次不使用的已连接资料。 */
    codexExcludedInputIds?: string[];
    /** 最近一次成功产物；保留节点引用，不重复存文件正文。 */
    codexAgentResult?: { nodeIds: string[]; previewNodeId: string; count: number; threadId: string };
    /** Codex Skill 画布节点 */
    skillName?: string;
    skillPath?: string;
    skillDisplayName?: string;
    skillDescription?: string;
    skillEnabled?: boolean;
    /** 通用文件夹节点（资源管理器拖入；存相对路径快照） */
    folderName?: string;
    folderEntries?: CanvasFolderEntry[];
    folderEntryCount?: number;
    folderTruncated?: boolean;
    /** 截断时另存的完整一级子目录名（供 Codex 提示词，不受 500 条清单限制） */
    folderTopLevelDirs?: string[];
    /** copy=已复制到画布数据目录；reference=仅引用本机路径（超限未复制） */
    folderStorageMode?: "copy" | "reference";
    /** 原始本机绝对路径（Electron 拖入时可得） */
    folderLocalPath?: string;
    /** 复制后的数据目录绝对路径 */
    folderDataPath?: string;
    /** 拖入时统计的总字节数 */
    folderTotalBytes?: number;
    /** 文件夹内 SKILL.md 解析出的 Skill 摘要，用于悬停预览 */
    folderSkillName?: string;
    folderSkillDisplayName?: string;
    folderSkillDescription?: string;
    /** Skill 文件夹节点上是否展开 SKILL.md 说明 */
    folderSkillExpanded?: boolean;
    /** 预留：后续按类型挂预览插件（list / md / xlsx / skill …） */
    folderPreviewMode?: string;
    /** 分栏浏览：每栏的父路径，首栏恒为 "" */
    folderColumnRoots?: string[];
    /** 当前选中的相对路径（文件或目录） */
    folderSelectedPath?: string;
    /** 智能预览：文件夹内相对路径或上游文档标记 */
    smartPreviewPath?: string;
    /** markdown | html | excel | csv | text */
    smartPreviewKind?: string;
    /** Excel 工作表下标；-1 表示尚未选择 */
    smartPreviewSheetIndex?: number;
    smartPreviewSheetName?: string;
    /** 当前 Excel 工作表总数；>1 时允许从预览返回选表 */
    smartPreviewSheetCount?: number;
    /** 当前 Excel 工作表总数；>1 时允许从预览返回选表 */
    smartPreviewSheetCount?: number;
    /** 智能预览全屏浮层 */
    smartPreviewFullscreen?: boolean;
    /** HTML UI 画板；未显式设置时由 data-ui-text 标记开启。文案直接写入 content。 */
    htmlDesignBoard?: boolean;
    htmlDesignViewport?: "auto" | "desktop" | "tablet" | "mobile";
    /** 规划书导入的独立预览，不依赖上游文件夹 */
    planPreview?: boolean;
    /** canvas.tsx 拆分出的矢量片段节点（同文档直渲、双击可编辑） */
    canvasFragment?: boolean;
    /** 图表等活片段：裁剪整份 canvas.tsx 预览以保留悬停 tooltip */
    canvasFragmentLive?: boolean;
    /** 活片段闲置时的局部快照；交互树按需唤醒，主题变化后重新生成。 */
    canvasFragmentPreview?: { html: string; theme: "light" | "dark" };
    /** 活片段在原预览中的裁剪矩形（相对 capture） */
    canvasFragmentClip?: { x: number; y: number; width: number; height: number };
    /** 原 capture 尺寸，用于活片段对齐裁剪 */
    canvasFragmentSourceSize?: { width: number; height: number };
    /** 静态片段已按内容收紧过外框尺寸（旧逻辑；现以拆分宽度锁定，不再改宽） */
    canvasFragmentFitted?: boolean;
    /** 拆分片段：请求进入文字编辑（时间戳）；组件消费后清除 */
    fragmentFocusEdit?: number;
    /** 原 canvas.tsx 预览已拆分为数据组 */
    canvasExploded?: boolean;
    /** 拆分前的 canvas.tsx 源码 / 路径（保留可回溯） */
    canvasExplodedSource?: string;
    canvasExplodedPath?: string;
    /** 智能预览作为输入时透传的上游文件夹 */
    proxyFolderNodeId?: string;
    proxyFolderName?: string;
    proxyFolderEntryCount?: number;
    /** 拖入文档类型；Excel 用摘要+右侧展开工作表节点，content 保留截断文本供 @ 引用 */
    documentKind?: "markdown" | "excel" | "csv";
    excelSheets?: Array<{
        name: string;
        rowCount: number;
        colCount: number;
        content: string;
        preview: Array<Array<{ text: string; imageUrl?: string; s?: number }>>;
        contentTruncated?: boolean;
        colWidths?: number[];
        rowHeights?: number[];
        merges?: Array<{ r: number; c: number; rs: number; cs: number }>;
        styles?: Array<{ bg?: string; color?: string; bold?: boolean }>;
    }>;
    /** 展开后各工作表文本节点 id */
    excelSheetNodeIds?: string[];
    /** 来自 Excel 展开的工作表节点 */
    excelParentId?: string;
    excelPreview?: Array<Array<{ text: string; imageUrl?: string; s?: number }>>;
    excelRowCount?: number;
    excelColCount?: number;
    /** 当前工作表的列宽 / 行高 / 合并单元格 / 样式表（与 excelPreview 配套） */
    excelColWidths?: number[];
    excelRowHeights?: number[];
    excelMerges?: Array<{ r: number; c: number; rs: number; cs: number }>;
    excelStyles?: Array<{ bg?: string; color?: string; bold?: boolean }>;
    /** 思维导图主题：中心 / 普通 */
    mindRole?: "root" | "topic";
    /** 思维导图主题种类：普通分支 / 判断 / 标注备注 */
    mindKind?: "topic" | "decision" | "annotation";
    /** 思维导图主题强调色（可选） */
    mindColor?: string;
    /** 思维导图外形：胶囊 / 圆角 / 直角 / 圆形 / 菱形 / 六边形 / 下划线（标注） */
    mindShape?: "capsule" | "rounded" | "rect" | "circle" | "diamond" | "hexagon" | "underline";
    /** 创建后请求进入编辑（时间戳）；组件消费后清除 */
    mindFocusEdit?: number;
    /** 思维导图已收起的方向（右/上/下）；该侧连出的节点整支隐藏 */
    mindCollapsedSides?: Array<"right" | "top" | "bottom">;
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
    /** 传递连线：下游节点作为 AI 输入时，沿本线把上游节点的文件一并带入 */
    carry?: boolean;
    /** 思维导图专属连线；annotation 为上下点虚线标注连线 */
    kind?: "mind" | "annotation";
    /** 连线中点说明文字（双击编辑） */
    label?: string;
    /** 虚线样式；未设时 annotation 默认虚线，其余默认实线 */
    dashed?: boolean;
    /** 起点落在节点框上的相对坐标（0–1），数据组边框连线用 */
    fromAnchor?: { x: number; y: number };
    /** 终点落在节点框上的相对坐标（0–1），数据组边框任意点 */
    toAnchor?: { x: number; y: number };
    /** 导图连线：手动指定起点边（拖出手柄）；有值时不再按相对位置自动改边 */
    fromSide?: ConnectionHandleSide;
    /** 导图连线：手动指定终点边（松手吸附的手柄） */
    toSide?: ConnectionHandleSide;
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    text?: string;
};

export type CanvasAssistantImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    prompt: string;
};

export type CanvasAssistantMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    references?: CanvasAssistantReference[];
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandleSide = "left" | "right" | "top" | "bottom";

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
    /** 导图上下点等；缺省按左右 */
    side?: ConnectionHandleSide;
    /** 相对节点 0–1；星小驰等表面起线锚点 */
    anchor?: Position;
};

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
};

export type ContextMenuState =
    | {
          type: "node";
          x: number;
          y: number;
          nodeId: string;
      }
    | {
          type: "connection";
          x: number;
          y: number;
          connectionId: string;
      };
