declare module "@opencode-ai/plugin" {
  export interface PluginContext {
    // 필요한 경우 추가
  }

  export interface PluginEvent {
    type: string;
    [key: string]: any;
  }

  export interface ToolInput {
    tool: string;
    args: any;
  }

  export interface ToolOutput {
    result: any;
    context: string[];
  }

  export interface PluginHooks {
    event?: (args: { event: PluginEvent }) => Promise<void>;
    "tool.execute.before"?: (input: ToolInput, output: ToolOutput) => Promise<void>;
    "tool.execute.after"?: (input: ToolInput, output: ToolOutput) => Promise<void>;
    "experimental.session.compacting"?: (input: any, output: { context: string[] }) => Promise<void>;
  }

  export type Plugin = (ctx: PluginContext) => Promise<PluginHooks>;
}
