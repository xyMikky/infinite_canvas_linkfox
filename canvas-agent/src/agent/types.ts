/** Agent 向网页广播事件的函数类型。 */
export type AgentEmit = (type: string, payload: unknown) => void;

/** 用户随当前 Agent 消息上传的附件。 */
export type AgentAttachment = { id?: string; name?: string; type?: string; size?: number; width?: number; height?: number; dataUrl?: string; /** 已在画布上的图片节点 ID */ canvasNodeId?: string };

/** Codex 文件、命令和网络权限模式。 */
export type AgentPermissionMode = "request" | "automatic" | "full";

/** Codex 协作模式：Default 直接执行，Plan 先提问再出方案。 */
export type AgentCollaborationMode = "chat" | "default" | "plan";
