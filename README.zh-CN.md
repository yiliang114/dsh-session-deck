# DSH Session Deck — DeepSeek Harness 会话管理插件

[English](https://github.com/yiliang114/dsh-session-deck/blob/main/README.md) · [npm](https://www.npmjs.com/package/@yiliang114/dsh-session-deck) · [最新发布](https://github.com/yiliang114/dsh-session-deck/releases/latest) · [发布 CI](https://github.com/yiliang114/dsh-session-deck/actions/workflows/publish.yml)

**受 Codex 活动视图启发的 DeepSeek Harness 会话管理插件。** Session Deck 在 DSH 原生侧栏中加入 Activity 和 Favorites 视图，跨工作区查看运行中、等待回复和未读会话，快速处理需要你关注的任务，并随时回到重要对话。

活动视图的交互受到 Codex 启发，并结合 DSH 的工作区、会话状态和原生置顶会话做了适配。Session Deck 是独立的 DSH 社区插件。

社区维护的第三方插件，默认英文界面，无额外 npm 依赖、无遥测，采用 [MIT 许可证](LICENSE)。

## 三种视图，一个侧栏

| 视图 | 用途 |
| --- | --- |
| **Activity（活动）** | 跨工作区查看运行中、等待回复、未读和最近会话。 |
| **Favorites（收藏）** | 汇总 DSH 原生置顶会话，随时回到重要任务。 |
| **Workspaces（工作区）** | 使用原生工作区树、管理功能及其他插件提供的菜单。 |

切换视图不会离开当前对话。会话行显示标题、工作区、时间和状态，菜单提供收藏、重命名、分叉、归档和复制 ID 等操作。

通过 **More（更多）→ Show archived（显示归档）** 查看所有工作区的归档会话。支持按标题、工作区、路径或会话 ID 搜索，点击条目右侧的 **Restore（恢复）** 按钮才会恢复并打开原会话；点击标题或行本身不会恢复。恢复会保留原工作区位置，不会重启已停止的任务或重新置顶。恢复失败时弹窗会显示错误，便于重试。

当你在别处查看时，会话完成会播放一组短促的双音提示，并把结果标记为未读。每个导航标签右上角分别显示小蓝点：Workspaces 和 Activity 对应全部未读会话，Favorites 仅对应收藏中的未读会话，选中哪个标签不会清除其他标签的提示。工作区分组标题保留各自的未读蓝点。浏览器标签页也会在 favicon 右上角加蓝点，并在标题前显示 `(N)`，查看相应会话后自动更新。页面隐藏或窗口失焦且浏览器已授权通知时，同时发送一条静音系统通知；点击通知可回到对应会话。打开某个会话只清除该会话，最后一个未读成员被查看后对应蓝点才消失；展开/折叠分组或切换视图都不会把整组标成已读。

*截图来自本地 DSH 安装的英文界面；会话标题和工作区名称已匿名化。*

| Activity | Favorites | Workspaces |
| --- | --- | --- |
| 掌握运行状态和未读结果。 | 回到原生置顶的重要会话。 | 保留完整的工作区操作。 |
| ![英文 Activity 视图](https://raw.githubusercontent.com/yiliang114/dsh-session-deck/main/docs/images/activity.png) | ![英文 Favorites 视图](https://raw.githubusercontent.com/yiliang114/dsh-session-deck/main/docs/images/favorites.png) | ![英文原生 Workspaces 视图](https://raw.githubusercontent.com/yiliang114/dsh-session-deck/main/docs/images/workspaces.png) |

截图展示无需宿主补丁、自动位于全局面板下方和工作区区域上方的切换条。界面及匿名化后的会话标题使用英文；不包含浏览器顶部菜单、标签栏和地址栏。

## 从 npm 安装

从 [npm](https://www.npmjs.com/package/@yiliang114/dsh-session-deck) 安装最新发布版本。作为历史验证记录，首次发布的 0.1.2 tarball 已在隔离环境中安装，SHA512 完整性校验通过，宿主入口、客户端和补丁文件均已与源码核对；这不代表后续版本已经完成相同验证。

环境要求：

- Node.js **22 或以上**。
- DSH Web GUI **0.2.1-rc.2**，这是当前精确适配的宿主版本，其他版本未经验证。
- 已启用 DSH 原生侧栏、会话和工作区插件。

**从旧安装迁移：**在通过 npm 安装前，请先在 DSH 插件管理中停用并移除旧插件实例，避免两个实例同时接管侧栏；浏览器存储可以保留。

```sh
dsh plugin --profile web add @yiliang114/dsh-session-deck@latest --ignore-scripts
```

使用其他 profile 时替换 `web`。刷新现有 DSH GUI，然后在全局面板下方、工作区区域上方选择 **Workspaces / Activity / Favorites**。在支持的 DSH 0.2.1-rc.2 布局中，插件会自动将切换条放到该位置，无需修改已安装的 DSH 文件。Workspaces 保留原生工作区浏览器。修改客户端后也需要刷新，不应假定热更新已启用。

插件自身文案使用英文。要让 DSH 其他界面也显示英文，在 **更多 → 设置 → 通用设置 → 语言** 中选择 **English**。会话标题仍保留用户原来使用的语言。

### 备选：链接本地仓库

```sh
git clone https://github.com/yiliang114/dsh-session-deck.git
cd dsh-session-deck
npm run verify
dsh plugin --profile web add "link:$PWD" --offline --ignore-scripts
```

项目没有需要安装的依赖，仓库已包含客户端文件；`build` 仅检查 JavaScript 语法，不生成客户端。链接安装期间请保留仓库目录。

也可以通过 **Plugins → Add plugin → Install a third-party plugin** 安装：输入 `link:/absolute/path/to/dsh-session-deck`，点击 **Install**，然后 **Enable now**，最后刷新页面。

### 备选：使用 tarball 安装

不经过 npm 注册表分发时，在仓库根目录执行：

```sh
npm run verify
npm pack --ignore-scripts
```

将生成的归档文件复制到目标机器，再用绝对路径安装。将 `VERSION` 替换为 `npm pack` 输出文件名中的版本号：

```sh
dsh plugin --profile web add /absolute/path/yiliang114-dsh-session-deck-VERSION.tgz --ignore-scripts
```

安装后刷新 GUI。tarball 安装不依赖原仓库目录持续存在。链接和 tarball 两种安装方式都会在支持的 rc.2 布局中自动将切换条放到工作区区域上方，无需宿主补丁。

### 自定义插件市场

[市场索引](https://raw.githubusercontent.com/yiliang114/dsh-session-deck/main/market-index.json)列出已通过注册表验证的 npm 发布版本。在 DSH 自定义插件市场中添加以下原始 JSON 地址作为索引源：

```text
https://raw.githubusercontent.com/yiliang114/dsh-session-deck/main/market-index.json
```

这是**用户自行添加的自定义市场源**，并非 DSH 官方收录。发布 npm 不会自动将插件加入官方 DSH 市场。

维护者：推送到 `main` 会自动排队发布补丁版本（例如 `0.1.2` → `0.1.3`）。连续快速推送可能合并处理：过时的排队任务跳过，最新可执行任务包含累计改动。需要手动选择次版本时，执行 `npm version minor --no-git-tag-version`，再正常提交并推送；显式指定的更高稳定版本（例如 `0.2.0`）会保留，下一次发布为 `0.2.1`。工作流负责验证、版本提交和标签、带 provenance 的发布、市场索引更新和 GitHub Release。认证前提与失败恢复请参阅[发布指南（英文）](https://github.com/yiliang114/dsh-session-deck/blob/main/docs/releasing.md)。

## 会话状态与边界

- Activity 保留**全部运行中、等待回复和未读会话**，以及最多 **20 条普通最近会话**，按 DSH 的 `updatedAt` 排序，而非最后打开时间。Favorites 不受 20 条限制。
- 收藏直接使用 **DSH 原生置顶数据**，与工作区树同步。Activity 和 Favorites 不单独显示归档、子代理和空白会话；普通分叉正常显示。**Show archived（显示归档）** 列出全部已知归档会话，包括已归档的空白会话和子代理，不受 20 条限制。
- 状态优先级为**等待回复 → 运行中 → 未读**。已知子代理后代仍在运行时，父会话保持运行状态；普通分叉不会向来源会话传播状态。
- 仅聚合 DSH 会话目录中已知的子代理后代。**独立后台 shell 作业不在跟踪范围内**，会话空闲不代表它启动的所有进程均已退出。
- 会话及已知后代全部停止时，如果你正在查看其他会话，它会标记为未读；打开即清除；开始新一轮运行也会清除上一轮结果的未读标记。从原生 Workspaces 列表进入会话时，已读确认不等待完成状态观察的排队锁。持久化记录可恢复刷新期间发生的完成状态，但无法补全所有页面关闭期间完整开始并结束、或从未观察到的运行。
- 每次实际观察到的完成最多播放一次插件提示音，并在后台且已授权时附加一条静音系统通知；刷新、恢复历史未读和仅子代理结束都不会补发提示，但下一轮完整运行仍会产生新提示。等待用户交互不算完成。通过 Session Deck 归档引起的停止会被抑制；原生或外部归档若先收到停止状态、后收到归档成员更新，仍可能被识别为手动停止。同源标签页在支持 Web Locks 时串行执行完成状态观察和提醒投递；共享存储不可用或不支持锁时仅尽力去重，不承诺严格一次。
- 提示音保持中性，不宣称成功：当前客户端状态无法区分正常完成、失败和手动停止。声音在本地合成，默认开启。可在自己使用的浏览器点击 **More → Enable and test sound（开启并试听提示音）**，启用声音并通过用户手势试听；结果只确认播放已启动，不代表扬声器实际可闻。前后台都由插件播放提示音，系统通知设为静音，避免重复发声。浏览器自动播放限制可能要求先点击页面或按键。系统通知仅在浏览器站点设置中已授权时发送；插件不请求外部推送权限，也不跟踪单条聊天消息。
- Workspaces、Activity 和浏览器标签页反映所有符合条件的未读会话（不是聊天消息条数），Favorites 只反映其中已收藏的会话；页面标题显示完整数量。工作区蓝点按完整的工作区成员关系汇总同一批会话，不依赖当前渲染或截断的会话行。平面和树状视图都只统计直接成员；折叠的树状祖先不会汇总后代未读。页面隐藏或当前打开其他全局面板时，不算已查看会话。
- 归档活动会话需要确认 **Stop and archive（停止并归档）**。插件不提供永久删除；其他插件贡献的完整原生菜单请切回 Workspaces 使用。

## DSH 兼容性与切换条位置

插件的 `engines.dsh` 精确声明支持 **0.2.1-rc.2**。自动顶部定位使用针对该版本的 DOM 兼容适配层，并非 DSH 官方扩展 API。

| DSH 侧栏 | 定位方式 | Session Deck 支持情况 |
| --- | --- | --- |
| 官方 **0.2.1-rc.2**，未打补丁 | 没有官方 `sidebar.workspaces.before` 槽位；适配层默认将切换条放到工作区区域上方。 | 当前支持目标，严格检查 rc.2 DOM 结构。 |
| **0.2.1-rc.2** 加旧版本地补丁 | 复用全局面板下方已有的 `sidebar.workspaces.before` 槽位。 | 兼容，但已不再需要补丁。 |
| 官方 **0.2.1-rc.3** | 已发布的客户端及槽位声明中仍没有 before 槽位。 | 不支持：整体兼容性未经验证，精确版本声明不包含它。 |

识别到 rc.2 布局时，适配层在工作区区域紧前方、Automation tasks 等全局面板下方插入自己的 DOM 容器，通过 React portal 渲染切换条。它不会写入已安装的 DSH 文件，也不会替换原生工作区浏览器。遇到未知 DOM 布局时回退到底部。停用插件会移除其限定范围的观察器和 DOM 容器。

rc.2 的 More 菜单同样没有菜单项扩展槽位。Session Deck 仅在原生账号按钮和菜单结构匹配该版本时，通过自己的 portal 容器在 Settings 下方插入入口。原生设置、反馈、账号操作和键盘导航保持可用；未知或存在歧义的布局会回退为底部的 **Show archived** 按钮。停用插件会清理菜单容器及观察器。

工作区分组标题也没有装饰槽位。未读蓝点由一个严格识别原生项目行及其真实 `workspace:<id>` 键的适配器添加；它只拥有自己的 6px 标记，会清理退出动画副本里的标记，不使用标题或路径识别分组。未知布局不会改动原生树，Activity、提示音和会话跳转仍然可用。常驻的完成观察器使用官方 `shell.overlay` 槽位。

rc.3 发布文件检查于 **2026-10-23**，该检查不能证明插件兼容。支持其他宿主版本时，需要先验证会话、工作区、槽位、UI 接口及 DOM 布局，再扩大 `engines.dsh` 的版本范围。

## 旧版侧栏补丁回滚

[侧栏补丁脚本](scripts/patch-sidebar-before.mjs)保留用于回滚和向后兼容，新安装无需执行。如果之前安装过本地 before 槽位补丁，插件可以继续复用该槽位，也可以恢复原侧栏。

找到当前运行的 DSH 实际加载的 `@deepseek-ai/dsh-client-ui-sidebar` 包目录，在本仓库中执行以下命令。占位路径应替换为该侧栏包目录，而非 DSH 根目录或本插件目录：

```sh
node scripts/patch-sidebar-before.mjs /path/to/dsh-client-ui-sidebar --rollback
```

恢复依赖原始的相邻 `.dsa-before.backup` 备份，并会拒绝覆盖无关改动。回滚后刷新 GUI：在支持的未打补丁 rc.2 布局中，新插件仍会将切换条放到工作区区域上方。如果回滚的是 DSH 源码仓库，还需重新构建相关客户端产物。

## 隐私与本地存储

插件使用 DSH 的会话和工作区 API，**不发起模型调用、不发送遥测、没有外部上传端点**。

为兼容早期版本，浏览器 `localStorage` 沿用以下键：

| 键 | 内容 |
| --- | --- |
| `dsh-session-activity.mode.v1` | 当前视图。 |
| `dsh-session-activity.pending.v1` | 会话 ID、观察到的运行状态和完成未读元数据。 |
| `dsh-session-activity.notified.v1` | 每个会话最近一次已投递通知的版本，用于避免同源标签页重复提醒。 |
| `dsh-session-activity.sound.v1` | 完成提示音是否开启。 |

插件不在其中保存会话正文。收藏仍使用 DSH 原生置顶数据。视图和未读状态在同源标签页间同步，不跨设备同步；存储不可用时仅保留在内存中。清除浏览器存储会重置这些元数据。已处理记录最多保留 1,000 条，运行中和未读记录不受此清理上限影响。

停用时，在 DSH 插件管理中禁用或移除 **`@yiliang114/dsh-session-deck`**。停用会移除适配层的观察器和 DOM 容器，并恢复原生工作区浏览器。移除不会清除浏览器存储，也不会撤销旧版宿主补丁；如需撤销，请单独执行恢复命令。

## 开发

```sh
npm run verify
```

该命令依次执行语法检查、会话筛选与状态逻辑的 Node.js 测试，以及打包清单 dry-run 检查。CI 使用 Node.js 22 和 24。没有独立 lint 或 TypeScript 检查；自动检查不能替代真实 DSH GUI 验证。

客户端位于 [lib/client.js](lib/client.js)，另有最小[宿主入口](src/host.mjs)和 [Cordis 配置](cordis.patch.yml)。反馈问题时，请在 [GitHub Issues](https://github.com/yiliang114/dsh-session-deck/issues) 中提供 DSH 版本、安装方式和复现步骤。

## 许可证

[MIT](LICENSE)。本项目独立维护，不属于 DSH 官方内置组件。
