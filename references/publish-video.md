# 视频发布

## 概述

通过浏览器自动化在 `https://mp.toutiao.com/profile_v4/xigua/upload-video` 完成视频上传和发布。上传视频后自动进入信息填写页面。

## 命令

```bash
toutiao-ops publish video --title "视频标题" --file "/path/to/video.mp4"
```

## 参数

| 参数 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `--file` | 是 | - | 视频文件本地路径（MP4、MOV 等） |
| `--title` | 是 | - | 视频标题（1～30 字符） |
| `--topic` | 否 | - | 话题名称（不含 `#`） |
| `--cover` | 否 | - | 自定义封面图片路径；不提供则自动选择推荐封面 |
| `--description` | 否 | - | 视频简介/描述 |
| `--gen-article` | 否 | false | 勾选「生成图文」获取额外图文创作收益 |
| `--collection` | 否 | - | 添加至合集名称 |
| `--declaration` | 否 | - | 作品声明，逗号分隔，可选项：`取自站外,引用站内,自行拍摄,AI生成,虚构演绎,投资观点,健康医疗` |
| `--visibility` | 否 | `public` | 谁可以看：`public`（所有人）/ `fans`（粉丝）/ `private`（仅自己） |
| `--draft` | 否 | false | 存为草稿而非直接发布 |
| `--headless` | 否 | false | 无头模式运行 |

## 示例

```bash
# 基础发布
toutiao-ops publish video --title "我的视频" --file "/path/to/video.mp4"

# 完整参数
toutiao-ops publish video \
  --title "户外探险记录" \
  --file "/path/to/video.mov" \
  --cover "/path/to/cover.jpg" \
  --topic "户外运动" \
  --description "记录一次精彩的户外探险..." \
  --gen-article \
  --collection "户外系列" \
  --declaration "自行拍摄" \
  --visibility public

# 存草稿
toutiao-ops publish video --title "草稿" --file "/path/to/video.mp4" --draft
```

## 自动化流程

1. 确认登录状态
2. 导航到视频上传页，关闭弹窗遮挡
3. 上传视频文件（通过隐藏 input 直接设置文件）
4. 等待上传和转码完成（最长 10 分钟）
5. 填写标题、话题、描述
6. 处理封面：提供 `--cover` 则本地上传自定义封面；未提供时使用「封面截取」功能，按提示完成多步确认
7. 展开高级设置（当指定 `--collection` / `--declaration` / `--visibility` 时自动展开）
8. 勾选生成图文（如指定）
9. 设置合集、作品声明、可见性（如指定）
10. 点击「发布」/「存草稿」按钮

## 输出示例

```json
{
  "success": true,
  "action": "published",
  "title": "视频标题",
  "url": "https://mp.toutiao.com/..."
}
```

## 注意事项

- 支持格式：MP4、MOV 等常见视频格式
- 大文件上传时间较长，请确保网络稳定
- 转码超时（10 分钟）会报错，可重试
- 不提供 `--cover` 时使用「封面截取」功能，默认选取视频帧并进入多步确认对话框
- 高级设置区域可能为折叠状态，当指定 `--collection` / `--declaration` / `--visibility` 时程序会自动展开
- 发布前后会自动截图保存到账号目录的 `screenshots/` 文件夹（`video-before-publish-*` 和 `video-after-publish-*`），便于排查问题
