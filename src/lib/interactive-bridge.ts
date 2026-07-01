/**
 * Generic interactive tool bridge.
 *
 * 对齐 Cebian 的 `interactive-bridge.ts` 设计：
 * 每个交互式工具（ask_user、confirm_execution 等）创建自己的 bridge 实例，
 * 通过 `request()` 阻塞工具执行，等待用户响应后通过 `resolve()` 继续。
 *
 * 生命周期：tool.execute() → bridge.request() → pending 状态 → UI 渲染 →
 *           用户交互 → bridge.resolve()/cancel() → execute() 返回
 */

/** 用户取消交互式请求的哨兵值 */
export const INTERACTIVE_CANCELLED = Symbol.for('interactive-cancelled');
export type InteractiveCancelled = typeof INTERACTIVE_CANCELLED;

export interface PendingRequest<TRequest> {
  toolCallId: string;
  request: TRequest;
}

export type PendingChangeCallback<TRequest> = (
  pending: PendingRequest<TRequest> | null,
) => void;

export interface InteractiveBridge<TRequest, TResponse> {
  /**
   * 由 tool.execute() 调用。创建一个 pending Promise，阻塞直到：
   * - 用户通过 resolve() 提供响应，或
   * - 请求被 cancel() / AbortSignal 取消
   */
  request(
    toolCallId: string,
    req: TRequest,
    signal?: AbortSignal,
  ): Promise<TResponse | InteractiveCancelled>;

  /** 由 React UI 在用户提供响应时调用 */
  resolve(response: TResponse): void;

  /** 用户绕过工具（如直接发送新消息）时调用 */
  cancel(): void;

  /** 订阅 pending 状态变化。返回取消订阅函数 */
  subscribe(cb: PendingChangeCallback<TRequest>): () => void;

  /** 获取当前 pending 的请求（如果有） */
  getPending(): PendingRequest<TRequest> | null;
}

/**
 * Factory: 创建类型安全的 InteractiveBridge 实例
 *
 * 用法：
 * ```ts
 * const bridge = createInteractiveBridge<AskUserRequest, string>();
 * // tool.execute() 中:  const result = await bridge.request(id, params, signal);
 * // React UI 中:       bridge.resolve(userText);
 * ```
 */
export function createInteractiveBridge<
  TRequest,
  TResponse,
>(): InteractiveBridge<TRequest, TResponse> {
  let pending: PendingRequest<TRequest> | null = null;
  let pendingResolve: ((value: TResponse | InteractiveCancelled) => void) | null = null;
  const listeners = new Set<PendingChangeCallback<TRequest>>();

  function notify() {
    for (const cb of listeners) cb(pending);
  }

  function cleanup() {
    pending = null;
    pendingResolve = null;
    notify();
  }

  return {
    request(toolCallId, req, signal) {
      // 如果有已有的 pending 请求，先取消
      if (pendingResolve) {
        pendingResolve(INTERACTIVE_CANCELLED);
        cleanup();
      }

      return new Promise<TResponse | InteractiveCancelled>((resolve) => {
        pending = { toolCallId, request: req };
        pendingResolve = resolve;
        notify();

        // 支持 AbortSignal
        if (signal) {
          const onAbort = () => {
            if (pendingResolve === resolve) {
              resolve(INTERACTIVE_CANCELLED);
              cleanup();
            }
          };
          if (signal.aborted) {
            onAbort();
          } else {
            signal.addEventListener('abort', onAbort, { once: true });
          }
        }
      });
    },

    resolve(response) {
      if (pendingResolve) {
        pendingResolve(response);
        cleanup();
      }
    },

    cancel() {
      if (pendingResolve) {
        pendingResolve(INTERACTIVE_CANCELLED);
        cleanup();
      }
    },

    subscribe(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    getPending() {
      return pending;
    },
  };
}
