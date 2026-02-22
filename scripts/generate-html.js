#!/usr/bin/env node

/**
 * MD → HTML 변환기 + sitemap.xml (HTML URL) 재생성
 * generate-md.js 이후 실행
 *
 * 역할:
 *  1. [카테고리]/articles/*.md → .html 변환 (SEO 풀 메타태그)
 *  2. README.md → index.html 변환 (루트 + 5개 카테고리)
 *  3. sitemap.xml 재생성 (HTML URL 기준)
 *  4. .nojekyll 생성 (GitHub Pages Jekyll 방지)
 *
 * 링크 변환 규칙:
 *  - /sonow/...  →  https://society-now.com/sonow/...  (절대 URL)
 *  - README.md   →  index.html
 *  - *.md        →  *.html
 */

const fs   = require('fs');
const path = require('path');

const HUB_ROOT = path.join(__dirname, '..');
const BASE_URL = 'https://societynowcom.github.io/sonow-hub';
const GROUPS   = ['headlines', 'tech-ai', 'economy', 'education', 'k-culture'];
const FORCE    = process.argv.includes('--force');

// ─── 공통 CSS ───────────────────────────────────────────────
const CSS = [
    '<style>',
    '*{box-sizing:border-box}',
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;max-width:800px;margin:0 auto;padding:1.2rem 1.5rem;color:#222;line-height:1.75;font-size:1rem}',
    'h1{font-size:1.55rem;line-height:1.3;margin-bottom:.4rem}',
    'h2{font-size:1.15rem;border-bottom:1px solid #e5e5e5;padding-bottom:.3rem;margin-top:2rem}',
    'h3{font-size:1rem;margin-top:1.5rem}',
    'a{color:#1a6eb0;text-decoration:none}a:hover{text-decoration:underline}',
    'blockquote{border-left:4px solid #1a6eb0;margin:1rem 0;padding:.6rem 1rem;background:#f0f5ff;border-radius:0 4px 4px 0}',
    'blockquote p{margin:0}',
    'ul{padding-left:1.4rem}li{margin:.3rem 0}',
    'hr{border:none;border-top:1px solid #e5e5e5;margin:1.5rem 0}',
    'table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:.92rem}',
    'th,td{border:1px solid #e5e5e5;padding:.45rem .7rem;text-align:left}',
    'th{background:#f5f5f5;font-weight:600}',
    'tr:nth-child(even) td{background:#fafafa}',
    'footer{margin-top:2.5rem;padding-top:1rem;border-top:1px solid #e5e5e5;font-size:.85rem;color:#666}',
    '</style>'
].join('\n');

// ─── Front Matter 파싱 ──────────────────────────────────────
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
            .replace(/\\"/g, '"');       // \" → " 언이스케이프
        meta[key] = value;
    }
    return { meta, body: content.slice(match[0].length).trim() };
}

// ─── HTML 속성값 이스케이프 ──────────────────────────────────
function esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// ─── 링크 href 변환 ─────────────────────────────────────────
function rewriteHref(href) {
    // society-now.com 상대 URL → 절대 URL
    if (href.startsWith('/sonow/') || href.startsWith('/article/')) {
        return 'https://society-now.com' + href;
    }
    // README.md → index.html (홈/카테고리 링크)
    if (href === 'README.md' || href.endsWith('/README.md')) {
        return href.replace(/README\.md$/, 'index.html');
    }
    // 일반 .md → .html
    return href.replace(/\.md$/, '.html');
}

// ─── 인라인 Markdown → HTML ─────────────────────────────────
function inlineToHtml(text) {
    return text
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
            return '<a href="' + rewriteHref(href) + '">' + label + '</a>';
        })
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g,   '<em>$1</em>');
}

// ─── 테이블 변환 ────────────────────────────────────────────
function convertTable(rows) {
    // 구분선 행 제거 (|---|---|)
    const dataRows = rows.filter(r => !r.match(/^\|[\s\-|:]+\|$/));
    if (dataRows.length === 0) return '';

    let html = '<table>\n';
    dataRows.forEach((row, idx) => {
        const cells = row.replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const tag   = idx === 0 ? 'th' : 'td';
        html += '  <tr>' + cells.map(c => '<' + tag + '>' + inlineToHtml(c) + '</' + tag + '>').join('') + '</tr>\n';
    });
    html += '</table>';
    return html;
}

// ─── Markdown 본문 → HTML ───────────────────────────────────
function mdToHtml(md) {
    // HTML 주석 제거 (AUTO-UPDATE 마커)
    md = md.replace(/<!--[\s\S]*?-->/g, '');

    const lines  = md.split('\n');
    const output = [];
    let i = 0;

    while (i < lines.length) {
        const trimmed = lines[i].trim();

        // 빈 줄
        if (!trimmed) { output.push(''); i++; continue; }

        // 수평선
        if (trimmed === '---') { output.push('<hr>'); i++; continue; }

        // 제목
        const h3 = trimmed.match(/^### (.+)$/);
        if (h3) { output.push('<h3>' + inlineToHtml(h3[1]) + '</h3>'); i++; continue; }
        const h2 = trimmed.match(/^## (.+)$/);
        if (h2) { output.push('<h2>' + inlineToHtml(h2[1]) + '</h2>'); i++; continue; }
        const h1 = trimmed.match(/^# (.+)$/);
        if (h1) { output.push('<h1>' + inlineToHtml(h1[1]) + '</h1>'); i++; continue; }

        // 인용문
        if (trimmed.startsWith('> ')) {
            output.push('<blockquote>' + inlineToHtml(trimmed.slice(2)) + '</blockquote>');
            i++; continue;
        }

        // 테이블
        if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
            const tableRows = [];
            while (i < lines.length && lines[i].trim().startsWith('|')) {
                tableRows.push(lines[i].trim());
                i++;
            }
            output.push(convertTable(tableRows));
            continue;
        }

        // 목록
        if (trimmed.startsWith('- ')) {
            const items = [];
            while (i < lines.length && lines[i].trim().startsWith('- ')) {
                items.push('<li>' + inlineToHtml(lines[i].trim().slice(2)) + '</li>');
                i++;
            }
            output.push('<ul>' + items.join('') + '</ul>');
            continue;
        }

        // 일반 단락
        output.push('<p>' + inlineToHtml(trimmed) + '</p>');
        i++;
    }

    // 연속 빈 줄 제거
    return output.filter((l, idx, arr) => !(l === '' && arr[idx - 1] === '')).join('\n');
}

// ─── 기사 HTML 페이지 ────────────────────────────────────────
function buildArticleHtml(meta, bodyHtml, canonicalUrl) {
    const title       = meta.title       || 'SO,NOW 뉴스';
    const description = meta.description || '';
    const keywords    = meta.keywords    || '';
    const image       = meta.image       || '';
    const date        = meta.date        || '';
    const category    = meta.category    || '';

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

    return '<!DOCTYPE html>\n' +
        '<html lang="ko">\n' +
        '<head>\n' +
        '  <meta charset="UTF-8">\n' +
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
        '  <title>' + esc(title) + ' | SO,NOW</title>\n' +
        '  <meta name="description" content="' + esc(description) + '">\n' +
        (keywords ? '  <meta name="keywords" content="' + esc(keywords) + '">\n' : '') +
        '  <meta property="og:type"        content="article">\n' +
        '  <meta property="og:title"       content="' + esc(title) + '">\n' +
        '  <meta property="og:description" content="' + esc(description) + '">\n' +
        (image ? '  <meta property="og:image" content="' + image + '">\n' : '') +
        '  <meta property="og:url"         content="' + canonicalUrl + '">\n' +
        '  <meta property="og:locale"      content="ko_KR">\n' +
        '  <meta property="og:site_name"   content="SO,NOW">\n' +
        '  <meta name="twitter:card"        content="summary_large_image">\n' +
        '  <meta name="twitter:title"       content="' + esc(title) + '">\n' +
        '  <meta name="twitter:description" content="' + esc(description) + '">\n' +
        (image ? '  <meta name="twitter:image" content="' + image + '">\n' : '') +
        '  <link rel="canonical" href="' + canonicalUrl + '">\n' +
        '  <script type="application/ld+json">' + structuredData + '</script>\n' +
        CSS + '\n' +
        '</head>\n' +
        '<body>\n' +
        '  <article>\n' +
        bodyHtml + '\n' +
        '  </article>\n' +
        '</body>\n' +
        '</html>';
}

// ─── 카테고리/루트 index.html ────────────────────────────────
function buildIndexHtml(title, bodyHtml, canonicalUrl) {
    return '<!DOCTYPE html>\n' +
        '<html lang="ko">\n' +
        '<head>\n' +
        '  <meta charset="UTF-8">\n' +
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
        '  <title>' + esc(title) + ' | SO,NOW Hub</title>\n' +
        '  <meta property="og:title"     content="' + esc(title) + '">\n' +
        '  <meta property="og:url"       content="' + canonicalUrl + '">\n' +
        '  <meta property="og:locale"    content="ko_KR">\n' +
        '  <meta property="og:site_name" content="SO,NOW">\n' +
        '  <link rel="canonical" href="' + canonicalUrl + '">\n' +
        CSS + '\n' +
        '</head>\n' +
        '<body>\n' +
        '  <main>\n' +
        bodyHtml + '\n' +
        '  </main>\n' +
        '  <footer>\n' +
        '    <p><a href="' + BASE_URL + '/">SO,NOW Hub 홈</a></p>\n' +
        '  </footer>\n' +
        '</body>\n' +
        '</html>';
}

// ─── URL 인코딩 ─────────────────────────────────────────────
function encodePath(seg) {
    return encodeURIComponent(seg).replace(/%2F/g, '/');
}

// ─── README.md → index.html 변환 ────────────────────────────
function convertReadme(mdPath, indexPath, title, canonicalUrl) {
    if (!fs.existsSync(mdPath)) return false;
    if (!FORCE && fs.existsSync(indexPath)) {
        if (fs.statSync(indexPath).mtimeMs >= fs.statSync(mdPath).mtimeMs) return false;
    }
    const content  = fs.readFileSync(mdPath, 'utf-8');
    const bodyHtml = mdToHtml(content);
    fs.writeFileSync(indexPath, buildIndexHtml(title, bodyHtml, canonicalUrl), 'utf-8');
    return true;
}

// ─── 메인 ───────────────────────────────────────────────────
async function main() {
    console.log('══════════════════════════════════════════════');
    console.log('  SO,NOW HTML 변환기 + Sitemap 생성');
    console.log('  모드: ' + (FORCE ? '--force (전체 재생성)' : '증분 (신규/변경만)'));
    console.log('══════════════════════════════════════════════\n');

    const today = new Date().toISOString().slice(0, 10);
    let htmlCreated = 0;
    let htmlSkipped = 0;
    const sitemapUrls = [];

    // sitemap: 메인/카테고리 페이지
    sitemapUrls.push({ url: BASE_URL + '/',  lastmod: today, changefreq: 'daily', priority: '1.0' });
    for (const group of GROUPS) {
        sitemapUrls.push({ url: BASE_URL + '/' + group + '/', lastmod: today, changefreq: 'daily', priority: '0.8' });
    }

    // ─── 1. README.md → index.html ───
    console.log('  [1] README.md → index.html 변환...');

    const GROUP_TITLES = {
        headlines: 'HEADLINES', 'tech-ai': 'TECH & AI',
        economy: 'ECONOMY', education: 'EDUCATION', 'k-culture': 'K-CULTURE'
    };

    // 루트
    if (convertReadme(
        path.join(HUB_ROOT, 'README.md'),
        path.join(HUB_ROOT, 'index.html'),
        'SO,NOW Hub', BASE_URL + '/'
    )) console.log('      → index.html (루트) 생성');

    // 카테고리
    for (const group of GROUPS) {
        if (convertReadme(
            path.join(HUB_ROOT, group, 'README.md'),
            path.join(HUB_ROOT, group, 'index.html'),
            GROUP_TITLES[group], BASE_URL + '/' + group + '/'
        )) console.log('      → ' + group + '/index.html 생성');
    }
    console.log('');

    // ─── 2. articles MD → HTML ───
    console.log('  [2] 기사 MD → HTML 변환...');
    for (const group of GROUPS) {
        const articlesDir = path.join(HUB_ROOT, group, 'articles');
        if (!fs.existsSync(articlesDir)) continue;

        const mdFiles = fs.readdirSync(articlesDir).filter(f => f.endsWith('.md'));
        console.log('      [' + group + '] ' + mdFiles.length + '개 처리 중...');

        for (const mdFile of mdFiles) {
            const mdPath   = path.join(articlesDir, mdFile);
            const htmlFile = mdFile.replace(/\.md$/, '.html');
            const htmlPath = path.join(articlesDir, htmlFile);

            const encodedFile  = encodePath(htmlFile);
            const canonicalUrl = BASE_URL + '/' + group + '/articles/' + encodedFile;
            const articleDate  = (mdFile.match(/^(\d{4}-\d{2}-\d{2})/) || [, today])[1];

            sitemapUrls.push({ url: canonicalUrl, lastmod: articleDate, changefreq: 'monthly', priority: '0.6' });

            // 스킵: HTML이 MD보다 최신이고 --force 없음
            if (!FORCE && fs.existsSync(htmlPath)) {
                if (fs.statSync(htmlPath).mtimeMs >= fs.statSync(mdPath).mtimeMs) {
                    htmlSkipped++;
                    continue;
                }
            }

            const content        = fs.readFileSync(mdPath, 'utf-8');
            const { meta, body } = parseFrontMatter(content);
            const bodyHtml       = mdToHtml(body);
            const htmlContent    = buildArticleHtml(meta, bodyHtml, canonicalUrl);

            fs.writeFileSync(htmlPath, htmlContent, 'utf-8');
            htmlCreated++;
        }
    }

    console.log('\n  HTML 생성: ' + htmlCreated + '개, 스킵(최신): ' + htmlSkipped + '개\n');

    // ─── 3. sitemap.xml ───
    console.log('  [3] sitemap.xml 생성 중...');
    let sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n';
    sitemap    += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    for (const { url, lastmod, changefreq, priority } of sitemapUrls) {
        sitemap += '  <url>\n';
        sitemap += '    <loc>' + url + '</loc>\n';
        sitemap += '    <lastmod>' + lastmod + '</lastmod>\n';
        sitemap += '    <changefreq>' + changefreq + '</changefreq>\n';
        sitemap += '    <priority>' + priority + '</priority>\n';
        sitemap += '  </url>\n';
    }
    sitemap += '</urlset>\n';
    fs.writeFileSync(path.join(HUB_ROOT, 'sitemap.xml'), sitemap, 'utf-8');
    console.log('      → ' + sitemapUrls.length + '개 URL 등록\n');

    // ─── 4. .nojekyll ───
    const nojekyllPath = path.join(HUB_ROOT, '.nojekyll');
    if (!fs.existsSync(nojekyllPath)) {
        fs.writeFileSync(nojekyllPath, '', 'utf-8');
        console.log('  .nojekyll 생성\n');
    }

    console.log('══════════════════════════════════════════════');
    console.log('  완료! HTML ' + htmlCreated + '개 생성 | Sitemap ' + sitemapUrls.length + '개 URL');
    console.log('══════════════════════════════════════════════');
}

main().catch(err => {
    console.error('오류:', err.message);
    process.exit(1);
});
