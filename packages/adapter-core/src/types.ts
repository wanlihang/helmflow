// docs/architecture/agent-protocol.md §2.2 / §2.4 提到的 "adapter" 概念在这里落地:
// 不同项目类型(java-ddd / node / python / ...)都实现同一组方法,让 Coder / QA
// 节点可以在不知道底层构建工具的情况下,统一发起 build / test / format。

export interface BuildOptions {
  /** 默认 true:跳过测试,只做编译。Coder 节点希望先看到 javac 通过。 */
  skipTests?: boolean;
}

export interface CommandOutcome {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** 退出码;timeout 时为 null,异常时为 -1 */
  exitCode: number | null;
  /** 真实毫秒耗时,便于 UI 上展示 */
  durationMs: number;
  /** 命令是否因超时被强制 kill */
  timedOut: boolean;
}

export interface TestStrictOutcome extends CommandOutcome {
  /** 主测试报告路径(相对 projectPath);找不到则 null */
  reportPath: string | null;
}

export interface TestFullOutcome extends CommandOutcome {
  reportPath: string | null;
  /** 所有 surefire / equivalent 报告文件的相对路径列表 */
  surefireReports: string[];
}

export interface FormatOutcome extends CommandOutcome {
  /** 真正跑了 format(否则降级回 compile-only) */
  formatted: boolean;
}

export interface ProjectAdapter {
  /** 项目根目录,绝对路径 */
  projectPath: string;
  /** 编译目标项目;默认跳过测试,Coder 节点拿来当"javac 通过"门 */
  build(opts?: BuildOptions): Promise<CommandOutcome>;
  /** 严格测试:仅跑 *ArchTest 这类架构 / smoke 测试 */
  testStrict(): Promise<TestStrictOutcome>;
  /** 全量测试:跑完所有用例并枚举所有报告 */
  testFull(): Promise<TestFullOutcome>;
  /** 格式化代码;插件缺失时降级到编译 */
  format(): Promise<FormatOutcome>;
}
