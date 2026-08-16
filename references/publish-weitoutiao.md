# 微头条发布

## 概述

通过浏览器自动化在 `https://mp.toutiao.com/profile_v4/weitoutiao/publish` 发布微头条（类似微博的短内容）。

支持两种内容来源：命令行直接传入 `--content`，或从 `newspic.json` 格式文件读取 `--content-file`。

## 命令

```bash
# 命令行直接传入内容
toutiao-ops publish weitoutiao --content "今天分享一个有趣的发现..."

# 从 newspic.json 文件读取
toutiao-ops publish weitoutiao --content-file /path/to/newspic.json
```

## 参数

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `--content` | 与 `--content-file` 二选一 | - | 微头条文本内容（`\n` 换行） |
| `--content-file` | 与 `--content` 二选一 | - | `newspic.json` 文件路径，格式见下方 |
| `--images` | 否 | - | 图片路径，多张用逗号分隔（最多 9 张）；优先级高于 JSON 中的 `images` |
| `--topic` | 否 | - | 话题名称（不含 `#`） |
| `--first-publish` | 否 | false | 勾选「头条首发」 |
| `--declaration` | 否 | - | 作品声明，逗号分隔，可选项：`取材网络,引用站内,个人观点,引用AI,虚构演绎,投资观点,健康医疗` |
| `--draft` | 否 | false | 存为草稿而非直接发布 |
| `--headless` | 否 | false | 无头模式运行（默认有头，方便观察执行过程） |

## `newspic.json` 格式

```json
{
  "title": "装修公司拍动画，票房靠审丑",
  "paragraphs": [
    "《牛来》票房逆袭跟国漫崛起没有半点关系...",
    "宣传用一张水墨海报撑起高级感..."
  ],
  "images": [
    "images/img_b17be3935ab7.jpg",
    "images/img_2c4a3fb691e1.jpg"
  ],
  "ad_blocks": []
}
```

- `title`：标题，会作为微头条正文的第一段（后接空行 + 正文段落）。
- `paragraphs`：正文段落数组，每个元素一段，段落之间用空行分隔。
- `images`：图片相对路径数组（相对 `newspic.json` 所在目录），最多取 9 张。
- `ad_blocks`：当前忽略。

## 示例

```bash
# 纯文本
toutiao-ops publish weitoutiao --content "今天天气真不错！\n\n分享一下午后阳光~"

# 带图片和话题
toutiao-ops publish weitoutiao \
  --content "周末探店记录" \
  --images "/path/img1.jpg,/path/img2.jpg" \
  --topic "美食探店" \
  --first-publish

# 存草稿
toutiao-ops publish weitoutiao --content "草稿内容" --draft

# 从 JSON 文件发布（默认有头模式，可在控制台看到每一步日志）
toutiao-ops publish weitoutiao --content-file /path/to/newspic.json

# 从 JSON 文件发布并指定话题
toutiao-ops publish weitoutiao --content-file /path/to/newspic.json --topic "电影评论"
```

## 自动化流程

1. 检查登录状态
2. 导航到微头条发布页，关闭弹窗遮挡
3. 读取 `--content-file` 或直接解析 `--content`
4. 输入文本内容（逐段输入，模拟真人节奏）
5. 上传图片（如提供）：点击「图片」→ 选择文件 → 点击「确定」。图片超过 9 张时仅上传前 9 张
6. 设置话题（如提供）
7. 勾选头条首发（如指定）
8. 设置作品声明（如指定）
9. 点击「发布」/「存草稿」按钮

## 输出示例

```json
{
  "success": true,
  "action": "published",
  "content": "今天天气真不错！...",
  "url": "https://mp.toutiao.com/..."
}
```

## 注意事项

- 默认使用有头模式启动浏览器，执行过程会通过 `console.log` 实时输出到控制台，主要节点包括：启动浏览器、JSON 解析、正文输入、图片上传、发布/存草稿、关闭浏览器
- 图片格式支持 JPEG、PNG
- 多图上传最多 9 张，超出会自动截断
- 内容中的 `\n` 会被转换为实际换行
- 图片上传后需点击确认按钮才会附加到微头条
