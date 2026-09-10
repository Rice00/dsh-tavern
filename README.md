> [!IMPORTANT]
> 命令行版每次安装都会独立下载 DSH `0.1.2-rc.1`，不复用或修改全局 DSH。
> Desktop 推荐 **2.0.5**（内置 DSH `0.1.2-rc.1`），不强制锁定；如遇兼容报错，请自行从 [Desktop 历史版本下载页面](https://github.com/anywhere-labs/dsh-desktop/releases) 下载安装推荐版本。DSHA 推荐 **1.2.0-rc1.4**，同样不强制锁定，报错时请从 [DSHA 历史版本下载页面](https://github.com/DSH-APP/DSHA/releases) 下载推荐版本。

# dsh-tavern

**基于 DeepSeek Harness（DSH）制作的 SillyTavern 类文字游戏 Agent。**

它可以直接导入酒馆人物卡，也可以从小说、剧本和人物素材中制作新卡。选一张卡后，你既可以自由游玩，也可以绑定一份剧本，让故事沿着既定主线长期推进。

## 使用文档

**[打开在线文档与功能指南](https://flizzywine.github.io/dsh-tavern/)** · [安装与启动](https://flizzywine.github.io/dsh-tavern/#a02) · [全部功能索引](https://flizzywine.github.io/dsh-tavern/#index)

从产品概览和安装开始，按“酒馆生态兼容 → 游玩模式 → 卡片模式 → 高级功能”逐项查阅。100 个主题配有公开样例截图，可点击放大，也可以下载样例人物卡、世界书、预设和剧本。文档是静态网站，不是在线游戏服务。

![dsh-tavern 整体界面：左侧会话、中间游玩、右侧酒馆状态](docs/images/readme/overview.png)

## 产品功能

### 1. 游玩模式

#### 自由游玩

自由游玩不受固定剧情限制，故事会根据人物卡、世界书和当前对话自然发展。

正文与候选项分开生成。正文只负责讲好故事，候选项则提供多种人物行动和场景变化，不会混入正文。玩家可以直接选择、修改候选，也可以完全自由输入。

自由游玩还支持：

- 独立总结人物姿势，保持人物位置、动作和状态前后一致；
- 注入 Guide，为当前会话添加持续生效的剧情或写作要求；
- 输入意见，重新生成候选项；
- 输入意见，重新生成正文；
- 回退当前回合。

#### 剧本游玩

剧本模式可以为人物卡绑定小说、剧本或故事大纲，让剧本作为故事主线持续牵引剧情。

每一轮只参考当前剧情附近的剧本内容，不会一次性把整份剧本塞给模型。系统会记录当前剧情进度，并根据后续情节推荐更贴近主线的行动。

同时玩家保留偏离剧本的自由。

### 2. 卡片模式

卡片模式是游玩前的对话式资源工作台，用于制作、理解和维护人物卡、世界书、预设与剧本。

新建工作台时，可以直接选择修改人物卡、从剧本新建人物卡、修改剧本、修改世界书、修改预设或空白开始。Agent 会按需阅读相关内容，先与你讨论方案，只有确认后才写入修改。

右侧边栏提供四个独立资源库：

- **人物卡库**：导入、导出和编辑 SillyTavern PNG / JSON 人物卡，管理世界书与剧本绑定；
- **世界书库**：统一管理独立世界书和人物卡内置世界书；
- **预设库**：导入、检查和编辑 SillyTavern 外部预设。日常调整文风、叙事方式与写作规则，建议通过卡片模式写入人物卡，或在游玩中使用 Guide；默认保留内置预设；
- **剧本库**：导入、查看和修改小说、剧情大纲与故事素材，并与人物卡一对一绑定。

这些资源都可以按需引用到卡片对话中；导入时保留原版，Agent 修改的是独立工作版。

支持直接导入 SillyTavern 预设，并在预设库中查看、选择和编辑。外部预设会参与前台请求并可能改变系统行为，仅建议在明确了解其内容和影响时启用。系统内置提示词也可以在右侧“系统提示词”面板中查看、修改、导入、导出或恢复默认。

### 3. 产品特色

#### 无需导入预设

导入人物卡即可开始游玩，建议保持内置预设。要调整写作效果，优先修改人物卡或使用 Guide；外部预设只作为了解其影响后的高级选项。

#### 人物卡美化与 MVU

支持人物卡正则美化与 HTML 展示；支持 MVU，变量由后台 Agent 更新，状态栏常驻右侧面板。

#### 小手机支持

支持已适配的小手机前端，在右侧“酒馆状态”的人物卡应用中打开，与正文并排展示聊天界面。具体第三方脚本的支持范围取决于已适配的接口。

#### 文生图：为剧情生成场景插画

配置并开启场景生图后，可以根据当前剧情和可用状态，手动生成插画。图片显示在对应剧情下，支持带意见重画、切换图片版本和打开大图查看。生图默认关闭，需要单独配置生图服务，费用由所选服务决定。

#### 多平台支持

dsh-tavern 正式支持 Windows、macOS 和 Linux。Windows 与 macOS 可使用 DSH Desktop 客户端，也可以通过命令行运行；Linux 使用命令行运行。Android 可尝试通过 [DSHA](https://github.com/DSH-APP/DSHA) 安装，但属于实验性支持，不保证一定可用。

#### 自由安装插件

Tavern Profile 保持开放。你可以自行编写、安装和组合 DSH 插件；更新 dsh-tavern 时，用户添加的插件与配置会被保留，不会被安装程序整体覆盖。

#### 速度快、消耗低

dsh-tavern 只在需要时注入必要上下文，并把不同任务拆成短而明确的调用，减少无效的 Token 消耗和等待时间。

使用 DeepSeek V4 Flash 测试时，一轮交互平均等待时间约为 15 秒。

#### 文本质量高，AI味少

dsh-tavern 使用尽可能少而精的提示词，把流程和状态交给程序管理，把文字创作留给模型。

减少不必要的格式要求、禁用词和提示词堆叠，保护并激发模型的文字创造力，剧本模式通过剧本文字引导，可以改变模型的文本输出分布，极大压制AI味。

### 界面展示

#### 自由游玩：正文与候选项分开生成

候选项独立展示人物行动与场景变化；右侧可同时查看 Guide 和人物姿势。

![自由游玩的独立候选项、Guide 与人物姿势](docs/images/readme/free-play-candidates.png)

#### 带意见重新生成正文

不满意当前正文时，可以补充指导意见后重新生成并替换。

![输入指导意见重新生成正文](docs/images/readme/rewrite-body.png)

#### 剧本游玩：围绕主线持续推进

右侧展示当前剧本进度、召回片段与人物姿势，正文仍保留玩家自由行动的空间。

![剧本模式的正文、剧情进度与召回片段](docs/images/readme/script-mode.png)

#### 卡片工作台：按任务直接开始

直接选择要处理的资源和任务，也可以空白开始，自由使用完整卡片 Agent。选择“把人物卡转成 MVU 版”会直接启用内置转换 Skill，将容易掉格式的正文状态栏迁移为后台变量结算和固定显示。

![卡片工作台的起始任务](docs/images/readme/card-workbench.png)

#### 侧边栏资源库

人物卡、预设、世界书和剧本各自独立管理，并可直接加入当前卡片对话。

![卡片模式侧边栏中的四个资源库](docs/images/readme/card-libraries.png)

#### 对话式编辑人物卡

在中间与 Agent 讨论修改内容，同时在右侧查看并编辑人物卡字段、世界书与绑定剧本。

![通过对话讨论并编辑人物卡字段](docs/images/readme/card-editor.png)

#### MVU 人物卡：后台变量结算与右侧状态栏

正文下方显示本轮变量更新结果，右侧“酒馆状态”面板持续展示人物卡状态栏。

![MVU 人物卡的变量更新结果与右侧酒馆状态栏](docs/images/readme/mvu-status-panel.png)

#### 人物卡正则美化

把状态文本渲染为正文内的酒馆面板。

![阿芙拉人物卡正则美化效果](docs/images/readme/regex-html-rendering.png)

#### 小手机：与正文并排展示

在右侧人物卡应用中打开小手机，一边阅读剧情，一边查看手机中的聊天内容。

![正文与右侧小手机聊天界面](docs/images/readme/phone-panel.png)

#### 文生图：插画与剧情一起展示

以下使用公开灯塔案例现场生成插画，展示完整游玩界面：正文在上，插画在对应正文下方，右侧保留人物状态栏。插画按可用空间等比例缩放，以适中的预览尺寸展示，点击可查看原图。

![公开灯塔案例的场景插画与完整产品界面](docs/images/readme/scene-image-product.png)

## 首次安装与重新安装

提供桌面版和命令行版两种安装方式。两者使用同一套 Tavern Profile 和数据，请勿同时运行。

**首次安装、更新或重新安装，都运行下面对应的同一条命令。** 已安装时会覆盖更新程序文件，保留人物卡、对话、配置、自定义工具和 Skill，无需先卸载。重新安装前建议备份数据；如果使用了自定义数据或安装目录，请保持原配置。

### DSH Desktop 桌面版（推荐）

适合不想单独配置运行环境和管理服务的用户。推荐使用 [DSH Desktop](https://github.com/anywhere-labs/deepseek-harness-desktop) **2.0.5 版本**（支持 Windows x64 和 macOS，暂不支持 Linux）。

推荐使用 **DSH Desktop 2.0.5**（内置 DSH `0.1.2-rc.1`），其他版本也允许安装。如遇兼容报错，请自行打开 [历史版本下载页面](https://github.com/anywhere-labs/dsh-desktop/releases)，找到 **v2.0.5**，展开 **Assets**，下载适合自己系统的安装包；不要下载 Source code。

安装后，从系统托盘（macOS 菜单栏）打开 **Open DSH Terminal**，运行对应命令：

Windows：

```powershell
$env:DSH_TAVERN_HOST='desktop'; $tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.ps1')); Invoke-Expression $tavernInstaller
```

macOS：

```bash
curl -fsSL https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.sh | DSH_TAVERN_HOST=desktop sh
```

安装完成后，重启 DSH Desktop，并从托盘的 **Profile** 菜单选择 **tavern**。Desktop 会自动管理启停和端口；更新 dsh-tavern 时，在 DSH Terminal 中重新运行上述安装命令即可。

旧版内置更新失败时，也直接运行上面的命令：它会获取最新安装器，绕过本地旧更新脚本。Windows 命令按 UTF-8 解码，避免中文乱码。若仍失败，请提供日志最前面的具体错误和文件路径。

### 命令行版

适合希望通过浏览器访问、自己管理服务的用户。需要 Node.js 22.19 或更高版本。不论电脑是否已有 DSH，安装器都会重新下载一份固定版本的独立 DSH，不复用或修改全局安装。建议安装 Git：安装器会建立持久化稀疏缓存，首次只获取运行文件，后续只拉取变化内容，不下载 `docs/`、文档图片、`demo/`、`references/` 和测试文件；没有 Git 时自动回退到完整 ZIP。

#### Windows

打开 PowerShell，运行：

```powershell
$env:DSH_TAVERN_HOST='cli'; $tavernInstaller=[Text.Encoding]::UTF8.GetString((New-Object Net.WebClient).DownloadData('https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.ps1')); Invoke-Expression $tavernInstaller
```

#### macOS / Linux / WSL2

打开终端，运行：

```bash
curl -fsSL https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@main/install.sh | DSH_TAVERN_HOST=cli sh
```

安装程序会自动安装依赖、启动 dsh-tavern，并在首次安装时打开网页。关闭页面后，运行 `dsh-tavern open` 可重新打开；也可运行 `dsh-tavern status`，复制显示的完整访问地址（含鉴权 token，请勿分享）。不要只输入不带 token 的地址，以免出现鉴权提示。更新时优先使用 Git 增量同步；Git 不可用或同步失败时才下载完整 ZIP。

一键安装及更新、Android 安装默认通过 [npmmirror 国内镜像](https://npmmirror.com/) 下载 npm 依赖，不修改全局 npm 配置。如需使用其他源，在运行安装命令前设置 `DSH_TAVERN_NPM_REGISTRY`：PowerShell 使用 `$env:DSH_TAVERN_NPM_REGISTRY='https://registry.npmjs.org'`，macOS / Linux 使用 `export DSH_TAVERN_NPM_REGISTRY=https://registry.npmjs.org`。

首次使用时，在左侧栏底部打开 **设置 → 模型**，填写模型服务的 API 密钥。

命令行版的运行时、Profile、配置和游戏数据默认位于 `~/.dsh-tavern/`，与外部 DSH 分开。可通过 `DSH_TAVERN_CLI_HOME` 指定位置；安装后启动器会记住该路径。首次升级时会复制旧 CLI 的配置和游戏数据，保留原件；Desktop / DSHA 数据不会自动迁入。Node.js 仍使用系统安装的版本。

#### 手动安装

如果一键命令仍然无法使用：

1. 在 GitHub 项目页点击 **Code → Download ZIP**，或直接下载 [`main.zip`](https://github.com/flizzywine/dsh-tavern/archive/refs/heads/main.zip)；
2. 解压后进入 `dsh-tavern-main` 文件夹；
3. 在这个文件夹中打开 PowerShell（Windows）或终端（macOS / Linux），确认当前目录可以看到 `package.json`；
4. 如果尚未安装 `pnpm`，先运行 `npm install -g pnpm@11.25.0`，然后运行 `pnpm install --frozen-lockfile`。无需手动安装 DSH，下一步会下载独立版本。

5. 命令行版安装并启动：

```bash
pnpm run install:tavern
pnpm run start:tavern
```

然后使用终端显示的完整访问地址，或运行 `dsh-tavern open`。若当前终端尚未识别该命令，可在仓库目录运行 `node ./bin/dsh-tavern.mjs open`。

如果使用 DSH Desktop，请从托盘打开 **DSH Terminal**，在解压目录运行：

```bash
node ./bin/dsh-tavern.mjs install --host desktop
```

然后重启 Desktop，并切换到 **tavern** Profile。

### Android

> **Android 属于实验性支持，不保证一定可用。** 不同手机系统、DSHA 版本、网络和后台限制都可能导致安装或运行失败。

推荐使用 **DSHA 1.2.0-rc1.4**（预览版，内置 DSH `0.1.2-rc.1`）。其他版本也允许使用，不强制锁定；如遇兼容报错，请自行打开 [DSHA 历史版本下载页面](https://github.com/DSH-APP/DSHA/releases)，找到 **v1.2.0-rc1.4**，展开 **Assets**，下载适合手机系统的 APK；不要下载 Source code。

借助 [DSHA](https://github.com/DSH-APP/DSHA)，可以尝试在 Android 手机上运行本项目。首次安装步骤：

1. 安装 DSHA，配置模型并成功启动一次；
2. 打开 DSHA 底部的 **终端**，把下面整条命令复制进去并回车。安装脚本会自行完成下载、配置、校验、启动和失败回滚：

```bash
node -e "fetch('https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@69d74f5/android/setup.sh').then(async r=>{if(!r.ok)throw Error('HTTP '+r.status);require('fs').writeFileSync('/tmp/dsh-tavern-setup.sh',await r.text())}).then(()=>{const r=require('child_process').spawnSync('bash',['/tmp/dsh-tavern-setup.sh'],{stdio:'inherit'});process.exit(r.status??1)}).catch(e=>{console.error(e);process.exit(1)})"
```

3. 如果不会使用终端，也可以打开“创造模式”，完整复制下面这一整段话发给 Agent：

```text
请帮我安装 DSH Tavern。只需要原样执行下面这一条命令，等待它结束，然后把最后的结果告诉我；不要拆解步骤，也不要修改命令：

node -e "fetch('https://cdn.jsdelivr.net/gh/flizzywine/dsh-tavern@69d74f5/android/setup.sh').then(async r=>{if(!r.ok)throw Error('HTTP '+r.status);require('fs').writeFileSync('/tmp/dsh-tavern-setup.sh',await r.text())}).then(()=>{const r=require('child_process').spawnSync('bash',['/tmp/dsh-tavern-setup.sh'],{stdio:'inherit'});process.exit(r.status??1)}).catch(e=>{console.error(e);process.exit(1)})"
```

4. 看到“全部完成”后重启 DSHA，在底部 **启动** 页点 **启动**；显示“已就绪，可进入”后点 **进入**，再从侧栏打开 **酒馆工作台**。

如果点击 **酒馆工作台** 没有反应，但服务已启动，请复制安装完成时显示的**完整酒馆地址**，粘贴到同一台手机的浏览器地址栏打开。默认服务地址为 `http://127.0.0.1:3088`；如果输出地址带有鉴权 token，请完整复制，不要分享。使用期间保持 DSHA 运行。若浏览器仍打不开，请查看 DSHA 终端的启动错误，不要反复点击入口。

需要从手机 Download 目录导入人物卡时，请在 Android 系统设置中允许 DSHA **访问所有文件**；未授权时酒馆会给出提示，并保留系统文件选择器作为备选。

以后更新直接点击酒馆左侧栏底部的 **更新到最新版**。如果酒馆打不开，可在 DSHA 的 **酒馆工作台**入口点击 **更新/修复**。

详细排错见 [Android 安装说明](docs/android-install.md)。

### 命令行版的启动、停止与更新

安装完成后，新开一个终端或 PowerShell。

启动：

```bash
dsh-tavern start
```

停止：

```bash
dsh-tavern stop
```

重启：

```bash
dsh-tavern restart
```

更新：

```bash
dsh-tavern update
```

命令行版的 `dsh-tavern update` 更新插件，并重新安装该版指定的独立 DSH；全局 DSH 的升级不会改变这份运行时。Desktop / DSHA 更新只更新酒馆，保留宿主版本；兼容报错时请自行下载推荐宿主版本。Desktop 版由 DSH Desktop 统一管理启停。

命令行版数据独立保存在 `~/.dsh-tavern/profile-data/tavern/`（自定义安装以实际目录为准）；Desktop / DSHA 使用各自宿主的 Tavern Profile 数据目录。

## 社区交流

欢迎加入 [dsh-tavern Discord 讨论频道](https://discord.com/channels/1134557553011998840/1538577327028445194)，交流使用经验、分享人物卡或反馈问题。

反馈游玩或变量更新问题时，可点击对话顶部的“日志”下载 Session 与 MVU 执行记录；分享前请检查其中的对话和附件隐私。新增执行记录从更新后开始收集，无法补录旧故障。
