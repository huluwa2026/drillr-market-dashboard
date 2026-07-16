# drillr Market Dashboard

[English](./README.md)

一个由 [Drillr](https://drillr.ai) 真实金融数据驱动的高密度美股数据大盘。

![drillr Market Dashboard](./public/og-real.png)

项目用于完整展示金融数据平台的覆盖能力：桌面端保持一屏大盘形态，所有核心
信息直接平铺；平板和手机端自动重排为可滚动页面。生产代码不会在真实数据不可用
时切换到模拟行情。

## 核心能力

- 只读取 Drillr Gateway 真实数据，不提供模拟数据兜底。
- 默认展示英伟达、谷歌、特斯拉和苹果，并支持动态管理股票池。
- 覆盖行情、历史价格、结构化基本面、分析师共识、财报、所有权变化、盘前盘后
  和市场指数。
- 展示能源、数据中心、半导体、算力价格、模型发展、宏观贸易、预测市场等另类
  数据目录。
- 包含 K 线、收益热力图、径向图、雷达图、信号气泡、估值双柱、共识堆叠、
  棒棒糖图、配对柱、目标价须状图、所有权气泡等十余种可视化。
- 使用 Cloudflare D1 保存股票池配置并缓存网关响应。
- 支持桌面、平板和手机端布局。

## 环境要求

- Node.js 22.13 或更高版本
- npm
- Drillr Gateway API Key

## 本地启动

```bash
git clone https://github.com/huluwa2026/drillr-market-dashboard.git
cd drillr-market-dashboard
cp .env.example .env.local
npm install
npm run dev
```

在 `.env.local` 中填写 `DRILLR_API_KEY`，然后访问
[http://localhost:3000](http://localhost:3000)。

本地 Cloudflare 运行环境会自动创建所需 D1 数据表。开发环境设置
`ALLOW_LOCAL_ADMIN=true` 后，可以直接使用右上角管理功能；生产环境会忽略该
本地旁路。

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `DRILLR_API_KEY` | 是 | 仅在服务端使用的 Drillr Gateway 凭证。 |
| `DRILLR_GATEWAY_URL` | 否 | 网关地址，默认 `https://gateway.drillr.ai`。 |
| `ADMIN_EMAILS` | 否 | 生产环境管理员邮箱白名单，使用英文逗号分隔。 |
| `ALLOW_LOCAL_ADMIN` | 否 | 设置为 `true` 时允许开发环境管理股票池。 |

严禁将 `DRILLR_API_KEY` 写入公开前缀环境变量或提交到 Git。

## 常用命令

```bash
npm run dev      # 启动本地开发服务
npm run lint     # 执行代码检查
npm test         # 构建并运行测试
npm run build    # 创建生产构建
```

## 数据与权限说明

- 真实数据源不可用时，大盘会明确显示错误，不会自动展示虚构数值。
- 生产环境的股票池管理依赖可信身份请求头，例如 OpenAI Sites 提供的身份头；可用
  `ADMIN_EMAILS` 进一步限制管理员。
- `ALLOW_LOCAL_ADMIN` 只在非生产环境生效。
- Drillr 数据的使用还需遵守对应账户和 API 套餐条款。

## 参与贡献

请阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。安全问题请按
[SECURITY.md](./SECURITY.md) 中的私密方式报告。

## 许可证

[MIT](./LICENSE)
