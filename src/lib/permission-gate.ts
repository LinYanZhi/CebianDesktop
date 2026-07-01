/**
 * 工具权限门禁（Permission Gate）
 *
 * 对齐 Cebian 的 `tool-permissions.ts` 设计：
 * 在执行危险工具前（如文件写入、命令执行），向用户请求授权。
 *
 * 关键设计：
 * - 「某个工具是否需要授权、授权后如何处理」由 `ToolGate` 抽象
 * - 「如何向用户请求决策」由 `RequestDecisionFn` 抽象
 * - 具体的决策策略（once/always/denied）由调用层决定
 */

import type { ToolCall } from "./types";

// ─── 决策类型 ───

/** 用户对一次权限请求的最终决策 */
export type PermissionDecision = 'once' | 'always' | 'denied' | 'dismissed';

/** 权限请求载荷（展示用） */
export interface PermissionRequest {
  toolCallId: string;
  toolName: string;
  title: string;
  description?: string;
}

/** 决策请求函数类型 — UI 层注入 */
export type RequestDecisionFn = (
  request: PermissionRequest,
) => Promise<PermissionDecision>;

// ─── ToolGate 抽象 ───

/**
 * 工具门禁：检查某个工具调用是否需要用户授权。
 *
 * 每个需要授权的工具可以注册自己的 Gate 实例。
 */
export interface ToolGate {
  /** 匹配的工具名称（支持 glob 风格） */
  toolName: string;
  /**
   * 检查是否需要对本次调用进行授权。
   * 返回 `PermissionRequest` 则需要授权，返回 `undefined` 则放行。
   */
  check(toolCall: ToolCall, context?: any): PermissionRequest | undefined;
}

// ─── PermissionGate ───

/**
 * 权限门禁管理器。
 * 管理一组 ToolGate，提供统一的授权检查入口。
 */
export class PermissionGate {
  private gates: ToolGate[] = [];
  /** 持久化的"始终允许"记录（toolName → true） */
  private grantedPermissions = new Map<string, boolean>();

  constructor(gates?: ToolGate[]) {
    if (gates) this.gates = [...gates];
  }

  /** 注册一个 ToolGate */
  register(gate: ToolGate): void {
    this.gates.push(gate);
  }

  /** 检查工具调用是否需要授权 */
  check(toolCall: ToolCall, context?: any): PermissionRequest | undefined {
    // 如果已持久化授权，直接放行
    if (this.grantedPermissions.has(toolCall.function.name)) {
      return undefined;
    }

    for (const gate of this.gates) {
      const result = gate.check(toolCall, context);
      if (result) return result;
    }
    return undefined;
  }

  /** 记录"始终允许"授权 */
  grant(toolName: string): void {
    this.grantedPermissions.set(toolName, true);
  }

  /** 撤销授权 */
  revoke(toolName: string): void {
    this.grantedPermissions.delete(toolName);
  }

  /** 清空所有授权 */
  clearGrants(): void {
    this.grantedPermissions.clear();
  }
}

// ─── 预设 Gates ───

/** 创建文件系统工具的门禁 */
export function createFileSystemGate(): ToolGate {
  const fsTools = new Set([
    'create_file', 'edit_file', 'delete_file', 'rename_file',
    'mkdir', 'save_url',
  ]);
  return {
    toolName: 'filesystem',
    check(toolCall) {
      if (fsTools.has(toolCall.function.name)) {
        return {
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          title: `文件操作: ${toolCall.function.name}`,
          description: `允许执行 ${toolCall.function.name} 吗？`,
        };
      }
      return undefined;
    },
  };
}

/** 创建网络请求工具的门禁 */
export function createNetworkGate(): ToolGate {
  const networkTools = new Set([
    'execute_script', 'bash', 'run_command',
  ]);
  return {
    toolName: 'network',
    check(toolCall) {
      if (networkTools.has(toolCall.function.name)) {
        return {
          toolCallId: toolCall.id,
          toolName: toolCall.function.name,
          title: `高危操作: ${toolCall.function.name}`,
          description: `执行 ${toolCall.function.name} 存在风险，请确认是否允许。`,
        };
      }
      return undefined;
    },
  };
}

/** 根据权限模式创建对应的 Gates */
export function createGatesForMode(mode: string): ToolGate[] {
  switch (mode) {
    case 'conservative':
      return [createFileSystemGate(), createNetworkGate()];
    case 'balanced':
      return [createNetworkGate()];
    case 'trusted':
      return [];
    case 'custom':
    default:
      return [createNetworkGate()];
  }
}

/** 获取工具的权限决策（基于权限模式和工具权限配置） */
export function getToolPermission(
  toolName: string,
  permissionMode: string,
  toolPermissions?: Record<string, string>,
): 'allow' | 'confirm' | 'deny' {
  // 自定义模式下优先读取用户配置
  if (permissionMode === 'custom' && toolPermissions?.[toolName]) {
    return toolPermissions[toolName] as 'allow' | 'confirm' | 'deny';
  }
  // 默认模式
  switch (permissionMode) {
    case 'conservative':
      return 'confirm';
    case 'balanced':
      return ['execute_script', 'bash', 'run_command'].includes(toolName)
        ? 'confirm' : 'allow';
    case 'trusted':
      return 'allow';
    default:
      return 'allow';
  }
}
