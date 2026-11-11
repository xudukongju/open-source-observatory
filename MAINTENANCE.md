# 开源观察台维护

## 唯一生产部署入口

用户明确指定沿用个人网站的托管方式：**自己的 Cloudflare Pages → 阿里云 DNS → lab.mkongyue.top**。不要使用内置 Sites，不添加 ChatGPT 登录门禁。

- Cloudflare Pages 项目：`xiaosong-observatory`，生产分支 `main`。
- 原生地址：https://xiaosong-observatory.pages.dev
- 个人域名：https://lab.mkongyue.top（迁移验收状态见上层 PROJECT_STATUS.md）。
- 阿里云 DNS：主机 `lab`，类型 `CNAME`，值 `xiaosong-observatory.pages.dev`。Pages 中也需绑定该自定义域名。
- 公开源码和数据仓库：`xudukongju/open-source-observatory`。只发布可公开的材料。

普通代码发布：先 `npm test`，再使用已有的官方 Wrangler 登录部署，不读取凭据文件，不打印 Token：

```sh
wrangler pages deploy dist --project-name xiaosong-observatory --branch main
```

本机可复用 `../../简历/job-workbench/node_modules/.bin/wrangler`。部署目录为本仓库；`functions/api/snapshot.js` 会一起发布。读取正式域名首页和 `/api/snapshot` 确认实际响应与采集时间。不要发布到 portfolio、radar 或 worlddesk 项目。

本地完整预览用 `wrangler pages dev dist`；纯静态服务器不会执行 `/api/snapshot`。

## 数据更新与运营

权威登记源：`data/registry.json`、`data/releases.json`；采集输出：`data/snapshot.json`。每日研发运营结束时，把上层 `operations/releases.json` 中已核验且可公开的记录同步到本仓库，并更新项目、推广讨论、跟进负责人/期限/状态/证据。先同步远端，保护自动采集历史与其他修改。

GitHub Actions 计划每15分钟采集公开仓库、发行资产、Issues 和登记的 Discussion；调度可能延迟。Pages 同源接口从公开仓库读取快照，边缘缓存60秒；网页可见时每60秒检查。数据更新时间是上游真实采集时间，超过45分钟提示过期。数据更新无需重新部署页面，也不依赖本机。

每日09:00研发运营任务仍依赖本机，并负责需求判断、真实交付、回复反馈和人工跟进状态；指标自动采集不等于反馈已处理。下载含作者测试，外部采用无证据时保持未知。

验收重点：总览/发布/反馈导航，搜索和项目筛选，数据来源弹窗，发布验收展开，数据导出；0与未知、来源失败和陈旧快照不可混淆。现有云端采集首次运行 42985253104 已成功。

## 迁移与恢复

旧内置 Sites 只保留为迁移前历史，不再部署、不再作为正式入口。旧 Sites 检出在上层 observatory-site-source，禁止与本仓库 Git 历史混合。切换自定义域名之前先验证 Pages 原生地址。若 Pages 自定义域名尚未生效，使用原生地址访问；不要把 DNS 已更改等同迁移已完成。
