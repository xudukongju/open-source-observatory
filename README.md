# 开源观察台 · Open-source Observatory

追踪 xudukongju 的真实开源交付、GitHub 反馈和下一步行动。它是运营基础设施，不计作每日产品发布。

## 数据流

`data/registry.json`（项目与跟进）+ `data/releases.json`（发布账本）→ Cloudflare Cron 每15分钟采集 → KV 快照 → Pages 同源接口 → 网站每60秒读取。GitHub Actions 保留为归档与备用采集，合并90天历史。

Cloudflare 新链路已部署，独立只读凭据配置与真实定时验收进行中。网页选择 KV 与 GitHub 中实际时间较新的快照；超过45分钟仍提示过期。GitHub 旧调度实测出现数小时触发间隔，因此不再把其15分钟配置等同可靠更新承诺。

- 星标、fork 和发行资产下载来自 GitHub REST API。
- 已登记的推广讨论及其分页评论、回复来自 GraphQL。
- 关闭 Issue 不推断“问题已解决”；作者最后回复后仍有外部新消息会重新标为待回复。
- 资产下载包括重复与作者验证，不能作为用户数。讨论点赞可能包含作者。真实外部采用单独人工核验，未知就是未知。
- 来源采集失败保留最后成功值和时间；首次失败保留 null。采集工作流报告失败，同时发布部分失败状态。
- 首个观测点不伪造历史曲线。数据和页面都只含可公开材料；不采集私有仓库、IP 或用户访问日志。

## 更新项目与跟进

1. 在 `data/registry.json` 添加项目（id/repo/title/summary/stage/adoption/discussions）。`adoption` 无证据时保持 null。
2. 在 `data/releases.json` 添加真实完成的版本、问题阐释、证据与已验证推广链接。不把草稿或待发布记作 published。
3. 在 registry 的 `followups` 更新 owner/due/status/note/source/updated_at。状态使用 todo、doing、blocked、done；完成应在 note 记录实际结果和证据。
4. 推送 main 自动触发采集；查看 Actions 后读取 snapshot 核验。普通数据更新无需重新部署网站。
5. 新推广平台只在具备访问与采集能力后接入。现在只自动追踪 GitHub；其他平台可登记链接，不能宣称指标已连接。

## 本地运行与检查

Node 18+、Python 3.7+、官方 GitHub CLI。登录沿用 `gh auth login`，不用向脚本传入 token。

```sh
npm test
python3 scripts/collect.py
wrangler pages dev dist
```

非默认 CLI 路径可通过 `GH_BIN` 指向已安装的官方 gh。`dist/snapshot.json` 是随站发布的初始兜底，页面会明确标为旧记录；正常数据来自同源接口选择的最新有效公开快照。

网站托管在账号所有者的 Cloudflare Pages（xiaosong-observatory），页面与 /api/snapshot 均无需 ChatGPT 登录。访客不必直连 GitHub raw；Pages Function 在云端读取公开快照并缓存60秒。生产发布说明与维护入口见 `MAINTENANCE.md`。
