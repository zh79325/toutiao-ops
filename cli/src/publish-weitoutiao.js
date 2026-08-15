import { readFileSync, existsSync } from 'fs';
import { dirname, resolve, isAbsolute } from 'path';
import { launchBrowser, closeBrowser, sleep, waitForStable, dismissOverlays } from './browser.js';
import { ensureLoggedIn } from './auth-guard.js';

const PUBLISH_URL = 'https://mp.toutiao.com/profile_v4/weitoutiao/publish';

/**
 * 发布微头条。
 * 参数:
 *   --content      微头条正文（与 --content-file 二选一）
 *   --content-file JSON 文件路径（支持 newspic.json 格式：title/paragraphs/images/ad_blocks）
 *   --images       图片路径，逗号分隔（优先级高于 JSON 中的 images）
 *   --topic        话题名称（不含 #）
 *   --first-publish 勾选"头条首发"
 *   --declaration  作品声明，逗号分隔，可选值: 取材网络,引用站内,个人观点,引用AI,虚构演绎,投资观点,健康医疗
 *   --draft        存草稿而非发布
 */
export async function publishWeitoutiao(opts) {
  console.log('[weitoutiao] 启动发布流程');

  const { content, imagePaths, baseDir } = await loadInput(opts);
  console.log(`[weitoutiao] 内容长度: ${content.length} 字`);
  console.log(`[weitoutiao] 图片数量: ${imagePaths.length} 张`);
  if (imagePaths.length > 0) {
    imagePaths.forEach((p, i) => console.log(`[weitoutiao]   图片 ${i + 1}: ${p}`));
  }

  const headless = Boolean(opts.headless);
  console.log(`[weitoutiao] 启动浏览器（${headless ? '无头' : '有头'}模式）`);
  const { context, page } = await launchBrowser(opts);

  try {
    console.log('[weitoutiao] 检查登录状态');
    await ensureLoggedIn(page);

    console.log(`[weitoutiao] 打开发布页: ${PUBLISH_URL}`);
    await page.goto(PUBLISH_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await waitForStable(page);
    await sleep(1500, 2500);
    await dismissOverlays(page);

    // ── 输入内容 ──
    const editorSelector = [
      '[contenteditable="true"]',
      '[class*="editor"] [contenteditable]',
      'textarea',
    ].join(', ');
    console.log('[weitoutiao] 等待编辑器加载');
    await page.waitForSelector(editorSelector, { timeout: 15000 });
    await sleep(300, 600);
    console.log('[weitoutiao] 点击编辑器');
    await page.click(editorSelector, { force: true });
    await sleep(200, 400);

    const paragraphs = content.split('\n');
    console.log(`[weitoutiao] 开始输入正文，共 ${paragraphs.length} 段`);
    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i];
      if (para) {
        console.log(`[weitoutiao] 输入第 ${i + 1}/${paragraphs.length} 段`);
        await page.keyboard.type(para, { delay: 40 + Math.random() * 80 });
      }
      if (i < paragraphs.length - 1) {
        await page.keyboard.press('Enter');
        await sleep(100, 300);
      }
    }
    console.log('[weitoutiao] 正文输入完成');
    await sleep(500, 1000);

    // ── 图片上传 ──
    if (imagePaths.length > 0) {
      console.log('[weitoutiao] 开始上传图片');
      await uploadImages(page, imagePaths);
      console.log('[weitoutiao] 图片上传完成');
    }
    await sleep(500, 1000);

    // ── 话题 ──
    if (opts.topic) {
      console.log(`[weitoutiao] 设置话题: #${opts.topic}`);
      await setTopic(page, opts.topic);
    }
    await sleep(300, 600);

    // ── 声明首发 ──
    if (opts.firstPublish) {
      console.log('[weitoutiao] 勾选"头条首发"');
      await checkFirstPublish(page);
    }
    await sleep(300, 600);

    // ── 作品声明 ──
    if (opts.declaration) {
      console.log(`[weitoutiao] 设置作品声明: ${opts.declaration}`);
      await setDeclarations(page, opts.declaration);
    }
    await sleep(500, 1000);

    // ── 发布 / 存草稿 ──
    await dismissOverlays(page);

    if (opts.draft) {
      console.log('[weitoutiao] 点击"存草稿"');
      const draftBtn = page.locator('button:has-text("存草稿")').first();
      await draftBtn.click({ timeout: 10000 });
    } else {
      console.log('[weitoutiao] 点击"发布"');
      const publishBtn = page.locator('button:has-text("发布")').first();
      await publishBtn.click({ timeout: 10000 });
    }

    await sleep(2000, 4000);
    await waitForStable(page);

    const result = {
      success: true,
      action: opts.draft ? 'draft_saved' : 'published',
      content: content.substring(0, 50) + (content.length > 50 ? '...' : ''),
      url: page.url(),
    };
    console.log(`[weitoutiao] 操作完成: ${result.action}`);
    console.log(`[weitoutiao] 当前页面: ${result.url}`);
    return result;
  } finally {
    console.log('[weitoutiao] 关闭浏览器');
    await closeBrowser(context);
  }
}

/**
 * 统一读取输入：支持 --content 直接传入或 --content-file 读取 newspic.json。
 */
async function loadInput(opts) {
  let content = '';
  let imagePaths = [];
  let baseDir = process.cwd();

  if (opts.contentFile) {
    console.log(`[weitoutiao] 读取 JSON 文件: ${opts.contentFile}`);
    if (!existsSync(opts.contentFile)) {
      throw new Error(`文件不存在: ${opts.contentFile}`);
    }
    const raw = readFileSync(opts.contentFile, 'utf-8');
    let data;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      throw new Error(`JSON 解析失败：${e.message}`);
    }

    baseDir = dirname(opts.contentFile);

    const title = data.title || '';
    const paragraphs = Array.isArray(data.paragraphs)
      ? data.paragraphs.filter(p => typeof p === 'string' && p.trim())
      : [];

    if (title) {
      content = title + '\n\n' + paragraphs.join('\n\n');
    } else {
      content = paragraphs.join('\n\n');
    }

    if (Array.isArray(data.images)) {
      imagePaths = data.images
        .map(p => resolveImagePath(p, baseDir))
        .filter(p => existsSync(p));
    }

    console.log(`[weitoutiao] JSON 解析成功: title=${title ? '有' : '无'}, paragraphs=${paragraphs.length}, images=${data.images?.length || 0}`);
  }

  if (opts.content) {
    content = opts.content.replace(/\\n/g, '\n');
    console.log('[weitoutiao] 使用 --content 参数覆盖或作为正文');
  }

  // 命令行 --images 优先级最高
  if (opts.images) {
    imagePaths = opts.images.split(',').map(p => p.trim()).filter(Boolean);
    console.log('[weitoutiao] 使用 --images 参数覆盖图片列表');
  }

  if (!content.trim()) {
    throw new Error('微头条内容不能为空');
  }

  return { content, imagePaths, baseDir };
}

function resolveImagePath(p, baseDir) {
  if (isAbsolute(p)) return p;
  return resolve(baseDir, p);
}

async function uploadImages(page, imagePaths) {
  const maxImages = 9;
  const paths = imagePaths.slice(0, maxImages);
  if (imagePaths.length > maxImages) {
    console.log(`[weitoutiao] 图片超过 ${maxImages} 张，仅上传前 ${maxImages} 张`);
  }

  try {
    console.log('[weitoutiao] 点击"图片"按钮打开上传对话框');
    const imgBtn = page.locator('text=图片').first();
    await imgBtn.click({ timeout: 5000 });
    await sleep(800, 1200);

    console.log(`[weitoutiao] 选择文件: ${paths.join(', ')}`);
    const fileInput = page.locator('input[type="file"][accept*="image"]').first();
    await fileInput.setInputFiles(paths);
    console.log('[weitoutiao] 等待图片上传');
    await sleep(3000, 5000);

    console.log('[weitoutiao] 点击"确定"按钮关闭上传对话框');
    const confirmBtn = page.locator('button:has-text("确定")').first();
    await confirmBtn.waitFor({ timeout: 10000 });
    await sleep(500, 800);
    await confirmBtn.click();
    await sleep(1000, 2000);
  } catch (err) {
    console.error(`[weitoutiao] 图片上传失败: ${err.message}`);
    // 图片上传失败不阻塞发布
  }
}

async function setTopic(page, topicName) {
  try {
    const topicBtn = page.locator('text=话题').first();
    await topicBtn.click({ timeout: 5000 });
    await sleep(500, 800);

    const topicInput = page.locator('input[placeholder*="话题"], input[placeholder*="搜索"], [class*="topic"] input').first();
    await topicInput.fill(topicName, { timeout: 5000 });
    await sleep(800, 1200);

    // 选择第一个搜索结果
    const firstResult = page.locator('[class*="topic"] [class*="item"], [class*="search-result"] [class*="item"], [class*="option"]').first();
    await firstResult.click({ timeout: 5000 }).catch(async () => {
      await page.keyboard.press('Enter');
    });
    await sleep(300, 600);
  } catch (err) {
    console.error(`[weitoutiao] 话题设置失败: ${err.message}`);
    // 话题设置失败不阻塞
  }
}

async function checkFirstPublish(page) {
  try {
    const checkbox = page.locator('text=头条首发').first();
    await checkbox.click({ timeout: 5000 });
    await sleep(200, 400);
  } catch (err) {
    console.error(`[weitoutiao] 头条首发勾选失败: ${err.message}`);
    // 首发勾选失败不阻塞
  }
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
      await checkbox.click({ timeout: 3000 });
      await sleep(200, 400);
    } catch {
      // 单个声明勾选失败不阻塞
    }
  }
}
