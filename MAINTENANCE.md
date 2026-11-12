# 开源观察台维护

## 唯一生产部署入口

用户明确指定沿用个人网站的托管方式：**自己的 Cloudflare Pages → 阿里云 DNS → lab.mkongyue.top**。不要使用内置 Sites，不添加 ChatGPT 登录门禁。

- Cloudflare Pages 项目：`xiaosong-observatory`，生产分支 `main`。
- 原生地址：https://xiaosong-observatory.pages.dev
- 正式域名：https://lab.mkongyue.top 。2026-11-11 已核验域名与证书 active，首页和 /api/snapshot 均200，无登录门禁。
- 阿里云 DNS：主机 `lab`，类型 `CNAME`，值 `xiaosong-observatory.pages.dev`。Pages 中也需绑定该自定义域名。
- 公开源码和数据仓库：`xudukongju/open-source-observatory`。只发布可公开的材料。

普通代码发布：先 `npm test`，再使用已有的官方 Wrangler 登录部署，不读取凭据文件，不打印 Token：

```sh
wrangler pages deploy dist --project-name xiaosong-observatory --branch main
```

本机可复用 `../../简历/job-workbench/node_modules/.bin/wrangler`。部署目录为本仓库；`functions/api/snapshot.js` 会一起发布。读取正式域名首页和 `/api/snapshot` 确认实际响应与采集时间。不要发布到 portfolio、radar 或 worlddesk 项目。

本地完整预览用 `wrangler pages dev dist`；纯静态服务器不会执行 `/api/snapshot`。

## 自定义域名的自动绑定路径

无需依赖浏览器登录。Wrangler 的官方 `auth token --json` 支持把已有 OAuth 登录提供给脚本，并自动刷新过期凭据。必须在子进程内捕获输出，凭据只留在进程内，用于 api.cloudflare.com 官方接口；不得读取认证文件、直接打印认证输出、存盘或放进命令参数。

先 GET `/accounts/{account_id}/pages/projects/xiaosong-observatory/domains` 查重；缺失时 POST 同一路径，JSON 为 `{"name":"lab.mkongyue.top"}`。随后 GET `/accounts/{account_id}/pages/projects/xiaosong-observatory/domains/lab.mkongyue.top` 验证。初始化与证书 pending 期间等待，不重复创建。API 显示 active 后再读正式域名首页和 `/api/snapshot`。

官方依据：[Wrangler 认证接口](https://developers.cloudflare.com/workers/wrangler/commands/general/#auth-token)、[Pages 自定义域名 API](https://developers.cloudflare.com/api/resources/pages/subresources/projects/subresources/domains/methods/create/)。Pages Write 权限已包含在现有正常登录中；没有 Pages 专用域名 CLI 命令不等于没有自动化路径。


## 数据更新与运营

权威登记源：`data/registry.json`、`data/releases.json`；采集输出：`data/snapshot.json`。每日研发运营结束时，把上层 `operations/releases.json` 中已核验且可公开的记录同步到本仓库，并更新项目、推广讨论、跟进负责人/期限/状态/证据。先同步远端，保护自动采集历史与其他修改。

Cloudflare Worker `xiaosong-observatory-collector` 已部署每15分钟 Cron（UTC */15）。专用 KV `OBSERVATORY` 保存快照与健康状态；只读 GitHub Secret 名为 `GITHUB_READ_TOKEN`。正在完成独立只读凭据配置与真实定时采集验收，尚不据此宣称调度修复完成。

Pages 同源接口从 KV 和 GitHub 归档选择实际采集时间较新的有效快照，边缘缓存60秒；网页可见时每60秒检查。GitHub Actions 原计划保留，优先归档新鲜且匹配当前登记表的 Cloudflare 快照，否则运行原采集器。两条路径合并历史，保留90天；失败不伪造新成功时间。超过45分钟提示过期。普通登记更新无需重新部署，也不依赖本机。

每日09:00研发运营任务仍依赖本机，并负责需求判断、真实交付、回复反馈和人工跟进状态；指标自动采集不等于反馈已处理。下载含作者测试，外部采用无证据时保持未知。

验收重点：总览/发布/反馈导航，搜索和项目筛选，数据来源弹窗，发布验收展开，数据导出；0与未知、来源失败和陈旧快照不可混淆。现有云端采集首次运行 42985253104 已成功。

## 迁移与恢复

旧内置 Sites 只保留为迁移前历史，不再部署、不再作为正式入口。旧 Sites 检出在上层 observatory-site-source，禁止与本仓库 Git 历史混合。切换自定义域名之前先验证 Pages 原生地址。若 Pages 自定义域名尚未生效，使用原生地址访问；不要把 DNS 已更改等同迁移已完成。

## Cloudflare 定时采集的维护入口

- 配置：`worker/wrangler.toml`；部署：`wrangler deploy --config worker/wrangler.toml`。不会要求修改 DNS。
- 健康：https://xiaosong-observatory-collector.xudukongju.workers.dev/health
- 实际公开快照：https://xiaosong-observatory-collector.xudukongju.workers.dev/snapshot
- KV ID：`2627d4f1d95c4dd2b629740225d19d57`，只供本观察台使用，Pages 与 Worker 共享 binding。
- GitHub 使用独立 fine-grained PAT，仅 Public repositories、无额外写权限；90天到期。只在官方 GitHub 页面创建，在 Cloudflare Secret 中保存。不能把本机可写 gh 登录复制到云端。
- 缺失凭据时 health 为 awaiting_authorization；GitHub 某来源失败为 partial_failure，保留其旧值与时间；其他采集错误为 failed。先核对 health 与来源失败，再修授权/网络/查询，不能只重置时间。
- 验收必须有真实 Cron 的 scheduled_at 与 snapshot_at、完整四类来源结果、网站同源 API 读回；手工触发不算定时验收。
- 恢复：保留 GitHub Actions 备用采集，Pages 自动选用有效较新快照。暂停 Worker 前先确认归档与回退可用；不能删除 KV 历史。
