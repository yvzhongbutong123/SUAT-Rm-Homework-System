# RM Homework · RoboMaster 战队作业管理

以 GitHub 仓库 `Rm-Homework` 为数据源的战队作业管理系统：组长看板 / 在线批改，组员拖拽上传 / 成绩即时提醒。

## 运行

双击 **`dist/RM-Homework-1.0.1.exe`**。

- 会弹出一个命令行窗口作为本地服务，并自动用默认浏览器打开界面（`http://127.0.0.1:<端口>`）。
- 关闭命令行窗口即停止服务。
- 若 Windows 提示「未知发布者」，选择「更多信息 → 仍要运行」。
- 登录页选择「组长视角 / 组员视角」即可离线体验全部功能（演示数据）。

> 说明：此前基于 Electron 的桌面版在部分 Windows 11 预览版 / 虚拟机环境中，其 Chromium 进程会在启动瞬间崩溃（0xC0000005），因此当前交付改为**不依赖 Chromium 的独立 exe**：业务服务、Git 操作、界面完全一致，只是窗口由浏览器承载。

## 真实使用

- 默认仓库：`git@github.com:yvzhongbutong123/SUAT-Rm-Homework.git`（登录页可改；本机无 SSH Key 时自动改用 HTTPS + Token）。
- 组长：GitHub Token + 兑换码 → 连接仓库 → 在成员管理中分配分组。
- 组员：GitHub Token 登录 → 等待组长拉入小组 → 选择/拖入作业文件夹提交。
- **分组隔离**：作业、提交目录（`weekNN/submissions/<group>/<login>/`）、看板与批改都按组过滤；组组长只能管理本组，未进组成员会通知全体组长。
- 登录时勾选「记住此账号」即可下次自动登录；账号与 Token 加密保存在本机。

## 文档与开发

- 设计与使用说明：[docs/README.md](docs/README.md)
- 源码：`src/main`（服务与存储）、`src/renderer`（界面）、`src/web`（浏览器模式入口）
- 自测：`npm run selftest`、`node tests/frontend-smoke.js`、`node tests/web-api.js`
- 重新构建 exe：`node scripts/build-sea.js`
