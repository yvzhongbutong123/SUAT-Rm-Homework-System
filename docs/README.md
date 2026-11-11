# RoboMaster 战队作业管理 · 设计与使用说明

> 一个以 **GitHub 仓库（Rm-Homework）为唯一数据源** 的战队作业管理系统。
> 组长端（Web 后台）+ 组员端（Web 前端）运行在同一个桌面客户端内，打包为 Windows 便携版 `exe`。

---

## 1. 功能一览

| 模块 | 能力 |
| --- | --- |
| 登录 | GitHub Token 登录；GitHub OAuth 设备码登录（可选）；**组长兑换码 `pxr20080819Q`**；**队长兑换码 `1145141919810`**；离线演示模式；**记住账号 / 自动登录 / 一键切换** |
| 角色 | 组长 / 组员，由 `members.json` 决定；组长可在成员管理中分配分组与角色 |
| 分组 | 算法组（algo）、机械组（mech）、嵌入式组（embedded）；**作业内容、提交目录、统计与批改按组隔离** |
| 组长权限 | 队长管理全队；组长管理自己负责的小组；组员只能查看/提交本组 |
| 队长端 | 兑换队长码后获得全队管理权限：三组看板、发布各组作业、批改所有提交、任命/撤销组长、调整任意成员分组、**指定当前周** |
| 周次管理 | **当前周**默认取最新周次，队长可手动指定；当前周**仅队长可编辑**（组长只读）；**作业与提交始终按小组隔离**，除队长外只能查看本组（无论当期或往期） |
| 进组提醒 | 未分组组员登录后，队长与所有组长都会在右下角收到「未进组」提醒，可一键认领到本组 |
| 组员端 | 按分组展示 `weekNN/README.md` 与分组补充说明；**整个文件夹拖拽上传**，自动以 GitHub 账号命名；成绩弹窗提醒；我的成绩 |
| 组长端 | 实时提交情况、三组进度看板（提交率 / 平均分 / 待批改）、**布置作业**（在线编写 WeekNN.md 并推送）、一键下载作业 ZIP、在线打分生成 `evaluation.json`、成员管理 |
| 存储 | GitHub Git 仓库；**WSL Git 优先，Windows Git 自动回退**；预留 OSS / 网盘接口 |
| 通知 | 组员在线轮询（默认 25 秒）：发现新批改弹出分数与评语；发现组长发布新作业弹出发布提示 |

---

## 2. 架构

### 2.0 运行形态

同一套业务服务与前端有两种承载方式：

| 形态 | 入口 | 说明 |
| --- | --- | --- |
| **独立 exe（当前交付）** | `src/web/start.js` → `dist/RM-Homework-1.0.1.exe` | Node SEA 打包，不依赖 Chromium；启动本地服务并自动打开默认浏览器。兼容性最好。 |
| 桌面壳（Electron） | `src/main/main.js` | 原生窗口 + 无边框标题栏 + IPC 文件夹上传。部分 Windows 11 预览版 / 虚拟机环境会让 Chromium 启动崩溃（0xC0000005），因此不作为默认交付。 |

两种形态共用 `AppServices`、`LocalServer`、`src/renderer` 的全部代码；前端通过 `window.rmh` 是否存在自动切换上传/下载方式。


```
┌──────────────────────────────── Electron 桌面客户端 ────────────────────────────────┐
│                                                                                     │
│  ┌──────────────┐     HTTP (127.0.0.1 随机端口 + 随机 API Key)     ┌───────────────┐  │
│  │  渲染进程     │ ◄────────────────────────────────────────────► │  本地服务      │  │
│  │  原生 HTML/JS │                                                │  node:http     │  │
│  │  组员端/组长端 │                                                │  业务服务层     │  │
│  └──────────────┘                                                └───────┬───────┘  │
│         │ IPC（文件夹选择 / 导出 / 窗口控制）                              │          │
│         ▼                                                                ▼          │
│  ┌──────────────┐                                                ┌───────────────┐  │
│  │  preload     │                                                │  存储抽象层     │  │
│  │  contextBridge│                                               │  StorageProvider│ │
│  └──────────────┘                                                └───┬───────┬───┘  │
│                                                                      │       │      │
│                                                        ┌─────────────┘       └──┐   │
│                                                        ▼                        ▼   │
│                                              ┌──────────────────┐      ┌──────────┐ │
│                                              │ GitRepoStorage   │      │ DemoStorage│ │
│                                              │ (WSL / Windows)  │      │ 本地演示   │ │
│                                              └────────┬─────────┘      └──────────┘ │
└───────────────────────────────────────────────────────┼──────────────────────────────┘
                                                        │ git fetch / commit / push
                                                        ▼
                                          GitHub 仓库  <owner>/Rm-Homework
```

### 2.1 为什么是「Electron + 本地 HTTP + 原生前端」

- **桌面 exe**：满足交付形态；可直接调用本地 Git、访问任意磁盘目录（文件夹上传）、安全存取 Token。
- **本地 HTTP 服务**：业务逻辑与界面解耦，前端只是普通 Web 页面；未来可把服务部署到服务器，前端原样复用。
- **零构建前端**：原生 ES Modules + CSS，不引入打包器，降低构建失败风险，也便于二次开发。
- **存储抽象**：`StorageProvider` 接口统一 `pull / mutate / readJson / listDir / exportZip`，Git 后端与演示后端实现同一套契约；新增 OSS 后端只需实现该接口。

### 2.2 目录结构（源码）

```
src/
├─ main/                        Electron 主进程
│  ├─ main.js                   窗口、单实例、IPC、生命周期
│  ├─ server.js                 本地 HTTP API + 静态资源
│  ├─ settings.js               设置与 safeStorage 加密 Token
│  ├─ git.js                    Git 执行层（WSL 优先 / Windows 回退）
│  ├─ github.js                 GitHub REST API（含设备码流程）
│  ├─ zip.js                    无依赖 ZIP 写入器
│  ├─ util.js                   路径安全、串行队列、工具
│  ├─ services/app.js           认证 / 周次 / 提交 / 批改 / 统计 / 通知
│  └─ storage/
│     ├─ index.js               存储工厂
│     ├─ fs-store.js            文件级存储基类
│     ├─ demo-seed.js           演示数据与仓库模板
│     └─ providers/
│        ├─ git-repo.js         GitHub Git 后端（拉取→修改→提交→推送，冲突自动重试）
│        ├─ demo.js             本地演示后端
│        └─ oss.js              OSS / 网盘接口（预留）
├─ preload/preload.js           contextBridge 安全桥
└─ renderer/                    前端（原生 ES Modules）
   ├─ index.html
   ├─ css/app.css
   └─ js/
      ├─ app.js                路由、外壳、轮询、通知
      ├─ api.js / ui.js / markdown.js
      └─ views/                login / member / leader / settings
```

---

## 3. 仓库结构（Rm-Homework）

```
Rm-Homework/
├─ README.md
├─ teams.json                 战队名、三个分组（含文件夹名）、兑换码
├─ members.json               成员 → 角色 / 分组（组长也带分组）
├─ week01/
│  ├─ README.md               通用说明（可选，队长编辑）
│  ├─ meta.json               { title, deadline, publishedAt, current, tags }
│  ├─ 算法组/
│  │  ├─ README.md            算法组作业（组长/队长编辑，其他组不可见）
│  │  └─ submissions/
│  │     └─ alice/            文件夹名 = 组员 GitHub 账号
│  │        ├─ …作业文件…
│  │        ├─ submission.json
│  │        └─ evaluation.json
│  ├─ 机械组/
│  │  ├─ README.md
│  │  └─ submissions/carol/
│  └─ 嵌入式组/
│     ├─ README.md
│     └─ submissions/frank/
├─ week02/ …
└─ week03/ …
```

> 组文件夹名默认取中文组名（`算法组 / 机械组 / 嵌入式组`），可在 `teams.json` 的 `groups[].folder` 中修改。
> 兼容旧结构：仍会读取 `weekNN/groups/<group>/README.md`、`weekNN/submissions/<group>/<login>/`、`weekNN/<group>.md`，但新内容写入中文组名目录。

### 新增一周作业

**方式一：客户端内（推荐）**

队长/组长 → **布置作业** → 选择「新建周次」或打开已有周次 → 编写 Markdown（支持工具栏与实时预览）→ 填写标题/截止时间/标签 → **保存并发布**。
保存后会自动写入并推送到仓库：

- `weekNN/算法组/README.md`、`weekNN/机械组/README.md`、`weekNN/嵌入式组/README.md`：各组独立作业
- `weekNN/README.md`：通用说明（队长可编辑）
- `weekNN/meta.json`：标题、截止时间、发布时间、当前周标记
- `weekNN/<组名>/submissions/`：各组提交目录

组员端在下一次同步（默认 25 秒）时，右下角会弹出「新作业已发布」提示。

**方式二：直接改仓库**

1. 在仓库中新建 `weekNN/` 目录（两位数字，如 `week04`）。
2. 放入 `README.md`（可选通用说明）、可选 `meta.json`、以及 `算法组/README.md` 等组作业。
3. 客户端下次同步即可看到，无需发版。

### `evaluation.json` 结构

```json
{
  "version": 1,
  "week": "week01",
  "member": "alice",
  "group": "algo",
  "score": 92,
  "comment": "标定流程完整，重投影误差控制得很好……",
  "gradedBy": "rm-leader",
  "gradedAt": "2026-11-13T10:12:00+08:00"
}
```

---

## 4. 快速开始

### 4.1 离线演示（无需 GitHub）

打开客户端 → 登录页选择「组长视角」或「组员视角」→ 立即进入完整界面。
演示数据保存在本机 `%APPDATA%\RMHomework\data\demo-repo`，可随意批改、提交，不会触网。

### 4.2 真实使用

**组长（首次）**

1. 在 GitHub 生成 Token：`Settings → Developer settings → Personal access tokens`，勾选 **repo**。
2. 登录页选择「组长兑换码」，填入 Token 与 `pxr20080819Q`，并确认仓库地址为 `git@github.com:yvzhongbutong123/SUAT-Rm-Homework.git`。
3. 若本机没有可用的 SSH Key，客户端会自动改用 `https://github.com/...` + Token 访问（界面会提示）。
4. 在「成员管理」中为成员分配分组；未进组的组员会触发全体组长提醒。

**分组与权限**

- 成员记录中的 `role` + `group` 决定权限：
  - `captain`：**队长**，全队管理权限（三组看板/发布/批改、任命或撤销组长、调整任意成员分组）；队长账号不可被其他角色管理或降级，只能通过队长兑换码产生；
  - `leader`：**组长**，管理自己负责的小组（成员、作业、批改）；未分配小组时按全队处理，但查看/布置组作业需先分配小组；
  - `member` + `group`：组员，只能看到本组作业与自己的提交；
  - `member` + `group: null`：未进组，登录后不能提交，队长与组长会收到提醒。
- 兑换码：组长码 `pxr20080819Q` → 组长；队长码 `1145141919810` → 队长。兑换结果写入 `members.json` 并强校验。
- **当前周**：`meta.json` 中 `current: true` 的周次；没有标记时取编号最大的周次。队长可在「布置作业」页点「设为当前周」。当前周的作业只能由队长编辑，组长只读；历史周允许组长继续维护本组内容。
- **作业可见性**：作业与提交**始终按小组隔离**。除队长外，组员与组长只能查看自己所属/负责小组的作业与记录，无论当期还是往期；队长可查看全部三个小组。
- **历史周**：同样按小组隔离，只有队长能跨组查看；历史周允许组长继续维护本组内容。
- 组长在成员管理中点击「加入我组」即可认领待分组成员。
- 提交路径：`weekNN/<组名>/submissions/<login>/`；组长端看板、提交列表、批改、导出都会按组过滤。

**角色如何保存？**

- 角色与分组写入仓库 `members.json`，key 就是 GitHub 账号，天然与账号绑定。
- 每次登录都从 GitHub 读取 `members.json` 决定角色；本地只缓存同步时间用于展示与离线兜底。
- 兑换码提升组长后会**重新拉取并校验**远端 `members.json`；若 Token 没有仓库写权限，会直接报错并停留在登录页，不会出现“界面是组长、重启后变回组员”的假成功。

**组员**

1. 用同样的方式生成 Token（细粒度 Token 也可：仅授权 `Rm-Homework`，Contents 读写）。
2. 用 Token 登录，首次登录会自动登记到 `members.json`（显示「待分组」）。
3. 组长分配分组后，组员端即显示对应组的要求。
4. 进入某周作业 → 把整个文件夹拖进虚线框 → 自动提交到 `weekNN/<你的组名>/submissions/<你的账号>/`。

**记住账号**

登录时勾选「记住此账号，下次自动登录」后，本机会加密保存该账号与 Token：

- 下次启动自动进入工作台，无需重新输入；
- 登录页会列出「已保存的账号」，可一键切换；
- 「设置 → 已保存的账号」可移除单个账号、全部清除，或关闭「启动时自动登录」。

**成绩提醒**

组长批改并推送后，组员端在下一次轮询（默认 25 秒）发现 `evaluation.json`，右下角弹出分数与评语；登录时也会补弹未读成绩。

---

## 5. Git 通道（WSL 优先）

- 启动时先探测 **WSL 中的 Git**：`wsl.exe --exec git --version`。
- WSL 可用时，所有 Git 命令通过 `wsl.exe --cd <WSL 路径> --exec git …` 执行，Windows 路径自动映射为 `/mnt/<盘符>/…`。
- WSL 不可用（未安装、服务被禁用、权限不足）时 **自动回退** 到 Windows Git，并在「设置 → Git 通道」中显示回退原因。
- 可在设置中强制选择「仅 WSL」「仅 Windows Git」或「自动」。
- Token 通过 `-c http.https://github.com/.extraheader=…` 随命令传入，**不会写入 `.git/config`**。

> 本机实测：WSL 返回 `Wsl/E_ACCESSDENIED`（服务存在但当前用户无权访问），因此客户端自动使用 Windows Git，界面会明确提示。

---

## 6. 安全设计

| 风险 | 处理 |
| --- | --- |
| Token 泄露 | Electron 使用系统 `safeStorage` 加密；浏览器模式使用 AES-256-GCM，密钥由本机信息（主机名 + 用户名）派生；**不落明文**，可在「设置 → 已保存的账号」随时移除或全部清除 |
| 本地 API 被其他网页调用 | 仅监听 `127.0.0.1`，随机端口 + 每次启动随机 API Key（`X-RMH-Key`） |
| 渲染进程越权 | `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`，仅暴露白名单 IPC |
| XSS | Markdown 渲染默认转义 HTML；CSP 禁止内联脚本 |
| 路径穿越 | 所有相对路径经 `safeJoin` 校验；周次/账号名正则校验 |
| 兑换码硬编码 | 客户端内置固定码属于需求约定，文档明确其非高安全凭据；可在 `teams.json` 追加自定义码 |

---

## 7. 扩展点

### 7.1 云存储（OSS / 网盘）

`src/main/storage/providers/oss.js` 已定义接口：

```js
const oss = new OssStorageProvider({ enabled, endpoint, bucket, accessKey, secretKey });
await oss.putFile(key, buffer, contentType);  // 返回 URL / 对象 key
await oss.signedUrl(key);                     // 生成下载地址
await oss.deleteFile(key);
```

推荐落地方式：
1. 上传前检查单文件大小，超过 `thresholdMB`（默认 20MB）时走 OSS；
2. 仓库内只保存 `assets.json` 清单（`{ path, size, sha256, url, objectKey }`）；
3. 组员端/组长端下载时按清单回源；
4. 在 `storage/index.js` 注册新的 provider，业务层无需改动。

### 7.2 新增分组

编辑 `teams.json` 的 `groups` 数组即可；前端分组卡片、筛选、看板会自动适配（分组补充文件命名为 `<group.id>.md`）。

### 7.3 新增存储后端

实现 `FsStore` 的 `pull / mutate / info` 与文件读写方法，然后在 `createStorage` 中注册。

---

## 8. 开发与打包

```bash
# 安装依赖（本机 npm 缓存目录需可写，可用 --cache 指定）
npm install

# 生成图标
npm run icon

# 开发运行
npm start

# 端到端自测（无需 Electron）
npm run selftest

# 前端集成冒烟测试（需要 jsdom：npm i -D jsdom --no-save）
node tests/frontend-smoke.js

# 打包 Windows 便携版 exe → dist/RM-Homework-1.0.0.exe
npm run build

# 构建独立 exe（Node SEA，当前推荐，不需要 Chromium）
node scripts/build-sea.js
```

> 打包使用 `electron-builder --win portable`。若网络受限，可设置
> `ELECTRON_MIRROR` 与 `ELECTRON_BUILDER_BINARIES_MIRROR` 指向国内镜像。
>
> 本项目 `build.electronDist` 指向 `node_modules/electron/dist`，打包时直接复用已安装的 Electron，
> 不会重复下载 115MB 的运行时。若在磁盘空间紧张或临时目录受限的环境构建，
> 请先把 `TMP` / `TEMP` 指向空间充足的目录（NSIS 需要写入较大的临时文件）。

### 构建产物

| 路径 | 说明 |
| --- | --- |
| `dist/RM-Homework-1.0.1.exe` | **独立 exe（推荐）**：双击后启动本地服务并用浏览器打开界面，关闭命令行窗口即停止 |
| `dist/RM-Homework-1.0.0.exe` | Electron 便携版（仅作备用；在部分 Win11 预览版/虚拟机中可能闪退） |

> 独立 exe 由 Node SEA 生成，运行时是 `node.exe` 的副本，因此体积约 90MB，且**不需要**浏览器插件或 WebView2。
> 安装包未做代码签名。Windows SmartScreen 若提示「已保护你的电脑」，点击「更多信息 → 仍要运行」。



---

## 9. 已知限制

1. **WSL 权限**：部分机器（含本机）当前用户无法访问 WSL，客户端会回退 Windows Git；如需强制 WSL，请在「设置」中切换并确认 `wsl.exe` 对当前用户可用。
2. **文件大小**：GitHub 单文件 100MB、仓库建议 < 1GB；机械组大型 CAD 建议启用 OSS 扩展。
3. **并发写入**：所有写操作采用「拉取 → 修改 → 提交 → 推送，冲突重试 3 次」；极高并发下仍可能提示稍后重试。
4. **兑换码**：内置于客户端，无法防止逆向提取；适用于战队内部轻量场景。
5. **离线**：可读取本地缓存，但提交/批改需要网络。
6. **浏览器模式**：GitHub Token 使用 AES-256-GCM 加密保存在本机 `settings.json`，支持「记住账号 / 启动自动登录」；密钥由本机信息派生，只能防止明文泄露，不能防御已经控制本机的攻击者。可在「设置 → 已保存的账号」中移除单个账号或全部清除。
