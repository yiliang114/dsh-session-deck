# DSH Session Deck

在 DeepSeek Harness（DSH）原生侧栏中，集中查看跨工作区的会话、运行状态、未读结果与收藏。

项目尚未发布到 npm，当前保留 `private: true` 发布保护。仓库名为 `dsh-session-deck`；为兼容已有安装和浏览器数据，内部包名、插件 ID 和存储键暂时保留 `dsh-session-activity`。

这是使用 DSH 原生插件机制的第三方插件，不是 DSH 官方内置组件。**安装使用不要求发布 npm**：本地开发可使用 `link:`，分发可使用 npm tarball；发布 npm 后才可通过注册表包名安装。

## 功能

| 视图 | 用途 |
| --- | --- |
| 工作区 | 使用 DSH 原生工作区树，保留原生管理和其他插件贡献的菜单 |
| 活动 | 汇总跨工作区的运行中、等待回复、未读及最近会话 |
| 收藏 | 汇总 DSH 原生置顶会话，与工作区树的置顶状态同步 |

三个视图共用原有侧栏区域，切换视图不会改变当前对话。

- 活动列表按宿主 `updatedAt` 降序排列，保留全部运行中、等待回复和未读会话，以及最多 20 条普通最近会话。该时间不是最后打开会话的时间。
- 收藏展示全部符合条件的置顶会话，不受最近 20 条限制。
- 会话以两行显示标题和工作区；右侧显示时间、旋转运行图标、琥珀色等待点或蓝色未读点。状态优先级为等待回复、运行中、未读。
- 悬停或键盘聚焦后显示归档按钮和更多菜单；触屏设备保留操作按钮。菜单支持收藏、重命名、分叉、归档和复制会话 ID。
- 已知子代理仍在运行时，父会话保持运行状态；打开会话会自动清除完成未读标记。

归档会话、子代理会话和空白会话不单独出现在列表中；普通分叉会话正常显示。

## 环境要求

- Node.js **22 或以上**。
- DSH Web GUI；当前适配版本为 **0.2.1-rc.2**，其他版本尚未验证。
- 已启用 DSH 原生侧栏、会话和工作区插件。

本插件没有额外 npm 依赖，仓库已包含可直接加载的客户端文件。

## 本地安装

在仓库根目录执行：

```sh
npm run build
npm test
dsh plugin --profile web add "link:$PWD" --offline --ignore-scripts
```

上面的命令面向 `web` profile；使用其他 profile 时替换名称。通过本地链接安装后，需要保留仓库目录。完成安装或修改客户端后，刷新现有 DSH GUI；不要假定开发热更新已启用。

首次使用时，从侧栏的 **工作区 / 活动 / 收藏** 切换视图。原版 DSH 中切换条位于侧栏底部；需要放到全局入口下方、会话列表上方时，可应用下面的可选补丁。

## 分发与 npm 发布

### 不经过 npm 注册表分发

在仓库根目录验证并打包：

```sh
npm run verify
npm pack --ignore-scripts
```

当前版本生成 `dsh-session-activity-0.1.0.tgz`。把文件复制到目标机器后，使用其绝对路径安装：

```sh
dsh plugin --profile web add /absolute/path/dsh-session-activity-0.1.0.tgz --ignore-scripts
```

tarball 包含宿主入口、已就绪的客户端、Cordis 配置、README 和可选补丁脚本，不需要构建依赖，也不会自动执行宿主补丁。安装后刷新 GUI。与 `link:` 不同，tarball 安装不依赖原仓库目录持续存在。

### 准备公开发布

1. 确认仓库可以公开，选择许可证、添加 `LICENSE` 并同步 `package.json` 的 `license` 字段。公开源码和授予开源使用权限是两件事。
2. 确认 npm 包名的可用性和发布权限。当前包名为 `dsh-session-activity`，尚未确认可用；若更名，需同步 Cordis 配置和客户端中的包标识，不能只改仓库名。
3. 移除 `package.json` 的 `private: true`，更新版本号；保留实际验证过的 `engines.dsh` 兼容范围。
4. 运行 `npm run verify`、`npm pack --dry-run`，并用 tarball 在目标 DSH 版本上验证工作区/活动/收藏切换、未读状态和会话菜单。
5. 通过有权限的 npm 账号执行 `npm publish --access public`，再验证安装。本文中的发布命令是维护者操作说明，当前 CI 不执行发布。

首次发布成功后，用户才可以使用下面的命令（当前不能假定注册表已有此包）：

```sh
dsh plugin --profile web add dsh-session-activity@0.1.0 --ignore-scripts
```

如果后续采用自动发布，建议单独添加发布工作流，由版本 tag 或 GitHub Release 触发，验证 tag 与包版本一致后再发布。优先配置 npm Trusted Publishing（OIDC），将授权限定到本仓库的发布工作流；发布 job 才需要 `id-token: write`，并应使用 npm 当时要求的 Node.js/npm 版本。首次创建包及 Trusted Publisher 绑定按 npm 的当前流程完成。普通 PR CI 不应拥有 npm 凭据或发布权限。

## 可选：将切换条放到列表上方

DSH 0.2.1-rc.2 尚未提供该位置的扩展槽位。本仓库的 [侧栏补丁脚本](scripts/patch-sidebar-before.mjs) 会向已安装的侧栏包增加 `sidebar.workspaces.before`，位置在所有全局面板入口之后、工作区区域之前。

这是**本地宿主补丁，并非 DSH 已发布的官方接口**。不应用补丁也可正常使用插件，切换条会显示在底部。

先找到正在运行的 DSH 所使用的 `@deepseek-ai/dsh-client-ui-sidebar` 包目录，再从本仓库根目录执行以下命令。将示例路径替换为实际包目录，不是 DSH 根目录或本插件目录：

```sh
node scripts/patch-sidebar-before.mjs /path/to/dsh-client-ui-sidebar
node --check /path/to/dsh-client-ui-sidebar/lib/client.js
```

脚本仅接受 `0.2.1-rc.2`，写入前检查两个目标文件的代码锚点，并保存相邻的 `.dsa-before.backup` 备份。支持重复执行；遇到不匹配的代码会拒绝修改。应用后刷新 GUI。

恢复原侧栏：

```sh
node scripts/patch-sidebar-before.mjs /path/to/dsh-client-ui-sidebar --rollback
```

恢复操作依赖原始备份；目标文件存在其他改动时，脚本会拒绝覆盖。恢复后刷新 GUI，插件回到底部位置。

DSH 重装或升级可能覆盖补丁。升级后先检查兼容性；不要绕过版本检查强行应用。侧栏槽位不存在时，插件自动使用底部位置。若修改的是 DSH 源码而非已发布包，还需重新构建对应客户端产物。

## 会话状态与操作

### 完成未读

会话自身及其已知子代理后代全部停止后，如果该会话未在主视图中打开，就标记为未读。打开会话即清除标记，没有手动确认按钮；正在查看的会话完成时不会产生未读。

插件会保存已观察到的运行基线，因此刷新期间停止的会话仍可恢复未读状态。已有但从未观察到、也没有宿主未读信号的历史空闲会话，不会被推断成未读。

### 子代理与后台任务

运行状态沿宿主提供的子代理父子关系向上传播，支持多层子代理；普通分叉不会把运行状态传播给来源会话。仅能跟踪宿主会话目录中的已知子代理，缺失或外部子代理无法推断。

**独立后台 shell 作业不计入此聚合状态。** 它们使用独立的 jobs API，本插件没有订阅这些作业。因此，会话空闲并不代表它启动过的所有后台进程均已退出。

### 归档与完整菜单

归档运行中的会话会先出现“停止并归档”确认；取消不会停止任务。本插件不提供永久删除。

其他插件贡献的原生菜单项，可通过“切回工作区 · 完整操作”访问。活动和收藏模式不会重新声明原生工作区树独占的菜单槽位。

## 数据与隐私

插件通过 DSH 的会话和工作区接口读取状态并执行用户操作，没有额外的遥测或外部上传端点，不发起模型调用。

浏览器 `localStorage` 保存：

- `dsh-session-activity.mode.v1`：当前视图。
- `dsh-session-activity.pending.v1`：会话 ID、运行基线和完成未读元数据。

收藏使用 DSH 原生置顶数据，不另存一份收藏列表。浏览器存储中的元数据不包含会话正文，但会包含会话 ID。

同源标签页同步视图和未读状态，不跨设备同步。存储不可用时退化为内存状态；清除浏览器存储会重置本插件保存的数据。已处理元数据最多保留 1000 条，运行中和未读记录不受此清理上限影响。所有页面关闭期间完整开始并结束的运行无法回填。

## 常见问题

**为什么切换条仍在底部？**

这是未应用侧栏补丁时的正常位置。确认补丁作用于当前 DSH 实际加载的侧栏包，并刷新页面。

**为什么某个会话没出现在活动列表？**

先检查是否已归档、属于子代理或没有可显示内容。普通最近会话最多保留 20 条；需要长期关注的会话可以收藏。

**为什么父会话仍在转圈？**

宿主目录中的某个已知子代理可能仍在运行。活动和收藏使用相同的聚合规则。

**如何停用？**

在 DSH 插件管理中停用或移除 `dsh-session-activity`。如果应用过侧栏补丁，可按上面的恢复步骤单独撤销；停用插件不会自动恢复宿主文件，也不会主动清除浏览器存储。

## 开发与验证

```sh
npm run verify
```

统一验证命令依次执行：

- `npm run build`：检查宿主入口、客户端和维护脚本的 JavaScript 语法，不生成新的客户端文件。
- `npm test`：使用 Node.js 内置测试运行器和真实客户端逻辑，覆盖筛选、收藏、未读持久化、跨标签页合并与子代理聚合。
- `npm run check:package`：使用 `npm pack --dry-run --json --ignore-scripts` 检查分发文件清单，确保导出入口与 Cordis 配置均在包内，阻止测试、CI 配置和其他非分发文件混入。此步骤不生成 tarball，也不发布 npm。

项目没有 npm 依赖，无需先执行 `npm install`，也没有依赖锁文件。引入依赖时，应提交锁文件，并在 CI 中加入 `npm ci`。目前未配置独立 lint 或 TypeScript typecheck；语法检查和逻辑测试不能替代真实 GUI 交互验证。

### GitHub Actions

[CI 工作流](.github/workflows/ci.yml) 在指向仓库的 PR、推送到 `main` 及手动触发时执行，在 Ubuntu 上分别使用 Node.js 22 和 24 运行 `npm run verify`。它仅授予 `contents: read` 权限，不需要 Secrets，也不安装或修改运行中的 DSH。相同 PR 或分支的新运行会取消旧运行。

维护者需要在仓库 **Settings → Actions → General** 中允许 GitHub Actions 以及 `actions/checkout`、`actions/setup-node`。工作流首次运行后，可在 `main` 的分支保护或 Ruleset 中将 `Verify (Node 22)` 和 `Verify (Node 24)` 设为必需检查。私有仓库的 Actions 配额和分支保护可用性取决于 GitHub 账户方案。

CI 校验的是插件源码与打包清单，不代表已经在多个 DSH 版本完成兼容测试；目前宿主适配范围仍为 `0.2.1-rc.2`。

| 文件 | 作用 |
| --- | --- |
| [lib/client.js](lib/client.js) | 客户端视图、选择器与状态存储，手写 ModuleLoader 包 |
| [src/host.mjs](src/host.mjs) | 最小宿主入口 |
| [cordis.patch.yml](cordis.patch.yml) | DSH 插件安装配置 |
| [test/selection.test.mjs](test/selection.test.mjs) | 状态与筛选回归测试 |
| [scripts/patch-sidebar-before.mjs](scripts/patch-sidebar-before.mjs) | 可选侧栏槽位补丁及恢复工具 |

客户端使用根级 `useSessions`、`useSessionStatus`、`useWorkspaces` hooks。活动和收藏以更高优先级注册 `sidebar.workspaces`；切回工作区时释放注册，由原生工作区树接管。运行状态通过同一聚合逻辑驱动行状态与完成未读判断。

## 项目状态与许可证

目前用于私有开发，包配置保留 `private: true`。尚未选择开源许可证，仓库暂不包含 `LICENSE`；公开发布前需先明确授权条款。
