# TG / DeepSeek Harness 原生游戏插件

插件 **0.6.0** 将理解行动、NPC 回应、现场生成的上下文分开，并在结算时记录带知情范围的结构化经历；保留轨迹时间轴、事件表格与详情面板。按官方 Windows 桌面版 Harness **0.2.1-rc.2** 类型构建。保留 **0.2.0-rc.2** 与 Web **0.1.5-rc.2** 的既有协议声明；新增功能尚未在旧宿主复验。侧栏“文字游戏”打开独立面板，保留普通聊天。模型和凭证沿用宿主配置。预编译包无需玩家编译。

## 桌面版安装与卸载

先在桌面版“应用”菜单选择“退出”（关窗口只是隐藏），再执行：

```powershell
./scripts/manage-desktop.ps1 -DesktopRoot 'D:/AppData/DSH' -Package './artifacts/dsh-tg-0.6.0.tgz'
```

`DesktopRoot` 改为实际安装目录。脚本使用桌面版自带 `resources/runtime/cli/bin/dsh.cmd` 与包管理器，备份 `profiles/desktop` 配置及锁文件后安装并登记 bundle；不使用 Web 版的实时重载补丁。应用仍在运行或宿主版本不匹配时拒绝修改。完成后重新打开桌面版，在侧栏选择“文字游戏”。无需升级宿主、单独启动 Web 服务或配置第二套密钥。

卸载同样先退出桌面版，然后执行：

```powershell
./scripts/manage-desktop.ps1 -DesktopRoot 'D:/AppData/DSH' -Action remove
```

卸载保留游戏存储，Web profile 不受影响。桌面版和 Web 默认共享 `.dsh` 下的产品数据，已有 TG 旅程可以继续；界面上次打开的旅程则随各端浏览器存储分别记忆。请勿让两个 Host 同时写同一存储文件；需要同时运行时使用各自的 `DSH_HOME`，通过 JSON 存档转移。

本机适配和实际验收见 [桌面版验证报告](../../docs/deepseek-harness-desktop-validation.md)。

## 旧 Web 版安装到正在运行的实例

以下保留已在旧 Web 宿主验收的 `0.1.6` 包示例；`0.2.1` 保留旧协议并有回归测试，但本轮没有替换现有 Web 安装或重跑其真实模型验收。

使用当前进程对应的 `dsh/lib/bin.js`，不要通过未固定版本的 `npx` 升级宿主：

```powershell
./scripts/install.ps1 -DshCli '<当前 Harness 的 dsh/lib/bin.js>' -Package './artifacts/dsh-tg-0.1.6.tgz' -Profile web
```

脚本先备份 profile 的配置和锁文件，通过官方 `dsh plugin --profile web add` 安装，然后写入带标记的用户补丁。`0.1.5-rc.2` 实时重载保留启动时的 bundle 层，所以仅安装新 bundle 不会让当前进程加载它；本脚本使用同一个用户补丁负责当前运行和以后启动，避免重复加载。更新使用带版本的 Loader id，避免旧客户端入口残留。profile 须已启用 `patchReload: live`。默认 home 为 `DSH_HOME`，未设置时为当前用户的 `.dsh`。

更新已有 TG 时，脚本先临时撤销旧入口，等待旧游戏服务和存储域实际释放，再安装并加载新版。未能确认释放会恢复原补丁并报错。更新后在已登录的 Harness 页面刷新，选择“文字游戏”。原有其他任务和插件不需要停止，认证配置不变。脚本也随 `.tgz` 一起提供，可用 `tar -xf dsh-tg-0.1.6.tgz` 解包取得。

未运行的实例也可以直接执行官方命令，再按正常方式启动：

```powershell
node '<当前 Harness 的 dsh/lib/bin.js>' plugin --profile web add './artifacts/dsh-tg-0.1.6.tgz'
```

CLI 会自动把声明 `dsh.bundle` 的插件加入 profile。不要同时保留 bundle 条目和手工添加的同名游戏服务。重新打包更新时增加插件版本；不要用同一版本和文件名覆盖不同内容，否则包管理器可能沿用已安装的副本。

## 使用

选模型并开局，输入想做的事情，或生成现场选项。管理入口只有背包、角色、地图、任务日志、存档、设置；移动、交付、购买和接受提议都回到现场进行。

行动中可取消。照片交付、耗时等已确认结果保留，重试只补齐未完成阶段。每次提交自动保存，另有 8 个手动栏位与新版 JSON 导入导出。刷新后读取 Host 保存的完整状态。允许重新开局，旧旅程仍可从列表进入。

## 卸载与回退

```powershell
./scripts/uninstall.ps1 -DshCli '<当前 Harness 的 dsh/lib/bin.js>' -Profile web
```

脚本只撤销本插件的受管补丁和包依赖，保留游戏存储。手动安装者先移除自己的 `dsh-tg` bundle/补丁，再执行 `dsh plugin --profile web remove dsh-tg`。不要将早期备份整体覆盖到后来又安装过其他插件的 profile；仅回退 TG 对应改动。旧网页版本和 SugarCube 存档不受影响。

## 开发

```powershell
cd packages/dsh-tg
npm ci --ignore-scripts
npm test
npm run pack:plugin
```

`src/core` 是纯规则及提交服务，`src/host` 接入 Agent、Remote 和结构化存储，`src/client` 是 React 面板，`src/content` 保存迁移后的中文角色资料、地点和主题。`npm run content:sync` 从旧版内容和主题重新提取数据；像素素材算法已改写为无 DOM 的纯函数。

依赖和传递依赖锁在 `package-lock.json`。运行产物外置宿主 Cordis、React 和 DSH 模块，只内置数据校验。TypeScript 先转换标准装饰器，再由 tsdown 打包；构建同时检查 Node 可执行语法。

详见仓库 [迁移实现文档](../../docs/deepseek-harness-migration.md) 和 [本机验证报告](../../docs/deepseek-harness-validation.md)。功能完成与实际验收结果分开记录。

## 游戏调用记录（0.3.0）

游戏内打开“调用记录”，选择一次行动，再展开“理解行动／人物回应／生成现场”。可查看原生事件中的提示词、模型输出、工具参数和返回值、失败信息及提供方返回的 usage；每次重试独立保留。下方“实际结算”列出已经随游戏状态保存的变化，STAGED 不代表结算。

可导出选中行动的 JSON 快照。原始模型事件仍由 Harness 保存，插件只保存关联索引；日志文件缺失会明确显示，不会恢复 Agent 或重放行动。旧行动不猜测补关联。读档保留本机结算历史并增加恢复标记；导入别人的存档不导入其原始模型日志。记录不会进入模型上下文。

实现与验证见 [调用记录说明](../../docs/deepseek-harness-traces.md)。

阶段取数、知情范围、旧存档兼容与经历写入规则见 [上下文与经历说明](../../docs/deepseek-harness-context.md)。旧记录不猜测补造，近期记录之外可按需查询，尚未增加自动摘要。

### 0.4.2

经历上下文去重，增加明确的游戏日期、钟点和时段，要求模型通过结果工具提交。调用记录默认显示每次请求实际携带的工具定义（名称、说明及参数结构），取自原生 request/header，导出保留原始事件。旧记录缺少工具列表时明确标注，不根据当前代码补造。

### 0.4.3：独立阶段提示词

在 src/host/prompts/plan.ts、reply.ts、scene.ts 中分别维护完整阶段提示词及资料布局；修改一个模板不改变另外两个。context.ts 继续负责信息筛选与知情范围。场景和状态资料在系统提示词中分段插入，理解行动的用户消息只保留玩家输入，NPC 的用户消息只包含本轮知情互动，现场生成的用户消息为简短生成请求。调用记录会显示实际组装后的系统和用户消息。

### 0.4.4：自然语言插值

三个阶段的现场段落直接插入游戏日、钟点、时段、天气、地点和环境。NPC 模板直接生成‘你是某人……你在某地……你的人物设定……’，同时保留真实编号；任务、资源及经历等列表仍按结构化资料呈现。修改位置仍为 src/host/prompts 下的三个独立模板。

### 0.5.0：外部提示词热更新

运行时编辑 `${DSH_HOME}/tg/prompts`（未设置 DSH_HOME 时为 `~/.dsh/tg/prompts`）里的六个 UTF-8 文本文件：`plan.system.md` / `plan.user.md`、`reply.system.md` / `reply.user.md`、`scene.system.md` / `scene.user.md`。首次使用自动创建默认文件，存在的文件不覆盖。保存后下一次阶段调用生效，无需重新构建、重启或刷新页面；已开始的调用保留原提示词。

占位符使用单层花括号，例如 `你是{npc.name}，现在是{day} {time}，天气{weather}，你在{place.name}。`。不执行 JavaScript，不支持表达式，不递归替换插入数据中的占位符。变量只能来自当前阶段已裁剪的上下文。

| 范围 | 可用变量 |
| --- | --- |
| 三阶段共用 | `{day}`、`{time}`、`{period}`、`{minute}`、`{weather}`、`{place.id}`、`{place.name}`、`{place.region}`、`{place.description}`、`{state}`、`{memories}` |
| 理解行动 | `{player.name}`、`{input}`、`{scene}` |
| NPC 回应 | `{npc.id}`、`{npc.name}`、`{npc.profile}`、`{npc.relationship}`、`{npc.knowledge}`、`{npc.history}`、`{playerName}`、`{resources}`、`{interaction}` |
| 现场生成 | `{player.name}`、`{result}` |

`state`、`memories`、`scene`、`resources`、`interaction`、`result` 为预先格式化的资料段落。普通 JSON 示例可以直接书写；只有 `{变量名}` 形式会被识别为占位符。工具提交要求仍须保留，修改模板不改变程序校验与结算规则。

每个阶段的 system/user 作为一对校验。读取失败、空文件、超过 200000 字符或未知变量时，调用记录显示提示词警告，使用本次宿主运行中该阶段最近有效模板；重启后若文件仍有问题，则使用内置默认模板。修正保存后恢复使用外部模板。回退不会覆盖错误文件。实际发送的提示词仍由原生轨迹保存。

内置默认模板位于 `src/host/prompts/defaults.json`；三个阶段的 TypeScript 文件仅负责提供变量。升级不覆盖用户外部模板；新增上下文变量、工具或规则仍需更新代码。
### 0.6.0：独立 NPC 对话模式

选择生成的交谈选项后，理解行动阶段通过 `tg_enter_dialogue(npcId)` 提议进入独立对话界面；服务重新校验当前选项和人物在场情况后保存模式。进入不替玩家说话、不耗时。非交谈选项仍走原流程；自由输入不自动切换模式。

对话界面显示人物、关系、聊天历史、输入框、取消等待/重试回应及退出按钮。每条消息按说话行动结算 1 分钟，只调用 NPC 回应，不再调用理解行动或现场生成。说“我给你照片”仅记录对白，不实际交付；移动、交付、接受提议须退出后在现场执行。

退出对话不耗时，取消未完成回应并启动一次现场与选项生成。退出时已生效的对白、时间、NPC 回应保留；迟到回复不能再写入。生成失败可重试现场阶段，不重新执行聊天。状态、经历随自动保存和手动存档持久化，旧存档缺省为正常模式。

仍使用原有 `reply.system.md` / `reply.user.md` 外部模板和热更新能力。工具选择和纯对白边界作为运行协议追加到阶段系统提示，不覆盖用户模板。调用记录能看到进入工具和实际阶段消息。`sendDialogue` / `exitDialogue` 使用请求编号及预期状态版本校验。