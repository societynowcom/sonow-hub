#!/usr/bin/env node

/**
 * MD → HTML 변환기 + sitemap.xml (HTML URL) 재생성
 * generate-md.js 이후 실행
 *
 * 역할:
 *  1. [카테고리]/articles/*.md → .html 변환 (SEO 풀 메타태그)
 *  2. sitemap.xml 재생성 (HTML URL 기준)
 *  3. .nojekyll 생성 (GitHub Pages Jekyll 방지)
 */

const fs   = require('fs');
const path = require('path');

const HUB_ROOT = path.join(__dirname, '..');
const BASE_URL = 'https://societynowcom.github.io/sonow-hub';
const GROUPS   = ['headlines', 'tech-ai', 'economy', 'education', 'k-culture'];
const FORCE    = process.argv.includes('--force');

// ─── Front Matter 파싱 ───────────────────────────────────────
function parseFrontMatter(content) {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return { meta: {}, body: content };

    const meta = {};
    for (const line of match[1].split('\n')) {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const key   = line.slice(0, idx).trim();
        const value = line.slice(idx + 1).trim()
            .replace(/^"(.*)"$/, '$1')  // 바깥 따옴표 제거
            .replace(/\\"/g, '"');      // \" → " 언이스케이프
        meta[key] = value;
    }
    return { meta, body: content.slice(match[0].length).trim() };
}

// ─── HTML 엔티티 이스케이프 (속성값 전용) ─────────────────────
function esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ─── 인라인 Markdown → HTML ──────────────────────────────────
function inlineToHtml(text) {
    return text
        // 링크: .md → .html 자동 변환
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
            const h = href.replace(/\.md(#[^)]*)?(\)?)$/, '.html$1$2').replace(/\.md$/, '.html');
            return `<a href="${h}">${label}</a>`;
        })
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g,   '<em>$1</em>');
}

// ─── Markdown 본문 → HTML ────────────────────────────────────
function mdToHtml(md) {
    const lines  = md.split('\n');
    const output = [];
    let i = 0;

    while (i < lines.length) {
        const raw     = lines[i];
        const trimmed = raw.trim();

        // 빈 줄
        if (!trimmed) { output.push(''); i++; continue; }

        // 수평선
        if (trimmed === '---') { output.push('<hr>'); i++; continue; }

        // 제목
        const h3 = trimmed.match(/^### (.+)$/);
        if (h3) { output.push(`<h3>${inlineToHtml(h3[1])}</h3>`); i++; continue; }

        const h2 = trimmed.match(/^## (.+)$/);
        if (h2) { output.push(`<h2>${inlineToHtml(h2[1])}</h2>`); i++; continue; }

        const h1 = trimmed.match(/^# (.+)$/);
        if (h1) { output.push(`<h1>${inlineToHtml(h1[1])}</h1>`); i++; continue; }

        // 인용문
        if (trimmed.startsWith('> ')) {
            output.push(`<blockquote>${inlineToHtml(trimmed.slice(2))}</blockquote>`);
            i++; continue;
        }

        // 목록 (연속된 - 항목을 하나의 <ul>로 묶음)
        if (trimmed.startsWith('- ')) {
            const items = [];
            while (i < lines.length && lines[i].trim().startsWith('- ')) {
                items.push(`<li>${inlineToHtml(lines[i].trim().slice(2))}</li>`);
                i++;
            }
            output.push(`<ul>${items.join('')}</ul>`);
            continue;
        }

        // 일반 단락
        output.push(`<p>${inlineToHtml(trimmed)}</p>`);
        i++;
    }

    return output.filter((l, idx, arr) => !(l === '' && arr[idx - 1] === '')).join('\n');
}

// ─── HTML 페이지 조립 ────────────────────────────────────────
function buildHtmlPage(meta, bodyHtml, canonicalUrl) {
    const title       = meta.title       || 'SO,NOW 뉴스';
    const description = meta.description || '';
    const keywords    = meta.keywords    || '';
    const image       = meta.image       || '';
    const date        = meta.date        || '';
    const category    = meta.category    || '';
    const sourceUrl   = meta.url         || 'https://society-now.com';

    const structuredData = JSON.stringify({
        '@context':         'https://schema.org',
        '@type':            'NewsArticle',
        'headline':         title,
        'description':      description,
        'datePublished':    date,
        'dateModified':     date,
        'image':            image ? [image] : [],
        'author':           { '@type': 'Organization', 'name': 'SO,NOW' },
        'publisher': {
            '@type': 'Organization',
            'name':  'SO,NOW',
            'url':   'https://society-now.com'
        },
        'url':              canonicalUrl,
        'mainEntityOfPage': canonicalUrl,
        'articleSection':   category
    });

    return `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${esc(title)} | SO,NOW</title>
  <meta name="description" content="${esc(description)}">
  ${keywords ? `<meta name="keywords" content="${esc(keywords)}">` : ''}
  <meta property="og:type"        content="article">
  <meta property="og:title"       content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  ${image ? `<meta property="og:image" content="${image}">` : ''}
  <meta property="og:url"         content="${canonicalUrl}">
  <meta property="og:locale"      content="ko_KR">
  <meta property="og:site_name"   content="SO,NOW">
  <meta name="twitter:card"        content="summary_large_image">
  <meta name="twitter:title"       content="${esc(title)}">
  <meta name="twitter:description" content="${esc(description)}">
  ${image ? `<meta name="twitter:image" content="${image}">` : ''}
  <link rel="canonical" href="${canonicalUrl}">
  <script type="application/ld+json">${structuredData}</script>
  <style>
    *{box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:800px;margin:0 auto;padding:1.2rem 1.5rem;color:#222;line-height:1.75;font-size:1rem}
    h1{font-size:1.55rem;line-height:1.3;margin-bottom:.4rem}
    h2{font-size:1.15rem;border-bottom:1px solid #e5e5e5;padding-bottom:.3rem;margin-top:2rem}
    h3{font-size:1rem;margin-top:1.5rem}
    a{color:#1a6eb0;text-decoration:none}a:hover{text-decoration:underline}
    blockquote{border-left:4px solid #1a6eb0;margin:1rem 0;padding:.6rem 1rem;background:#f0f5ff;border-radius:0 4px 4px 0}
    blockquote p{margin:0}
    ul{padding-left:1.4rem}li{margin:.3rem 0}
    hr{border:none;border-top:1px solid #e5e5e5;margin:1.5rem 0}
    pre{background:#f6f8fa;padding:1rem;border-radius:6px;overflow-x:auto}
    code{font-size:.88em}
    .meta{color:#666;font-size:.88rem;margin-bottom:1.2rem}
    footer{margin-top:2.5rem;padding-top:1rem;border-top:1px solid #e5e5e5;font-size:.85rem;color:#666}
  </style>
</head>
<body>
  <article>
${bodyHtml}
  </article>
  <footer>
    <p>
      <a href="${sourceUrl}">→ 전체 기사: Society-Now</a>
      &nbsp;|&nbsp;
      <a href="${BASE_URL}/">SO,NOW Hub 홈</a>
    </p>
  </footer>
</body>
</html>`;
}

// ─── URL 인코딩 (한글 파일명 처리) ──────────────────────────
function encodePathSegment(seg) {
    return encodeURIComponent(seg).replace(/%2F/g, '/');
}

// ─── 메인 ────────────────────────────────────────────────────
async function main() {
    console.log('══════════════════════════════════════════════');
    console.log('  SO,NOW HTML 변환기 + Sitemap 생성');
    console.log(`  모드: ${FORCE ? '--force (전체 재생성)' : '증분 (신규/변경만)'}`);
    console.log('══════════════════════════════════════════════\n');

    const today = new Date().toISOString().slice(0, 10);
    let htmlCreated = 0;
    let htmlSkipped = 0;
    const sitemapUrls = [];

    // 메인/카테고리 페이지 sitemap 항목
    sitemapUrls.push({ url: `${BASE_URL}/`,  lastmod: today, changefreq: 'daily',   priority: '1.0' });
    for (const group of GROUPS) {
        sitemapUrls.push({ url: `${BASE_URL}/${group}/`, lastmod: today, changefreq: 'daily', priority: '0.8' });
    }

    // ─── MD → HTML 변환 ──────────────────────────────────────
    for (const group of GROUPS) {
        const articlesDir = path.join(HUB_ROOT, group, 'articles');
        if (!fs.existsSync(articlesDir)) continue;

        const mdFiles = fs.readdirSync(articlesDir).filter(f => f.endsWith('.md'));
        console.log(`  [${group}] ${mdFiles.length}개 MD 처리 중...`);

        for (const mdFile of mdFiles) {
            const mdPath   = path.join(articlesDir, mdFile);
            const htmlFile = mdFile.replace(/\.md$/, '.html');
            const htmlPath = path.join(articlesDir, htmlFile);

            const encodedFile  = encodePathSegment(htmlFile);
            const canonicalUrl = `${BASE_URL}/${group}/articles/${encodedFile}`;
            const articleDate  = (() => {
                // article 날짜: 파일명 앞 YYYY-MM-DD 패턴에서 추출
                const dm = mdFile.match(/^(\d{4}-\d{2}-\d{2})/);
                return dm ? dm[1] : today;
            })();

            sitemapUrls.push({
                url: canonicalUrl, lastmod: articleDate, changefreq: 'monthly', priority: '0.6'
            });

            // 스킵 조건: HTML이 MD보다 최신이고 --force 없음
            if (!FORCE && fs.existsSync(htmlPath)) {
                const mdStat   = fs.statSync(mdPath);
                const htmlStat = fs.statSync(htmlPath);
                if (htmlStat.mtimeMs >= mdStat.mtimeMs) {
                    htmlSkipped++;
                    continue;
                }
            }

            // MD 읽기 + 파싱 + 변환
            const content          = fs.readFileSync(mdPath, 'utf-8');
            const { meta, body }   = parseFrontMatter(content);
            const bodyHtml         = mdToHtml(body);
            const htmlContent      = buildHtmlPage(meta, bodyHtml, canonicalUrl);

            fs.writeFileSync(htmlPath, htmlContent, 'utf-8');
            htmlCreated++;
        }
    }

    console.log(`\n  HTML 생성: ${htmlCreated}개, 스킵(최신): ${htmlSkipped}개\n`);

    // ─── sitemap.xml 재생성 (HTML URL 기준) ──────────────────
    console.log('  sitemap.xml 생성 중...');
    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    sitemap    += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;
    for (const { url, lastmod, changefreq, priority } of sitemapUrls) {
        sitemap += `  <url>\n`;
        sitemap += `    <loc>${url}</loc>\n`;
        sitemap += `    <lastmod>${lastmod}</lastmod>\n`;
        sitemap += `    <changefreq>${changefreq}</changefreq>\n`;
        sitemap += `    <priority>${priority}</priority>\n`;
        sitemap += `  </url>\n`;
    }
    sitemap += `</urlset>\n`;
    fs.writeFileSync(path.join(HUB_ROOT, 'sitemap.xml'), sitemap, 'utf-8');
    console.log(`  → ${sitemapUrls.length}개 URL 등록\n`);

    // ─── .nojekyll (GitHub Pages Jekyll 처리 방지) ───────────
    const nojekyllPath = path.join(HUB_ROOT, '.nojekyll');
    if (!fs.existsSync(nojekyllPath)) {
        fs.writeFileSync(nojekyllPath, '', 'utf-8');
        console.log('  .nojekyll 생성\n');
    }

    console.log('══════════════════════════════════════════════');
    console.log(`  완료! HTML ${htmlCreated}개 생성 | Sitemap ${sitemapUrls.length}개 URL`);
    console.log('══════════════════════════════════════════════');
}

main().catch(err => {
    console.error('오류:', err.message);
    process.exit(1);
});
