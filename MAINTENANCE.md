# 观察台维护

源站 Sites ID: appgprj_6af420d9b84081919b4ebfe58647f8bd。站点默认 owner-private，未获用户明确请求不得改共享范围。目标域名 lab.mkongyue.top，连接状态以交付记录为准。

公开源代码与数据仓库：xudukongju/open-source-observatory。不要把候选的未证实需求、私密运营记录或凭据写进公开文件。

数据权威源：data/registry.json、data/releases.json；采集器输出 data/snapshot.json。工作区上层 operations/releases.json 是每日发布账本，运营轮次结束时同步其中已核验的公开发布记录到此仓库，再触发云端采集并读回。不要用本地旧快照覆盖云端已有历史，编辑前 fetch/pull 当前 main，检查现有修改和正在运行的 Actions。

每日09:00运营任务负责内容研究、产品交付和跟进状态更新；每15分钟GitHub Actions仅采集指标与反馈，无需电脑开机。两者不可混为一谈。采集使用 GITHUB_TOKEN 的公开 API 读取与当前仓库 contents:write，不保存个人 token。GitHub 调度不能保证准点，检查 stale 提示和工作流运行结果。

Sites 发布只在界面或代码变更时需要。使用 Sites skill 的 source helper 将准确源版本推入 Sites 仓库，打包 dist 并发布；沿用 .openai/hosting.json。GitHub remote 和 Sites remote 不要互相替换。静态页面在源站私有，公开 GitHub 数据本身是公开信息。

验收：npm test；读取真实云端快照；测试总览/发布/反馈导航、项目筛选、搜索、刷新、数据说明与导出；检查桌面和移动布局、失败保留快照、过期标记、数字0与未知的区别。新功能不能将脚本成功返回等同真实外部采用。
