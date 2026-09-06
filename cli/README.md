# @openclaw-cn/toutiao-ops

今日头条创作者平台全流程运营自动化 CLI 工具。

基于 Playwright 浏览器自动化，支持多账号管理，覆盖内容发布、评论互动、数据分析全链路。发布操作模拟真人行为，数据操作复用浏览器会话调用平台 API。

[![npm version](https://img.shields.io/npm/v/@openclaw-cn/toutiao-ops)](https://www.npmjs.com/package/@openclaw-cn/toutiao-ops)
[![license](https://img.shields.io/npm/l/@openclaw-cn/toutiao-ops)](./LICENSE)

## 功能一览

| 模块 | 功能 |
|------|------|
| **账号管理** | 多账号登录、QR 码扫码、会话持久化、账号切换 |
| **文章发布** | Markdown / HTML / 纯文本 / JSON blocks、封面（单图/三图/无）、首发、合集、作品声明 |
| **视频发布** | 视频上传、自定义/自动封面、话题、生成图文、可见性、合集、作品声明 |
| **微头条发布** | 文本 + 多图、话题、首发、作品声明 |
| **作品管理** | 作品列表、按类型/状态筛选 |
| **评论管理** | 评论列表（含子评论）、回复评论、点赞评论 |
| **数据分析** | 作品数据、粉丝画像（性别/年龄/地域/机型）、收益数据、单个作品详情 |
| **创作灵感** | 创作活动、热点推荐 |

## 安装

```bash
npm install @openclaw-cn/toutiao-ops
```

安装后会自动下载 Chromium 浏览器。如果自动下载失败，手动执行：

```bash
npx playwright install chromium
```

## 快速开始

```bash
# 1. 登录（首次需要手机扫码）
npx toutiao-ops auth login

# 2. 发布一条微头条
npx toutiao-ops publish weitoutiao --content "Hello 头条！"

# 3. 查看粉丝数据
npx toutiao-ops analytics fans

# 4. 查看评论并回复
npx toutiao-ops comment list
npx toutiao-ops comment reply --comment-id "下一次更新" --content "预计下周发布！"
```

## 多账号

所有命令支持 `--account <name>` 全局参数，省略时使用 `default` 账号。每个账号的浏览器会话独立隔离。

```bash
# 登录工作号
npx toutiao-ops --account work auth login

# 用工作号发布文章
npx toutiao-ops --account work publish article --title "工作日报" --content "..."

# 查看所有已登录账号
npx toutiao-ops auth list
```

账号数据存储在命令执行目录的 `.toutiao-ops/accounts/<name>/` 下。固定在同一目录执行命令，即可复用或同步账号数据。

## 命令参考

### 健康检查

```bash
toutiao-ops health check                # 验证默认账号是否已登录
toutiao-ops --account work health check --headless
```

返回 `healthy`、`status` 和 `logged_in` 字段；未登录时 `healthy` 为 `false`。

### 账号管理

```bash
toutiao-ops auth check                  # 检测登录状态
toutiao-ops auth login                  # 扫码登录
toutiao-ops auth logout                 # 退出登录（清除缓存）
toutiao-ops auth list                   # 列出所有账号
```

### 内容发布

```bash
# 文章（Markdown）
toutiao-ops publish article \
  --title "标题" \
  --content "正文（\n分段）" \
  --cover "/path/cover.jpg" \
  --cover-mode single \
  --first-publish \
  --collection "专栏名" \
  --declaration "个人观点"

# 文章（HTML 文件，含内联图片）
toutiao-ops publish article \
  --title "HTML 图文" \
  --content-file "/path/article.html" \
  --format html

# 文章（JSON blocks 结构化排版）
toutiao-ops publish article \
  --content-file "/path/article_blocks.json" \
  --first-publish

# 视频
toutiao-ops publish video \
  --file "/path/video.mp4" \
  --title "视频标题" \
  --cover "/path/cover.jpg" \
  --topic "话题名" \
  --description "简介" \
  --gen-article \
  --collection "视频专栏" \
  --declaration "自行拍摄" \
  --visibility public \
  --draft

# 微头条
toutiao-ops publish weitoutiao \
  --content "微头条内容" \
  --images "img1.jpg,img2.jpg" \
  --topic "话题名" \
  --first-publish
```

### 作品与评论管理

```bash
toutiao-ops content list --type article         # 作品列表
toutiao-ops comment list --with-replies          # 评论列表（含子评论）
toutiao-ops comment reply --comment-id "内容片段" --content "回复"
toutiao-ops comment like --comment-id "1"        # 点赞第一条评论
```

### 数据分析

```bash
toutiao-ops analytics works --type video         # 视频数据
toutiao-ops analytics fans                       # 粉丝画像
toutiao-ops analytics income --type article      # 图文收益
toutiao-ops analytics content-detail \
  --content-id "7623453165358170664" \
  --content-type 2                               # 单个作品详情
```

### 创作灵感

```bash
toutiao-ops inspiration                          # 创作活动
toutiao-ops inspiration --type hotspot           # 热点推荐
```

### 通用选项

| 选项 | 说明 |
|------|------|
| `--account <name>` | 指定操作账号（默认 `default`），置于子命令之前 |
| `--headless` | 无头模式运行（不弹出浏览器窗口） |
| `--draft` | 发布类命令：存为草稿而非发布 |

## 输出格式

所有命令以 JSON 格式输出到 stdout，便于程序化解析：

```json
{
  "success": true,
  "action": "published",
  "title": "文章标题"
}
```

错误输出到 stderr：

```json
{
  "error": "未登录，请执行 auth login",
  "stack": "..."
}
```

## 技术架构

```
┌─────────────────────────────────────────────┐
│              CLI (Commander.js)              │
├──────────────┬──────────────────────────────┤
│  发布模块     │       数据模块               │
│  (浏览器自动化) │  (浏览器内 fetch / API 拦截)  │
├──────────────┴──────────────────────────────┤
│     Playwright + Stealth Plugin              │
│     持久化浏览器上下文（per-account）          │
└─────────────────────────────────────────────┘
```

**发布操作**使用完整浏览器自动化：逐字输入、随机延迟、真实点击，模拟人类行为避免平台检测。

**数据操作**在浏览器内执行 `fetch()` 调用平台 API，复用已登录的 Cookie 和会话，获取结构化 JSON 数据。

### 反检测措施

- `playwright-extra` + `puppeteer-extra-plugin-stealth` 隐藏自动化特征
- 持久化浏览器上下文保留真实浏览器指纹
- 随机延迟 + 人类节奏模拟输入
- 主动关闭弹窗和权限请求

## 数据目录

```
<当前工作目录>/.toutiao-ops/
└── accounts/
    ├── default/
    │   ├── browser-data/       # 浏览器会话数据
    │   ├── screenshots/        # 登录二维码截图
    │   └── meta.json           # 账号元信息
    └── work/
        └── ...
```

## 环境要求

- Node.js >= 18
- macOS / Linux / Windows
- 首次运行需要有显示器环境（扫码登录），后续可使用 `--headless`

## License

MIT
