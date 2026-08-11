import { readFileSync, writeFileSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { marked } from 'marked';
import { launchBrowser, closeBrowser, sleep, waitForStable, dismissOverlays } from './browser.js';
import { ensureLoggedIn } from './auth-guard.js';

const PUBLISH_URL = 'https://mp.toutiao.com/profile_v4/graphic/publish';
const TITLE_MAX_LEN = 30;
const TITLE_MIN_LEN = 2;

/**
 * 发布图文文章。
 * 参数:
 *   --title          文章标题（必填，JSON 输入时可省略）
 *   --content        正文文本
 *   --content-file   从文件读取正文（.md / .html / .json；.json 会按 blocks 字段逐块渲染）
 *   --cover          封面图片路径（默认取 JSON 封面或第一张正文图片）
 *   --cover-mode     封面模式: single / triple / none（默认 single）
 *   --images         额外图片路径，逗号分隔（优先级高于正文内图片）
 *   --first-publish  勾选"头条首发"
 *   --collection     添加至合集名称
 *   --no-weitoutiao  取消"同时发布微头条"
 *   --declaration    作品声明，逗号分隔
 *   --draft          存草稿
 */
export async function publishArticle(opts) {
  const { context, page } = await launchBrowser(opts);
  try {
    await ensureLoggedIn(page);
    await page.goto(PUBLISH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForStable(page);
    await sleep(1500, 2500);
    await dismissOverlays(page);

    // ── 正文：先读取并解析，供标题/封面缺省使用 ──
    let content = opts.content || '';
    let contentBaseDir = process.cwd();
    if (opts.contentFile) {
      content = readFileSync(opts.contentFile, 'utf-8');
      contentBaseDir = dirname(opts.contentFile);
    }
    content = content.replace(/\\n/g, '\n');

    // 识别输入格式
    const isJson = opts.format === 'json' || opts.contentFile?.match(/\.json$/i);
    const isHtml = opts.format === 'html'
      || opts.contentFile?.match(/\.html$/i)
      || /^\s*</.test(content);

    // 解析结构化 JSON
    let jsonArticle = null;
    let jsonBlocks = [];
    if (isJson) {
      try {
        jsonArticle = JSON.parse(content);
      } catch (e) {
        throw new Error(`JSON 解析失败：${e.message}`);
      }
      jsonBlocks = Array.isArray(jsonArticle.blocks) ? jsonArticle.blocks : [];
    }

    // 收集正文内联图片 + --images 额外图片
    const inlineImages = [];
    const segments = parseContentSegments(content, contentBaseDir, isHtml, inlineImages);
    const extraImages = opts.images ? opts.images.split(',').map(p => p.trim()).filter(Boolean) : [];

    // 封面缺省使用：--cover > JSON 封面 > 第一张 --images > 第一张正文内联图片
    let coverPath = opts.cover;
    if (!coverPath && jsonArticle?.cover_image) {
      coverPath = resolveImagePath(jsonArticle.cover_image, contentBaseDir);
    }
    if (!coverPath) {
      coverPath = extraImages[0] || inlineImages[0];
    }

    // ── 标题（2~30 字） ──
    let title = opts.title;
    if (!title && jsonArticle?.title) {
      title = jsonArticle.title;
    }
    if (!title) {
      throw new Error('标题不能为空');
    }
    if (title.length < TITLE_MIN_LEN) {
      throw new Error(`标题过短：至少 ${TITLE_MIN_LEN} 个字，当前 ${title.length} 个字`);
    }
    if (title.length > TITLE_MAX_LEN) {
      title = title.slice(0, TITLE_MAX_LEN);
      process.stderr.write(`[warn] 标题超过 ${TITLE_MAX_LEN} 字限制，已自动截断为：${title}\n`);
    }
    const titleSelector = 'textarea[placeholder*="标题"], input[placeholder*="标题"], [class*="title"] textarea, [class*="title"] input';
    await page.waitForSelector(titleSelector, { timeout: 15000 });
    await sleep(300, 600);
    await page.click(titleSelector, { force: true });
    await page.keyboard.type(title, { delay: 50 + Math.random() * 80 });
    await sleep(500, 1000);

    if (content) {
      const editorSelector = '[contenteditable="true"]';
      await page.waitForSelector(editorSelector, { timeout: 15000 });
      await sleep(300, 600);
      await page.click(editorSelector, { force: true });
      await sleep(200, 400);

      if (jsonBlocks.length > 0) {
        // 结构化 JSON：严格按照 blocks 顺序一个元素一个元素插入，
        // 每次操作前先把光标强制移到编辑器末尾，避免顺序错乱
        for (let i = 0; i < jsonBlocks.length; i++) {
          const block = jsonBlocks[i];
          process.stderr.write(`[publish-article] block ${i + 1}/${jsonBlocks.length}: ${block.type}\n`);
          await insertJsonBlock(page, block, editorSelector, contentBaseDir);
        }
        // --images 追加
        const jsonInlineImages = collectJsonInlineImages(jsonBlocks, contentBaseDir);
        for (const imgPath of extraImages) {
          if (!jsonInlineImages.includes(resolveImagePath(imgPath, contentBaseDir))) {
            await focusEditorEnd(page, editorSelector);
            await uploadInlineImage(page, resolveImagePath(imgPath, contentBaseDir));
          }
        }
      } else if (segments.length > 0) {
        // 分段粘贴：文本段 + 图片段交替
        for (const seg of segments) {
          if (seg.type === 'image') {
            await uploadInlineImage(page, seg.path);
          } else if (seg.html) {
            await pasteHtml(page, seg.html, editorSelector);
          }
        }
        // --images 中未在正文出现的图片追加到末尾
        for (const imgPath of extraImages) {
          if (!inlineImages.includes(resolveImagePath(imgPath, contentBaseDir))) {
            await uploadInlineImage(page, resolveImagePath(imgPath, contentBaseDir));
          }
        }
      } else if (opts.format === 'markdown' || opts.contentFile?.match(/\.md$/i)) {
        await pasteMarkdownAsRichText(page, content, editorSelector);
      } else if (isHtml) {
        await pasteHtml(page, content, editorSelector);
      } else {
        await typePlainText(page, content);
      }
    }
    await sleep(500, 1000);

    // ── 展示封面 ──
    await setCoverMode(page, opts.coverMode || 'single', coverPath);
    await sleep(500, 1000);

    // ── 声明首发 ──
    if (opts.firstPublish) {
      await clickLabel(page, '头条首发');
    }
    await sleep(300, 500);

    // ── 合集 ──
    if (opts.collection) {
      await addToCollection(page, opts.collection);
    }
    await sleep(300, 500);

    // ── 同时发布微头条（默认已勾选，--no-weitoutiao 取消） ──
    if (opts.weitoutiao === false) {
      await uncheckWeitoutiao(page);
    }
    await sleep(300, 500);

    // ── 作品声明 ──
    if (opts.declaration) {
      await setDeclarations(page, opts.declaration);
    }
    await sleep(500, 1000);

    // ── 发布 / 草稿 ──
    await dismissOverlays(page);
    if (opts.draft) {
      // 页面底部没有独立草稿按钮，草稿已自动保存
      const editorHtml = await page.evaluate(() => {
        const editor = document.querySelector('[contenteditable="true"]');
        return editor ? editor.innerHTML : '';
      });
      const debugPath = '/Users/eleme/Desktop/AIWorker/toutiao-ops/temp/debug-heading-draft.html';
      writeFileSync(debugPath, `<!doctype html><html><body>${editorHtml}</body></html>`);
      return {
        success: true,
        action: 'draft_saved',
        title,
        url: page.url(),
        debugHtml: debugPath,
      };
    }

    // 点击"预览并发布"按钮
    await dismissOverlays(page);
    const publishBtn = page.locator('button:has-text("预览并发布")').first();
    await publishBtn.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(300, 500);
    await publishBtn.click({ force: true, timeout: 10000 });
    await sleep(3000, 5000);
    await waitForStable(page);

    // 预览页面需要再次点击"确认发布"
    const confirmPublish = page.locator('button:has-text("确认发布"), button:has-text("发布")').first();
    await confirmPublish.click({ timeout: 10000 }).catch(() => {});
    await sleep(2000, 4000);

    // 可能还有二次确认弹窗
    const confirmBtn = page.locator('button:has-text("确定"), button:has-text("确认")').first();
    await confirmBtn.click({ timeout: 5000 }).catch(() => {});

    await sleep(2000, 4000);
    await waitForStable(page);

    return {
      success: true,
      action: 'published',
      title,
      url: page.url(),
    };
  } finally {
    await closeBrowser(context);
  }
}

async function setCoverMode(page, mode, coverPath) {
  try {
    const modeLabels = {
      single: '单图',
      triple: '三图',
      none: '无封面',
    };
    const label = modeLabels[mode] || modeLabels.single;

    const radio = page.locator(`text=${label}`).first();
    await radio.click({ timeout: 5000 });
    await sleep(500, 800);

    if (mode !== 'none' && coverPath) {
      const paths = coverPath.split(',').map(p => p.trim()).filter(Boolean);

      // 点击封面区域的 + 号，打开图片上传侧边栏
      const coverArea = page.locator('[class*="cover"] [class*="add"], [class*="cover"] [class*="upload"], [class*="cover"] [class*="plus"]').first();
      await coverArea.click({ timeout: 5000 }).catch(async () => {
        // 备选：点击"预览"旁的 + 号
        await page.locator('[class*="cover-upload"]').first().click({ timeout: 3000 });
      });
      await sleep(1000, 2000);

      // 侧边栏打开后，点击"本地上传"按钮触发文件选择
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 10000 }),
        page.locator('text=本地上传').first().click({ timeout: 5000 }),
      ]);

      if (fileChooser) {
        await fileChooser.setFiles(paths);
        await sleep(3000, 5000);
      }

      // 等待图片上传完成，点击"确定"关闭侧边栏
      const confirmBtn = page.locator('.byte-drawer-wrapper button:has-text("确定"), .upload-image-panel button:has-text("确定")').first();
      await confirmBtn.waitFor({ timeout: 10000 });
      await sleep(500, 800);
      await confirmBtn.click();
      await sleep(1000, 2000);
    }
  } catch {
    // 封面上传失败，尝试关闭可能残留的侧边栏
    await page.locator('.byte-drawer-wrapper button:has-text("取消")').first()
      .click({ timeout: 3000 }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(500, 800);
  }
}

async function addToCollection(page, collectionName) {
  try {
    const addBtn = page.locator('text=添加至合集').first();
    await addBtn.click({ timeout: 5000 });
    await sleep(500, 1000);

    // 在弹出的合集选择面板中搜索或选择
    const searchInput = page.locator('[class*="collection"] input, [class*="search"] input').first();
    await searchInput.fill(collectionName, { timeout: 5000 }).catch(async () => {
      // 没有搜索框，直接找匹配的合集名
    });
    await sleep(500, 1000);

    const item = page.locator(`text=${collectionName}`).first();
    await item.click({ timeout: 5000 });
    await sleep(300, 600);

    // 点确认
    const confirmBtn = page.locator('button:has-text("确定"), button:has-text("确认")').first();
    await confirmBtn.click({ timeout: 3000 }).catch(() => {});
  } catch {
    // 合集添加失败不阻塞
  }
}

async function uncheckWeitoutiao(page) {
  try {
    // "同时发布微头条" 默认已勾选，点击取消
    const checkbox = page.locator('text=发布得更多收益').first();
    await checkbox.click({ timeout: 5000 });
    await sleep(200, 400);
  } catch {
    // 取消失败不阻塞
  }
}

async function clickLabel(page, labelText) {
  try {
    const el = page.locator(`text=${labelText}`).first();
    await el.scrollIntoViewIfNeeded().catch(() => {});
    await el.click({ timeout: 5000 });
    await sleep(200, 400);
  } catch {}
}

async function setDeclarations(page, declarationStr) {
  const declarations = declarationStr.split(',').map(d => d.trim()).filter(Boolean);
  const labelMap = {
    '取材网络': '取材网络',
    '引用站内': '引用站内',
    '个人观点': '个人观点，仅供参考',
    '引用AI': '引用AI',
    '虚构演绎': '虚构演绎，故事经历',
    '投资观点': '投资观点，仅供参考',
    '健康医疗': '健康医疗分享，仅供参考',
  };

  for (const decl of declarations) {
    const fullLabel = labelMap[decl] || decl;
    try {
      const checkbox = page.locator(`text=${fullLabel}`).first();
      await checkbox.scrollIntoViewIfNeeded().catch(() => {});
      await checkbox.click({ timeout: 3000 });
      await sleep(200, 400);
    } catch {}
  }
}

async function pasteMarkdownAsRichText(page, markdownContent, editorSelector) {
  const html = marked.parse(markdownContent, { breaks: true, gfm: true });
  await pasteHtml(page, html, editorSelector);
}

async function typePlainText(page, content) {
  const paragraphs = content.split('\n');
  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    if (para) {
      await page.keyboard.type(para, { delay: 30 + Math.random() * 50 });
    }
    if (i < paragraphs.length - 1) {
      await page.keyboard.press('Enter');
      await sleep(100, 300);
    }
  }
}

/**
 * 将 Markdown 或 HTML 内容按图片拆分为段落。
 * 返回 [{ type: 'text'|'image', html|path }] 数组。
 */
function parseContentSegments(content, baseDir, isHtml, outInlineImages) {
  // 统一先转成 HTML，再按 <img> 拆分
  let html = isHtml ? content : marked.parse(content, { breaks: true, gfm: true });

  const segments = [];
  const regex = /<img\s+[^>]*src="([^"]+)"[^>]*>/gi;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(html)) !== null) {
    const text = html.slice(lastIndex, match.index).trim();
    if (text) {
      segments.push({ type: 'text', html: text });
    }
    const path = resolveImagePath(match[1], baseDir);
    outInlineImages.push(path);
    segments.push({ type: 'image', path });
    lastIndex = regex.lastIndex;
  }

  const tail = html.slice(lastIndex).trim();
  if (tail) {
    segments.push({ type: 'text', html: tail });
  }

  return segments;
}

function resolveImagePath(src, baseDir) {
  if (!src || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
    return src;
  }
  if (src.startsWith('/')) {
    return src;
  }
  return resolve(baseDir, src);
}

function jsonBlockToHtml(block, baseDir) {
  switch (block.type) {
    case 'heading': {
      // 使用真实标题标签，让编辑器识别为标题样式；正文内标题从 h2 起
      const level = Math.min(Math.max(block.level || 2, 1), 6);
      const tag = `h${level}`;
      return `<${tag}>${block.text || ''}</${tag}>`;
    }
    case 'paragraph':
      return `<p>${block.text || ''}</p>`;
    case 'quote':
      return `<blockquote>${block.text || ''}</blockquote>`;
    case 'list': {
      const tag = block.ordered ? 'ol' : 'ul';
      const items = (block.items || []).map(i => `<li>${i}</li>`).join('');
      return `<${tag}>${items}</${tag}>`;
    }
    case 'code':
      return `<pre><code>${escapeHtml(block.text || '')}</code></pre>`;
    case 'table': {
      const rows = block.rows || [];
      if (!rows.length) return '';
      const head = rows[0].map(c => `<th>${escapeHtml(c)}</th>`).join('');
      const body = rows.slice(1).map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('');
      return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }
    case 'divider':
      return '<hr>';
    case 'image':
      // 图片块不通过 pasteHtml 插入，这里只返回 truthy 字符串用于分支判断
      return '<!-- image -->';
    default:
      return block.text ? `<p>${block.text}</p>` : '';
  }
}

async function focusEditorEnd(page, editorSelector) {
  await page.evaluate(
    (selector) => {
      const editor = document.querySelector(selector);
      if (!editor) return;
      editor.focus();
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    },
    editorSelector,
  );
  await sleep(200, 400);
}

async function insertJsonBlock(page, block, editorSelector, baseDir) {
  if (isImageBlock(block)) {
    await focusEditorEnd(page, editorSelector);
    await uploadInlineImage(page, resolveImagePath(block.src, baseDir));
    await sleep(2000, 3000);
    await focusEditorEnd(page, editorSelector);
    return;
  }

  const html = jsonBlockToHtml(block, baseDir);
  if (!html || html === '<!-- image -->') return;

  await pasteHtml(page, html, editorSelector);
  await sleep(1000, 1800);
}

function stripHtml(html) {
  return String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim();
}

function collectJsonInlineImages(blocks, baseDir) {
  const paths = [];
  for (const block of blocks) {
    if (block.type === 'image' && block.src) {
      paths.push(resolveImagePath(block.src, baseDir));
    }
  }
  return paths;
}

function isImageBlock(block) {
  return block && block.type === 'image';
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function pasteHtml(page, html, selector) {
  await page.evaluate(
    ({ html, selector }) => {
      const editor = document.querySelector(selector);
      if (!editor) return;
      editor.focus();

      // 直接 DOM 插入，避免 ClipboardEvent 触发编辑器自动全选导致后续操作覆盖
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);

      const fragment = document.createRange().createContextualFragment(html);
      range.insertNode(fragment);
      selection.collapseToEnd();
    },
    { html, selector },
  );
  await sleep(800, 1500);
}

async function uploadInlineImage(page, imagePath) {
  if (!imagePath) return;
  if (imagePath.startsWith('http://') || imagePath.startsWith('https://') || imagePath.startsWith('data:')) {
    return;
  }
  if (!existsSync(imagePath)) {
    process.stderr.write(`[warn] 图片不存在：${imagePath}\n`);
    return;
  }

  try {
    process.stderr.write(`[upload] 点击工具栏图片按钮\n`);
    const imgBtn = page.locator('[class*="toolbar"] [class*="image"]').first();
    await imgBtn.click({ timeout: 5000 });
    await sleep(1000, 1500);

    // 优先尝试页面已有的文件输入框；否则点击"本地上传"触发 filechooser
    const fileInput = page.locator('input[type="file"][accept*="image"]').first();
    const isVisible = await fileInput.isVisible().catch(() => false);
    if (isVisible) {
      process.stderr.write(`[upload] 通过文件输入框上传\n`);
      await fileInput.setInputFiles(imagePath);
    } else {
      process.stderr.write(`[upload] 点击本地上传触发 filechooser\n`);
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 10000 }),
        page.locator('text=本地上传').first().click({ timeout: 5000 }),
      ]);
      if (fileChooser) {
        await fileChooser.setFiles(imagePath);
      }
    }
    await sleep(2000, 3000);

    process.stderr.write(`[upload] 点击确定插入图片\n`);
    const confirmBtn = page.locator('.byte-modal-wrapper button:has-text("确定"), .byte-modal-wrapper button:has-text("确认"), .upload-image-panel button:has-text("确定"), .upload-image-panel button:has-text("确认")').first();
    await confirmBtn.click({ timeout: 10000 });
    await sleep(500, 1000);
    process.stderr.write(`[upload] 完成\n`);
  } catch (e) {
    process.stderr.write(`[upload] 失败：${e.message}\n`);
    // 上传失败不阻塞，关闭可能残留的弹窗
    await page.keyboard.press('Escape').catch(() => {});
    await sleep(500, 800);
  }
}
