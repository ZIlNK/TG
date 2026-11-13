# DeepSeek Harness 桌面版适配验收

日期：2026-10-17。插件交付版本：`dsh-tg@0.2.1`。本报告补充桌面版结果，不改写 [2026-10-06 Web 验收](deepseek-harness-validation.md) 的历史结论。

## 环境与依据

| 项目 | 实际值 |
| --- | --- |
| 桌面应用 | 官方 Windows DeepSeek Harness `0.2.0-rc.2` |
| 安装目录 | `D:\AppData\DSH` |
| 应用构建 | `04f392c9ddd144fa426da2045178797da6db6c11`，`dshBuildDirty=false` |
| 宿主依赖 | DSH `0.2.0-rc.2`，Cordis `4.0.4` |
| 桌面自带 CLI | `resources/runtime/cli/bin/dsh.cmd`，版本 `0.2.0-rc.2` |
| Profile | `C:\Users\Ziink\.dsh\profiles\desktop` |
| 实测模型 | 宿主已配置的 `xiaomi-token-plan-cn / mimo-v2.6-pro` |
| 游戏数据 | `C:\Users\Ziink\.dsh\storages\tg_game_v1.json` |

官方[桌面说明](https://github.com/deepseek-ai/deepseek-harness/blob/master/apps/desktop/README.md)明确桌面应用拥有 `desktop` profile，退出后使用随应用附带的 CLI 管理插件。对应构建提交的 GitHub 原始文档地址未能读取，因此版本接口以本机 `app.asar` 中的实际代码、包元数据及同版本 npm 类型为依据，没有用最新主分支替换运行时。

## 实现

- 新增桌面安装/卸载脚本 `packages/dsh-tg/scripts/manage-desktop.ps1`。检查宿主版本与运行进程，备份 profile 配置和锁文件，再调用桌面 CLI；不会强制结束进程。旧 Web 脚本拒绝操作 `desktop` profile。
- Remote codec 同时提供旧 `schema` 与新 `create()`，共享一套校验。Agent 输入来源改为新旧版本都接受的 `user`。
- 开发依赖固定为 DSH `0.2.0-rc.2`、Cordis `4.0.4`；peer 范围明确保留旧版，未使用兼容性豁免。运行产物继续复用宿主 React、Cordis 和 DSH 服务。
- 桌面 renderer 仍使用 `web` 客户端扩展；游戏无需另开 HTTP 服务、固定端口或填写模型密钥。
- 交付包移除了本机仓库相对路径依赖，安装无需项目源码。存档格式未变化。

## 自动验证

| 检查 | 结果 |
| --- | --- |
| 固定锁文件安装 `npm ci --ignore-scripts` | 通过 |
| `npm test` | 28 项全部通过，包含新旧 Remote codec、并发/重复请求、取消/迟到结果、存档恢复、分阶段提交和模型调用限额 |
| `npm run pack:plugin` | 类型检查、tsdown 构建、Node 语法检查及打包通过 |
| 安装器运行保护 | 应用仍运行时拒绝安装，未修改 profile；退出后成功安装 |
| 官方兼容性检查 | 安装通过，未使用忽略 peer/兼容检查选项；共享宿主依赖产生的 pnpm peer 提示不影响运行 |
| 最终安装内容 | 已安装 `package.json`、Host/Client 产物和桌面脚本与仓库交付内容 SHA-256 一致 |
| 配置保护 | `cordis.patch.yml` 与首次安装前备份一致，未改模型/用户配置；Web profile 仍为 `dsh-tg@0.1.6` |

本机终端继承的 PATH 过长，npm 的 `cmd.exe` 脚本最初不能定位构建命令；在构建子进程中使用 Node、Windows 和 Git 的短 PATH 后正常通过，没有改系统环境。

## 桌面窗口与真实模型

通过正常桌面窗口操作验收，使用原生 UI 自动化读取控件和截图；没有关闭认证或用测试 HTTP 接口代替桌面结果。

测试旅程：`桌面适配验收`，编号 `bced9305-791d-4150-a01c-4ad77aa464da`。

| 步骤 | 实际结果 |
| --- | --- |
| 从侧栏打开“文字游戏” | 正常显示“浮城纪事”、模型选择和继续旅程列表，原有两局可见 |
| 选择已配置模型并新开局 | 卧室，第 1 天 08:00，独立游戏面板正常显示 |
| 自由输入“原地等待5分钟。” | 真实 Agent 完成理解行动与现场生成，时间变为 08:05，生成 4 个选项 |
| 点击“出门前往街道主路” | 到达 `Street/street_main`，按跨区路线结算 15 分钟，时间 08:20，生成后续选项 |
| 检查持久化 | revision=7、generation=2，两条已提交收据，分别耗时 5 和 15 分钟；行动状态 completed |
| 在空栏位 1 保存 | 保存成功，标题“桌面适配验收 · 街道主路”，保存时间点 08:20 |
| 正常退出，安装最终 0.2.1 包，重新打开 | 自动恢复该局的 08:20 街道现场、选项和两条收据，未重新结算 |
| 最终包自由输入“原地等待1分钟。” | 真实模型再次完成，08:21；revision=10、generation=3，三条收据 |
| 背包页面 | 正常显示实际空背包；游戏规则以已保存状态为准 |
| 读取栏位 1 | 从 08:21 恢复到 08:20 街道，revision=11、generation=4，两条已提交收据保持，未重复行动 |
| 导出栏位 1 | 正常弹出 Windows 保存对话框；导出 JSON 为 14,015 字节，包含 08:20 街道状态与两条收据 |
| 导入到空栏位 2 | Windows 文件选择器读取刚导出的 JSON，界面与存储均出现第二栏，游戏编号、08:20 状态和收据一致 |
| 设置页面 | 正常显示宿主 MiMo-V2.6-Pro、主题与新开局入口 |

首次两轮在 `0.2.0` 验证；最终 `0.2.1` 清理打包依赖并更新说明，Host/Client 逻辑相同。最终包重启后再次实际调用模型通过。

## 安装包与恢复材料

- 包：`packages/dsh-tg/artifacts/dsh-tg-0.2.1.tgz`，约 92 KB，9 个文件。
- 导出的验收存档：`packages/dsh-tg/artifacts/desktop-smoke-save.json`；桌面中保留测试旅程与栏位 1、2，未覆盖已有存档。
- SHA-256：`C8C4F898104FECACFAEDAF74C01E4F6C240836884934664EDE686C0E57B5BFA6`。
- 首次安装前备份：`C:\Users\Ziink\.dsh\profiles\desktop\backups\tg-desktop-20261017-140257-173`。
- 最终更新前备份：`C:\Users\Ziink\.dsh\profiles\desktop\backups\tg-desktop-20261017-140928-816`。
- 安装/卸载命令见[插件 README](../packages/dsh-tg/README.md)。游戏数据在插件外，卸载保留存档。默认共享 DSH home 时不要同时运行两个写同一游戏存储的 Host。

## 验收边界

- 本轮针对 Windows 官方桌面版 `0.2.0-rc.2`，未验证 macOS、Linux 或其他宿主版本；未升级桌面应用。
- 旧 Web 版的接口兼容有回归覆盖，当前 Web 安装未替换，真实模型全流程未重跑。
- 桌面本轮完成适配所需的真实模型冒烟，照片任务等完整玩法故障分支由现有规则测试及历史 Web 报告覆盖，不声称重新验收全部游戏内容。
- 本轮没有实际卸载桌面插件；交付的是通过官方 CLI 执行卸载的脚本，安装和更新已实测。
- 发现一处模型叙事与事实不一致：街道描述称玩家携带照片，但实际背包为空。该描述未改动物品或任务；叙事一致性问题不属于本次桌面接口变更，仍需后续处理。
- 临时运行时核对目录的清理命令被自动审批策略拦截，故保留忽略目录 `.verification/desktop-runtime` 及下载目录中的验收导出文件；不影响安装包或运行。报告不含凭证。
