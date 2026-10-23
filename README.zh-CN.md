# DSH Session Deck

[English](https://github.com/yiliang114/dsh-session-deck/blob/main/README.md)

**不用离开当前对话，就能掌握所有 DSH 工作区中的会话进展。** Session Deck 在 DeepSeek Harness 原生侧栏中加入 Activity 和 Favorites 视图，让你快速找到运行中的代理、等待回复的会话，以及尚未查看的完成结果。

社区维护的第三方插件，默认英文界面，无额外 npm 依赖、无遥测，采用 [MIT 许可证](LICENSE)。

## 三种视图，一个侧栏

| 视图 | 用途 |
| --- | --- |
| **Activity（活动）** | 跨工作区查看运行中、等待回复、未读和最近会话。 |
| **Favorites（收藏）** | 汇总 DSH 原生置顶会话，随时回到重要任务。 |
| **Workspaces（工作区）** | 使用原生工作区树、管理功能及其他插件提供的菜单。 |

切换视图不会离开当前对话。会话行显示标题、工作区、时间和状态，菜单提供收藏、重命名、分叉、归档和复制 ID 等操作。

*截图来自本地 DSH 安装的英文界面；会话标题和工作区名称已匿名化。*

| Activity | Favorites | Workspaces |
| --- | --- | --- |
| 掌握运行状态和未读结果。 | 回到原生置顶的重要会话。 | 保留完整的工作区操作。 |
| ![英文 Activity 视图](docs/images/activity.png) | ![英文 Favorites 视图](docs/images/favorites.png) | ![英文原生 Workspaces 视图](docs/images/workspaces.png) |

截图使用未打补丁的 DSH 侧栏，视图切换条位于底部；不包含浏览器顶部菜单、标签栏和地址栏。

## 本地安装

**npm 包尚未发布。目前请使用本地仓库或 tarball 安装。** 包名为 **`@yiliang114/dsh-session-deck`**。

环境要求：

- Node.js **22 或以上**。
- DSH Web GUI **0.2.1-rc.2**，这是当前精确适配的宿主版本，其他版本未经验证。
- 已启用 DSH 原生侧栏、会话和工作区插件。

```sh
git clone https://github.com/yiliang114/dsh-session-deck.git
cd dsh-session-deck
npm run verify
dsh plugin --profile web add "link:$PWD" --offline --ignore-scripts
```

项目没有需要安装的依赖，仓库已包含客户端文件；`build` 仅检查 JavaScript 语法，不生成客户端。使用其他 profile 时替换 `web`。链接安装期间请保留仓库目录。

也可以通过 **Plugins → Add plugin → Install a third-party plugin** 安装：输入 `link:/absolute/path/to/dsh-session-deck`，点击 **Install**，然后 **Enable now**，最后刷新页面。

插件自身文案使用英文。要让 DSH 其他界面也显示英文，在 **更多 → 设置 → 通用设置 → 语言** 中选择 **English**。会话标题仍保留用户原来使用的语言。

刷新现有 DSH GUI，然后在侧栏选择 **Workspaces / Activity / Favorites**。原版 DSH 的切换条位于底部；[可选侧栏补丁](#可选将切换条放到列表上方)可将它移到列表上方。修改客户端后也需要刷新，不应假定热更新已启用。

如果已安装本插件的早期本地版本，请先在 DSH 插件管理中停用并移除旧实例，避免同时接管侧栏；浏览器存储可以保留。

### 使用 tarball 安装

不经过 npm 注册表分发时，在仓库根目录执行：

```sh
npm run verify
npm pack --ignore-scripts
```

将生成的归档文件复制到目标机器，再用绝对路径安装：

```sh
dsh plugin --profile web add /absolute/path/yiliang114-dsh-session-deck-0.1.0.tgz --ignore-scripts
```

安装后刷新 GUI。tarball 安装不依赖原仓库目录持续存在，也不会自动应用宿主补丁。

### 后续 npm 安装与市场发现

**只有在 0.1.0 发布并确认可用之后**，才能使用以下命令：

```sh
dsh plugin --profile web add @yiliang114/dsh-session-deck@0.1.0 --ignore-scripts
```

当前[市场索引](market-index.json)为 `plugins: []`，表示**没有已发布条目**，添加索引也不会显示本插件。DSH 自定义插件市场读取用户添加的索引源；发布 npm 不会触发官方 DSH 市场的自动收录。

确认发布且更新索引后，可以在 DSH 自定义插件市场中添加以下直接 JSON 地址：

```text
https://raw.githubusercontent.com/yiliang114/dsh-session-deck/main/market-index.json
```

维护者请参阅[发布指南（英文）](https://github.com/yiliang114/dsh-session-deck/blob/main/docs/releasing.md)，了解首次 npm 发布、OIDC 授权和索引更新。

## 会话状态与边界

- Activity 保留**全部运行中、等待回复和未读会话**，以及最多 **20 条普通最近会话**，按 DSH 的 `updatedAt` 排序，而非最后打开时间。Favorites 不受 20 条限制。
- 收藏直接使用 **DSH 原生置顶数据**，与工作区树同步。归档、子代理和空白会话不单独显示；普通分叉正常显示。
- 状态优先级为**等待回复 → 运行中 → 未读**。已知子代理后代仍在运行时，父会话保持运行状态；普通分叉不会向来源会话传播状态。
- 仅聚合 DSH 会话目录中已知的子代理后代。**独立后台 shell 作业不在跟踪范围内**，会话空闲不代表它启动的所有进程均已退出。
- 会话及已知后代全部停止时，如果你正在查看其他会话，它会标记为未读；打开即清除。持久化记录可恢复刷新期间发生的完成状态，但无法补全所有页面关闭期间完整开始并结束、或从未观察到的运行。
- 归档活动会话需要确认 **Stop and archive（停止并归档）**。插件不提供永久删除；其他插件贡献的完整原生菜单请切回 Workspaces 使用。

## DSH 兼容性与切换条位置

版本匹配和切换条位置是两个独立检查项。插件的 `engines.dsh` 精确声明支持 **0.2.1-rc.2**；这个版本上切换条位于底部，不表示插件过旧或版本不匹配。

| DSH 侧栏 | `sidebar.workspaces.before` | Session Deck 支持情况 |
| --- | --- | --- |
| 官方 **0.2.1-rc.2** | 不存在，切换条回退到底部。 | 已在真实 GUI 验证。 |
| **0.2.1-rc.2** 加下述本地补丁 | 增加在全局面板入口（包括 Automation tasks）下方。 | 补丁脚本接受此版本并检查目标代码。 |
| 官方 **0.2.1-rc.3** | 已发布的客户端及槽位声明中仍不存在。 | 插件整体兼容性尚未验证，当前版本声明不包含它。 |

以上 rc.3 发布文件检查于 **2026-10-23**。仅升级到 rc.3 不会补上这个槽位。补丁修改的是本地 DSH，并非官方更新，也不会随插件安装自动执行。支持其他宿主版本时，需要先验证会话、工作区、槽位和 UI 接口，再扩大 `engines.dsh` 或补丁脚本允许的版本范围。

## 可选：将切换条放到列表上方

DSH 0.2.1-rc.2 尚未在此处提供官方扩展槽位。[侧栏补丁脚本](scripts/patch-sidebar-before.mjs)会在全局面板入口之后、工作区区域之前增加本地 `sidebar.workspaces.before` 槽位。**不打补丁也可正常使用插件**，切换条自动回退到底部。

找到当前运行的 DSH 实际加载的 `@deepseek-ai/dsh-client-ui-sidebar` 包目录，在本仓库中执行以下命令。占位路径应替换为该侧栏包目录，而非 DSH 根目录或本插件目录：

```sh
node scripts/patch-sidebar-before.mjs /path/to/dsh-client-ui-sidebar
node --check /path/to/dsh-client-ui-sidebar/lib/client.js
```

脚本仅接受 **0.2.1-rc.2**，写入前检查两个目标文件，并保存相邻的 `.dsa-before.backup` 备份。支持重复执行，遇到不匹配的代码会拒绝修改。应用后刷新 GUI。

恢复原侧栏：

```sh
node scripts/patch-sidebar-before.mjs /path/to/dsh-client-ui-sidebar --rollback
```

恢复依赖原始备份，并会拒绝覆盖无关改动。刷新后切换条回到底部。DSH 重装或升级可能覆盖补丁，重新应用前请检查兼容性。如果修改的是 DSH 源码仓库，还需重新构建相关客户端产物。

## 隐私与本地存储

插件使用 DSH 的会话和工作区 API，**不发起模型调用、不发送遥测、没有外部上传端点**。

为兼容早期版本，浏览器 `localStorage` 沿用以下键：

| 键 | 内容 |
| --- | --- |
| `dsh-session-activity.mode.v1` | 当前视图。 |
| `dsh-session-activity.pending.v1` | 会话 ID、观察到的运行状态和完成未读元数据。 |

插件不在其中保存会话正文。收藏仍使用 DSH 原生置顶数据。视图和未读状态在同源标签页间同步，不跨设备同步；存储不可用时仅保留在内存中。清除浏览器存储会重置这些元数据。已处理记录最多保留 1,000 条，运行中和未读记录不受此清理上限影响。

停用时，在 DSH 插件管理中禁用或移除 **`@yiliang114/dsh-session-deck`**。移除不会清除浏览器存储，也不会撤销宿主补丁，后者请单独执行恢复命令。

## 开发

```sh
npm run verify
```

该命令依次执行语法检查、会话筛选与状态逻辑的 Node.js 测试，以及打包清单 dry-run 检查。CI 使用 Node.js 22 和 24。没有独立 lint 或 TypeScript 检查；自动检查不能替代真实 DSH GUI 验证。

客户端位于 [lib/client.js](lib/client.js)，另有最小[宿主入口](src/host.mjs)和 [Cordis 配置](cordis.patch.yml)。反馈问题时，请在 [GitHub Issues](https://github.com/yiliang114/dsh-session-deck/issues) 中提供 DSH 版本、安装方式和复现步骤。

## 许可证

[MIT](LICENSE)。本项目独立维护，不属于 DSH 官方内置组件。
