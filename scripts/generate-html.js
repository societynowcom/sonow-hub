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
        // 배지형 이미지 링크 제거: [![alt](img)](link) → 링크 텍스트만
        .replace(/\[!\[[^\]]*\]\([^)]+\)\]\(([^)]+)\)/g, (_, href) => {
            return '<a href="' + rewriteHref(href) + '">[링크]</a>';
        })
        // 인라인 이미지 제거: ![alt](url) → alt 텍스트만
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        // 일반 링크: [text](url)
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
    // 배지 줄 제거: [![...](...)(...) 단독 줄
    md = md.replace(/^\[!\[.*?\]\(.*?\)\]\(.*?\)\s*$/gm, '');
    // 이미지 단독 줄 제거: ![...](...)
    md = md.replace(/^!\[.*?\]\(.*?\)\s*$/gm, '');

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
function buildArticleHtml(meta, bodyHtml, githubUrl) {
    const title       = meta.title       || 'SO,NOW 뉴스';
    const description = meta.description || '';
    const keywords    = meta.keywords    || '';
    const image       = meta.image       || '';
    const date        = meta.date        || '';
    const category    = meta.category    || '';

    // canonical = society-now.com 원본 URL
    // → GitHub DA 95 링크파워가 society-now.com으로 전달됨 (중복 콘텐츠 방지)
    let sourceUrl = meta.url || '';
    if (sourceUrl.startsWith('/')) sourceUrl = 'https://society-now.com' + sourceUrl;
    if (!sourceUrl) sourceUrl = githubUrl;  // fallback: URL 없는 경우만

    // og:image 상대경로 → 절대경로 (GitHub Pages에서 깨지지 않도록)
    let absImage = image;
    if (absImage && absImage.startsWith('/')) absImage = 'https://society-now.com' + absImage;

    const structuredData = JSON.stringify({
        '@context':         'https://schema.org',
        '@type':            'NewsArticle',
        'headline':         title,
        'description':      description,
        'datePublished':    date,
        'dateModified':     date,
        'image':            absImage ? [absImage] : [],
        'author':           { '@type': 'Organization', 'name': 'SO,NOW' },
        'publisher': {
            '@type': 'Organization',
            'name':  'SO,NOW',
            'url':   'https://society-now.com'
        },
        'url':              sourceUrl,
        'mainEntityOfPage': sourceUrl,
        'articleSection':   category
    });

    // hreflang: 다국어 연결 (중복 콘텐츠 방지 + 국가별 노출)
    const lang = meta.lang || 'ko';
    const ogLocale = { ko: 'ko_KR', en: 'en_US', ja: 'ja_JP', zh: 'zh_CN' }[lang] || 'ko_KR';
    const siteName = lang === 'ko' ? 'SO,NOW' : 'JustNow';
    const htmlLang = lang === 'zh' ? 'zh-Hans' : lang;

    // hreflang: 현재 언어 + x-default만 출력 (대응 기사 없는 언어는 빼야 SEO 안전)
    let hreflangTags = '';
    if (sourceUrl.includes('society-now.com') || sourceUrl.includes('justnow.kr')) {
        hreflangTags =
            '  <link rel="alternate" hreflang="' + lang + '" href="' + sourceUrl + '">\n' +
            '  <link rel="alternate" hreflang="x-default" href="' + sourceUrl + '">\n';
    }

    return '<!DOCTYPE html>\n' +
        '<html lang="' + htmlLang + '">\n' +
        '<head>\n' +
        '  <meta charset="UTF-8">\n' +
        '  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
        '  <title>' + esc(title) + ' | ' + siteName + '</title>\n' +
        '  <meta name="description" content="' + esc(description) + '">\n' +
        (keywords ? '  <meta name="keywords" content="' + esc(keywords) + '">\n' : '') +
        '  <meta property="og:type"        content="article">\n' +
        '  <meta property="og:title"       content="' + esc(title) + '">\n' +
        '  <meta property="og:description" content="' + esc(description) + '">\n' +
        (absImage ? '  <meta property="og:image" content="' + absImage + '">\n' : '') +
        '  <meta property="og:url"         content="' + sourceUrl + '">\n' +
        '  <meta property="og:locale"      content="' + ogLocale + '">\n' +
        '  <meta property="og:site_name"   content="' + siteName + '">\n' +
        '  <meta name="twitter:card"        content="summary_large_image">\n' +
        '  <meta name="twitter:title"       content="' + esc(title) + '">\n' +
        '  <meta name="twitter:description" content="' + esc(description) + '">\n' +
        (absImage ? '  <meta name="twitter:image" content="' + absImage + '">\n' : '') +
        '  <link rel="canonical" href="' + sourceUrl + '">\n' +
        hreflangTags +
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

// ─── 카테고리 코드 → 표시명 ─────────────────────────────────
const CAT_NAMES = {
    ai:'AI', ta:'Tech', an:'Tech', dt:'Tech', sn:'Tech', ax:'Tech', it:'Tech',
    hl:'헤드라인', pb:'정책', wr:'정치', lr:'지역', pi:'인물', td:'탐구', nw:'뉴스',
    kn:'경제', st:'주식', co:'코인', re:'부동산', di:'데이터', ins:'보험',
    ed:'교육', eg:'ESG', ap:'AI생산성', th:'생각', mh:'마음', ex:'세미나',
    kc:'K-문화', hk:'코리아', kt:'K-콘텐츠', kp:'K-POP', kb:'K-뷰티', kh:'K-헬스'
};
function getCatName(c) { return CAT_NAMES[c] || (c ? c.toUpperCase() : '기타'); }

// ─── 루트 허브 index.html 생성 (정적 HTML + 다크 테마) ───────
// 기사 링크를 HTML 소스에 직접 삽입 → 구글이 JS 없이 바로 크롤링
function buildHubIndexHtml(articles) {
    const today     = new Date().toISOString().slice(0, 10);
    const totalCnt  = articles.length;

    // 최신 날짜 기준 정렬
    const sorted = articles.slice().sort((a, b) => {
        const da = a.published_date || a.created_at || '';
        const db = b.published_date || b.created_at || '';
        return db.localeCompare(da);
    });

    const lastDate = sorted.length
        ? (sorted[0].published_date || sorted[0].created_at || '').slice(0, 10).replace(/-/g, '.')
        : '-';

    // 날짜 목록 (최근 7일)
    const dates = [...new Set(sorted.map(a => (a.published_date || a.created_at || '').slice(0, 10)))].slice(0, 7);
    // 카테고리 목록
    const cats  = [...new Set(sorted.map(a => a.category).filter(Boolean))];

    // 정적 기사 행 생성 (data-date, data-cat 속성으로 JS 필터링)
    const rows = sorted.map((a, i) => {
        const url   = esc(a.url || '#');
        const title = esc(a.title || '제목 없음');
        const cat   = a.category || '';
        const date  = (a.published_date || a.created_at || '').slice(0, 10).replace(/-/g, '.');
        const dateKey = (a.published_date || a.created_at || '').slice(0, 10);
        const cname = getCatName(cat);
        return '<tr data-date="' + dateKey + '" data-cat="' + esc(cat) + '">' +
            '<td class="ni">' + String(i + 1).padStart(2, '0') + '</td>' +
            '<td><span class="nc" data-cat="' + esc(cat) + '">' + cname + '</span>' +
            '<a href="' + url + '" target="_blank" rel="noopener" class="nt">' + title + '</a></td>' +
            '<td class="nd">' + date + '</td>' +
            '</tr>';
    }).join('\n');

    // 날짜 필터 버튼
    const dateButtons = '<button class="db active" onclick="fd(\'all\',this)">전체</button>' +
        dates.map(d => '<button class="db" onclick="fd(\'' + d + '\',this)">' + d.replace(/-/g, '.') + '</button>').join('');

    // 카테고리 필터 버튼
    const catButtons = '<button class="cb active" onclick="fc(\'all\',this)">전체</button>' +
        cats.map(c => '<button class="cb" onclick="fc(\'' + esc(c) + '\',this)">' + getCatName(c) + '</button>').join('');

    return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SO,NOW Hub | 대한민국 뉴스 & AI 미디어</title>
<meta name="description" content="대한민국 뉴스 & AI 미디어 허브. 매일 자동 업데이트. 국내뉴스·AI뉴스·YouTube.">
<meta property="og:title" content="SO,NOW Hub">
<meta property="og:url" content="${BASE_URL}/">
<meta property="og:locale" content="ko_KR">
<meta property="og:site_name" content="SO,NOW">
<link rel="canonical" href="${BASE_URL}/">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Noto+Sans+KR:wght@300;400;500;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#0a0a0f;--sf:#111118;--sf2:#1a1a24;--bd:#2a2a3a;--ac:#e8ff00;--ac2:#ff4060;--tx:#e8e8f0;--mu:#6b6b80;--ch:#1e1e2c}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{background:var(--bg);color:var(--tx);font-family:'Noto Sans KR',sans-serif;font-size:14px;line-height:1.7;min-height:100vh;overflow-x:hidden}
body::before{content:'';position:fixed;inset:0;background-image:linear-gradient(rgba(232,255,0,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(232,255,0,.025) 1px,transparent 1px);background-size:60px 60px;pointer-events:none;z-index:0}
.w{max-width:960px;margin:0 auto;padding:0 24px;position:relative;z-index:1}
header{border-bottom:1px solid var(--bd);padding:0 24px;position:sticky;top:0;z-index:100;background:rgba(10,10,15,.88);backdrop-filter:blur(14px)}
.hi{max-width:960px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;height:56px}
.logo{font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:3px;color:var(--ac);text-decoration:none}
.logo span{color:var(--tx)}
nav{display:flex;gap:24px}
nav a{color:var(--mu);text-decoration:none;font-size:12px;font-weight:500;letter-spacing:1px;text-transform:uppercase;transition:color .2s}
nav a:hover{color:var(--ac)}
.hero{padding:72px 0 56px}
.htag{display:inline-flex;align-items:center;gap:8px;background:rgba(232,255,0,.08);border:1px solid rgba(232,255,0,.2);color:var(--ac);font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;padding:5px 14px;border-radius:2px;margin-bottom:24px}
.htag::before{content:'';width:6px;height:6px;background:var(--ac);border-radius:50%;animation:blink 1.2s ease infinite}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
.hero h1{font-family:'Bebas Neue',sans-serif;font-size:clamp(52px,9vw,96px);line-height:.92;letter-spacing:-1px;color:#fff;margin-bottom:20px}
.hero h1 em{font-style:normal;color:var(--ac);display:block}
.hdesc{color:var(--mu);font-size:15px;max-width:480px;margin-bottom:32px;font-weight:300}
.brow{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:32px}
.badge{display:inline-flex;align-items:center;gap:6px;background:var(--sf2);border:1px solid var(--bd);color:var(--mu);font-size:11px;padding:4px 12px;border-radius:2px;text-decoration:none;transition:border-color .2s,color .2s}
.badge:hover{border-color:var(--ac);color:var(--ac)}
.badge strong{color:var(--tx)}
.hstats{display:flex;gap:40px;flex-wrap:wrap}
.stat{display:flex;flex-direction:column}
.snum{font-family:'Bebas Neue',sans-serif;font-size:36px;color:#fff;letter-spacing:1px;line-height:1}
.slbl{font-size:11px;color:var(--mu);letter-spacing:1px;text-transform:uppercase;margin-top:4px}
.sec{padding:52px 0;border-top:1px solid var(--bd)}
.sh{display:flex;align-items:baseline;gap:16px;margin-bottom:28px}
.st{font-family:'Bebas Neue',sans-serif;font-size:32px;letter-spacing:2px;color:#fff}
.ss{font-size:11px;color:var(--mu);letter-spacing:1px;text-transform:uppercase}
.dfilt{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
.db{background:var(--sf2);border:1px solid var(--bd);color:var(--mu);font-size:11px;padding:5px 14px;border-radius:2px;cursor:pointer;font-family:inherit;transition:all .2s;letter-spacing:.5px}
.db:hover,.db.active{background:var(--ac);border-color:var(--ac);color:#000;font-weight:700}
.cfilt{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px}
.cb{background:transparent;border:1px solid var(--bd);color:var(--mu);font-size:11px;padding:4px 12px;border-radius:2px;cursor:pointer;font-family:inherit;transition:all .2s;letter-spacing:.5px;text-transform:uppercase}
.cb:hover,.cb.active{border-color:var(--ac);color:var(--ac)}
#cnt{font-size:11px;color:var(--mu);margin-bottom:12px}
table{width:100%;border-collapse:collapse}
thead th{font-size:10px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:var(--mu);padding:0 0 12px;border-bottom:1px solid var(--bd);text-align:left}
thead th:last-child{text-align:right}
tbody tr{border-bottom:1px solid rgba(255,255,255,.04);transition:background .15s}
tbody tr:hover{background:var(--ch)}
td{padding:13px 8px 13px 0;vertical-align:middle}
td:last-child{text-align:right;white-space:nowrap}
.ni{font-family:'Bebas Neue',sans-serif;font-size:18px;color:var(--bd);width:36px;padding-right:16px!important}
.nc{display:inline-block;font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:2px 8px;border-radius:2px;background:rgba(232,255,0,.1);color:var(--ac);white-space:nowrap;margin-right:10px}
.nt{color:var(--tx);text-decoration:none;font-size:14px;transition:color .2s}
.nt:hover{color:var(--ac)}
.nd{font-size:11px;color:var(--mu)}
.cgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1px;background:var(--bd);border:1px solid var(--bd)}
.cc{background:var(--sf);padding:28px 24px;text-decoration:none;display:block;transition:background .2s;position:relative;overflow:hidden}
.cc::after{content:'';position:absolute;bottom:0;left:0;width:0;height:2px;background:var(--ac);transition:width .3s ease}
.cc:hover{background:var(--ch)}.cc:hover::after{width:100%}
.ci{font-size:28px;margin-bottom:14px;display:block}
.cn{font-family:'Bebas Neue',sans-serif;font-size:20px;letter-spacing:2px;color:#fff;margin-bottom:6px}
.cd{font-size:12px;color:var(--mu);line-height:1.6}
.ytg{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
.yc{background:var(--sf);border:1px solid var(--bd);padding:20px;text-decoration:none;display:flex;flex-direction:column;gap:10px;transition:border-color .2s,background .2s;border-radius:4px}
.yc:hover{border-color:var(--ac2);background:var(--ch)}
.yi{width:36px;height:36px;background:var(--ac2);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px}
.yn{font-weight:700;font-size:13px;color:#fff}
.yd{font-size:11px;color:var(--mu);line-height:1.5}
.yl{font-size:11px;color:var(--ac2);font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-top:auto}
footer{border-top:1px solid var(--bd);padding:36px 24px}
.fi{max-width:960px;margin:0 auto;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:16px}
.fl{font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:3px;color:var(--mu)}
.fls{display:flex;gap:20px;flex-wrap:wrap}
.fls a{color:var(--mu);text-decoration:none;font-size:12px;transition:color .2s}
.fls a:hover{color:var(--ac)}
.fc{font-size:11px;color:#3a3a4a;width:100%;text-align:center;margin-top:16px}
@media(max-width:600px){nav{display:none}.hero h1{font-size:52px}.hstats{gap:24px}.cgrid{grid-template-columns:1fr 1fr}.ytg{grid-template-columns:1fr 1fr}.fi{justify-content:center;text-align:center}}
</style>
</head>
<body>
<header>
  <div class="hi">
    <a href="${BASE_URL}/" class="logo">SO<span>,</span>NOW</a>
    <nav>
      <a href="https://society-now.com/sonow/">사이트</a>
      <a href="#news">뉴스</a>
      <a href="#categories">카테고리</a>
      <a href="#youtube">유튜브</a>
    </nav>
  </div>
</header>
<div class="w">
  <section class="hero">
    <div class="htag">매일 자동 업데이트</div>
    <h1>대한민국<em>뉴스 & AI</em>미디어 허브</h1>
    <p class="hdesc">국내 뉴스 · 글로벌 AI 뉴스 · YouTube 숏츠를 한 곳에서. 매일 자동 수집·발행됩니다.</p>
    <div class="brow">
      <a href="https://github.com/societynowcom/sonow-hub/actions" class="badge">⚡ <strong>Daily Auto Update</strong></a>
      <span class="badge">📰 <strong>${totalCnt.toLocaleString()}</strong>개 기사</span>
      <a href="#youtube" class="badge">📺 <strong>4</strong> YouTube 채널</a>
    </div>
    <div class="hstats">
      <div class="stat"><span class="snum">${totalCnt.toLocaleString()}</span><span class="slbl">최신 기사</span></div>
      <div class="stat"><span class="snum">5</span><span class="slbl">카테고리</span></div>
      <div class="stat"><span class="snum" id="vis-cnt">${totalCnt}</span><span class="slbl">표시 중</span></div>
      <div class="stat"><span class="snum">${lastDate}</span><span class="slbl">마지막 업데이트</span></div>
    </div>
  </section>

  <section class="sec" id="news">
    <div class="sh">
      <h2 class="st">최신 뉴스</h2>
      <span class="ss" id="cnt">${totalCnt}개</span>
    </div>
    <div class="dfilt">${dateButtons}</div>
    <div class="cfilt">${catButtons}</div>
    <table>
      <thead><tr><th style="width:36px">#</th><th>제목</th><th style="text-align:right">날짜</th></tr></thead>
      <tbody id="tbody">
${rows}
      </tbody>
    </table>
  </section>

  <section class="sec" id="categories">
    <div class="sh"><h2 class="st">카테고리</h2><span class="ss">Categories</span></div>
    <div class="cgrid">
      <a href="./headlines/" class="cc"><span class="ci">📰</span><div class="cn">Headlines</div><div class="cd">정책브리핑 · 정치NOW · 지역NOW · 인물탐구 · 진실프로파일링</div></a>
      <a href="./tech-ai/" class="cc"><span class="ci">🤖</span><div class="cn">Tech &amp; AI</div><div class="cd">AI NOW · 디지털트윈 · SONOW TECH · AX.DX · 공공데이터</div></a>
      <a href="./economy/" class="cc"><span class="ci">💰</span><div class="cn">Economy</div><div class="cd">주식 · 코인 · 부동산 · Data&amp;Insight · 보험NOW</div></a>
      <a href="./education/" class="cc"><span class="ci">📚</span><div class="cn">Education</div><div class="cd">ESG · AI생산성 · 생각의힘 · 마음건강 · 세미나</div></a>
      <a href="./k-culture/" class="cc"><span class="ci">🎭</span><div class="cn">K-Culture</div><div class="cd">Hidden Korea · K-콘텐츠 · K-POP · K-BEAUTY · K-HEALTH</div></a>
      <a href="https://society-now.com/sonow/" class="cc"><span class="ci">🌐</span><div class="cn">전체 보기</div><div class="cd">society-now.com에서 모든 기사를 확인하세요.</div></a>
    </div>
  </section>

  <section class="sec" id="youtube">
    <div class="sh"><h2 class="st">YouTube 채널</h2><span class="ss">Channels</span></div>
    <div class="ytg">
      <a href="https://www.youtube.com/@sooonow" class="yc"><div class="yi">📺</div><div class="yn">SO,NOW</div><div class="yd">뉴스 &amp; 미디어 메인 채널</div><span class="yl">바로가기 →</span></a>
      <a href="https://www.youtube.com/@boonow" class="yc"><div class="yi">🎬</div><div class="yn">boonow</div><div class="yd">숏츠 &amp; 콘텐츠</div><span class="yl">바로가기 →</span></a>
      <a href="https://www.youtube.com/@sonow-ai" class="yc"><div class="yi">🤖</div><div class="yn">AI NOW</div><div class="yd">AI 기술 · 프롬프트 뉴스</div><span class="yl">바로가기 →</span></a>
      <a href="https://www.youtube.com/@JustKoreaShorts" class="yc"><div class="yi">🇰🇷</div><div class="yn">just 코리아</div><div class="yd">매일 정치 · 경제 이슈</div><span class="yl">바로가기 →</span></a>
    </div>
  </section>
</div>
<footer>
  <div class="fi">
    <div class="fl">SO,NOW</div>
    <div class="fls">
      <a href="https://society-now.com/sonow/">공식 사이트</a>
      <a href="${BASE_URL}/">허브</a>
      <a href="https://www.youtube.com/@sooonow">YouTube</a>
      <a href="https://github.com/societynowcom/sonow-hub">GitHub</a>
    </div>
    <div class="fc">© 2026 SO,NOW · 매일 자동 업데이트 · society-now.com</div>
  </div>
</footer>
<script>
// 날짜·카테고리 필터 (DOM에 이미 있는 행을 show/hide — JS 없이도 구글이 전체 링크 읽음)
let ad='all', ac='all';
const rows=document.querySelectorAll('#tbody tr');
function upd(){
  let v=0;
  rows.forEach(r=>{
    const ok=(ad==='all'||r.dataset.date===ad)&&(ac==='all'||r.dataset.cat===ac);
    r.style.display=ok?'':'none';
    if(ok)v++;
  });
  document.getElementById('cnt').textContent=v+'개';
  document.getElementById('vis-cnt').textContent=v;
}
function fd(d,b){ad=d;document.querySelectorAll('.db').forEach(x=>x.classList.remove('active'));b.classList.add('active');upd();}
function fc(c,b){ac=c;document.querySelectorAll('.cb').forEach(x=>x.classList.remove('active'));b.classList.add('active');upd();}
</script>
</body>
</html>`;
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

    // 루트 index.html — data/articles.json 읽어 정적 HTML 생성
    // (기사 링크가 HTML 소스에 직접 삽입 → 구글이 JS 없이 크롤링)
    const articlesJsonPath = path.join(HUB_ROOT, 'data', 'articles.json');
    if (fs.existsSync(articlesJsonPath)) {
        const articles = JSON.parse(fs.readFileSync(articlesJsonPath, 'utf-8'));
        fs.writeFileSync(path.join(HUB_ROOT, 'index.html'), buildHubIndexHtml(articles), 'utf-8');
        console.log('      → index.html (루트) 생성 — ' + articles.length + '개 기사 포함');
    } else {
        console.log('      ⚠ data/articles.json 없음 — 루트 index.html 스킵');
    }

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
            // 단, canonical이 github.io를 가리키면 반드시 재생성 (잘못된 canonical 방지)
            if (!FORCE && fs.existsSync(htmlPath)) {
                if (fs.statSync(htmlPath).mtimeMs >= fs.statSync(mdPath).mtimeMs) {
                    const existingHtml = fs.readFileSync(htmlPath, 'utf-8');
                    if (!existingHtml.includes('canonical" href="https://societynowcom.github.io')) {
                        htmlSkipped++;
                        continue;
                    }
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

main().then(() => {
    process.exit(0);
}).catch(err => {
    console.error('오류:', err.message);
    process.exit(1);
});
