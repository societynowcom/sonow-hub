#!/usr/bin/env node

/**
 * git_engine/generate-md.js
 * VPS DB API → 카테고리별 MD 파일 생성
 *
 * Usage:
 *   node generate-md.js                → 한국어 (기본)
 *   node generate-md.js --lang=en      → 영어
 *   node generate-md.js --lang=ja      → 일본어
 *   node generate-md.js --lang=zh      → 중국어
 *   node generate-md.js --all          → 4개 언어 전부
 *   node generate-md.js --force        → 기존 파일도 재생성
 *
 * GitHub Actions에서 실행됨 (sonow-hub repo)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const API_BASE = 'https://www.society-now.com/api/hub-articles.php';
const HUB_ROOT = path.join(__dirname, '..');

// ─── 언어별 설정 ───
const LANG_CONFIG = {
    ko: { subdir: '',   site: 'https://www.society-now.com', label: 'SO,NOW' },
    en: { subdir: 'en', site: 'https://justnow.kr',          label: 'JustNow' },
    ja: { subdir: 'ja', site: 'https://justnow.kr',          label: 'JustNow' },
    zh: { subdir: 'zh', site: 'https://justnow.kr',          label: 'JustNow' },
};

// 카테고리 매핑
const CATEGORY_MAP = {
    'hl': { folder: 'headlines', name: 'HEADLINES', group: 'headlines' },
    'pb': { folder: 'headlines', name: '정책브리핑', group: 'headlines' },
    'wr': { folder: 'headlines', name: '정치NOW', group: 'headlines' },
    'lr': { folder: 'headlines', name: '지역NOW', group: 'headlines' },
    'pi': { folder: 'headlines', name: '인물탐구', group: 'headlines' },
    'td': { folder: 'headlines', name: '진실프로파일링', group: 'headlines' },
    'ta': { folder: 'tech-ai', name: 'TECH & AI', group: 'tech-ai' },
    'an': { folder: 'tech-ai', name: 'AI NOW', group: 'tech-ai' },
    'dt': { folder: 'tech-ai', name: '디지털트윈', group: 'tech-ai' },
    'sn': { folder: 'tech-ai', name: 'SONOW TECH', group: 'tech-ai' },
    'ax': { folder: 'tech-ai', name: 'AX.DX', group: 'tech-ai' },
    'it': { folder: 'tech-ai', name: '공공데이터', group: 'tech-ai' },
    'kn': { folder: 'economy', name: '경제', group: 'economy' },
    'st': { folder: 'economy', name: '주식', group: 'economy' },
    'co': { folder: 'economy', name: '코인', group: 'economy' },
    're': { folder: 'economy', name: '부동산', group: 'economy' },
    'di': { folder: 'economy', name: 'Data & Insight', group: 'economy' },
    'in': { folder: 'economy', name: '보험NOW', group: 'economy' },
    'ed': { folder: 'education', name: '교육', group: 'education' },
    'eg': { folder: 'education', name: 'ESG', group: 'education' },
    'ap': { folder: 'education', name: 'AI 생산성', group: 'education' },
    'th': { folder: 'education', name: '생각의힘', group: 'education' },
    'mh': { folder: 'education', name: '마음건강', group: 'education' },
    'ex': { folder: 'education', name: '세미나', group: 'education' },
    'kc': { folder: 'k-culture', name: 'K-Culture', group: 'k-culture' },
    'hk': { folder: 'k-culture', name: 'Hidden Korea', group: 'k-culture' },
    'kt': { folder: 'k-culture', name: 'K-콘텐츠', group: 'k-culture' },
    'kp': { folder: 'k-culture', name: 'K-POP', group: 'k-culture' },
    'kb': { folder: 'k-culture', name: 'K-BEAUTY', group: 'k-culture' },
    'kh': { folder: 'k-culture', name: 'K-HEALTH', group: 'k-culture' },
    'nw': { folder: 'headlines', name: 'NEWS', group: 'headlines' },
    'ai': { folder: 'tech-ai', name: 'AI', group: 'tech-ai' },
    'pc': { folder: 'economy', name: '정책금융', group: 'economy' },
    'pe': { folder: 'economy', name: '기업', group: 'economy' },
    'pn': { folder: 'tech-ai', name: 'IT보안', group: 'tech-ai' },
    'ot': { folder: 'headlines', name: '기타', group: 'headlines' },
};

const GROUP_ICONS = {
    'headlines': '📰', 'tech-ai': '🤖', 'economy': '💰',
    'education': '📚', 'k-culture': '🎭'
};

const CROSS_LINKS = {
    'headlines': ['tech-ai', 'economy'],
    'tech-ai': ['economy', 'k-culture'],
    'economy': ['headlines', 'tech-ai'],
    'education': ['tech-ai', 'headlines'],
    'k-culture': ['education', 'economy']
};

// ─── HTTP fetch ───
function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'sonow-hub-generator' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error('JSON 파싱 실패: ' + e.message)); }
            });
        }).on('error', reject);
    });
}

// ─── 날짜 ───
function parseDate(articleId) {
    const dateStr = articleId.replace(/^[a-z]+/i, '').slice(0, 6);
    if (dateStr.length !== 6) return null;
    return `20${dateStr.slice(0,2)}-${dateStr.slice(2,4)}-${dateStr.slice(4,6)}`;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    return dateStr.replace(/-/g, '.');
}

// ─── 파일명 생성 ───
function makeFilename(article) {
    const date = article.date || parseDate(article.article_id) || '';
    let title = (article.title || '').trim();
    title = title.replace(/[^\w가-힣a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').slice(0, 60);
    return `${date}-${title}.md`;
}

// ─── description 정제 ───
function cleanDescription(raw) {
    if (!raw) return '';
    let clean = raw.replace(/^#{1,6}\s*/gm, '').replace(/\*\*/g, '').replace(/\*/g, '').replace(/\n/g, ' ').trim();
    if (clean.length <= 160) return clean;
    const truncated = clean.slice(0, 160);
    const lastPeriod = Math.max(truncated.lastIndexOf('.'), truncated.lastIndexOf('다.'), truncated.lastIndexOf('다 '));
    if (lastPeriod > 80) return truncated.slice(0, lastPeriod + 1).trim();
    return truncated.trim() + '...';
}

// ─── keywords 정제 ───
function cleanKeywords(keywords) {
    if (!Array.isArray(keywords)) return '';
    const EXCLUDE = new Set([...Object.keys(CATEGORY_MAP), '경향신문', '조선일보', '중앙일보', '한겨레', '동아일보', 'SBS', 'KBS', 'MBC', 'JTBC', 'YTN', '연합뉴스', '뉴시스', '뉴스1', '한국경제', '매일경제']);
    return keywords.filter(k => !EXCLUDE.has(k) && k.length > 1).join(', ');
}

// ─── Front-matter ───
function generateFrontMatter(article, catInfo, langConfig) {
    const date = article.date || parseDate(article.article_id) || '';
    const desc = cleanDescription(article.description || '');
    const keywords = cleanKeywords(article.keywords);
    const image = article.image_url || '';

    return `---
title: "${(article.title || '').replace(/"/g, '\\"')}"
description: "${desc.replace(/"/g, '\\"')}"
date: "${date}"
category: "${catInfo.name}"
image: "${image}"
keywords: "${keywords}"
source: "${langConfig.label}"
url: "${article.url || ''}"
lang: "${article.lang || 'ko'}"
---`;
}

// ─── 관련 기사 TOP 3 ───
function getRelatedArticles(article, allArticles, idToFilename) {
    const code = article.article_id.slice(0, 2);
    const sameCategory = allArticles.filter(a =>
        a.article_id.slice(0, 2) === code && a.article_id !== article.article_id
    ).slice(0, 3);
    if (sameCategory.length === 0) return '';

    let md = '\n## Related\n\n';
    for (const rel of sameCategory) {
        const date = formatDate(rel.date || parseDate(rel.article_id));
        const relFile = idToFilename.get(rel.article_id) || makeFilename(rel);
        md += `- [${rel.title}](./${relFile}) (${date})\n`;
    }
    return md;
}

// ─── 교차 링크 ───
function getCrossLinks(article, groupedArticles, catInfo, idToFilename) {
    const crossGroups = CROSS_LINKS[catInfo.group] || [];
    let md = '\n## More\n\n';
    for (const crossGroup of crossGroups) {
        const articles = groupedArticles[crossGroup] || [];
        if (articles.length > 0) {
            const pick = articles[Math.floor(Math.random() * Math.min(5, articles.length))];
            const icon = GROUP_ICONS[crossGroup] || '📄';
            const pickFile = idToFilename.get(pick.article_id) || makeFilename(pick);
            md += `- ${icon} [${pick.title}](../${crossGroup}/articles/${pickFile})\n`;
        }
    }
    return md;
}

// ─── 개별 기사 MD 생성 ───
function generateArticleMD(article, allArticles, groupedArticles, idToFilename, langConfig) {
    const code = article.article_id.slice(0, 2);
    const catInfo = CATEGORY_MAP[code] || CATEGORY_MAP['nw'];
    const date = formatDate(article.date || parseDate(article.article_id));
    const articleUrl = article.url || `${langConfig.site}/`;

    const frontMatter = generateFrontMatter(article, catInfo, langConfig);
    const description = article.description ? `\n${article.description}\n` : '';
    const relatedArticles = getRelatedArticles(article, allArticles, idToFilename);
    const crossLinks = getCrossLinks(article, groupedArticles, catInfo, idToFilename);
    const cleanedKw = cleanKeywords(article.keywords);
    const keywordsLine = cleanedKw ? `\n**Keywords:** ${cleanedKw.replace(/, /g, ' · ')}\n` : '';

    const GROUP_NAMES = {
        'headlines': 'HEADLINES', 'tech-ai': 'TECH & AI', 'economy': 'ECONOMY',
        'education': 'EDUCATION', 'k-culture': 'K-CULTURE'
    };
    const groupDisplayName = GROUP_NAMES[catInfo.group] || catInfo.group;

    return `${frontMatter}

# ${article.title || 'Untitled'}

**${catInfo.name}** | ${date} | ${langConfig.label}
${description}
> **[Read full article on ${langConfig.label}](${articleUrl})**
${keywordsLine}${relatedArticles}${crossLinks}
---

**[Full Article → ${langConfig.label}](${articleUrl})** | *[Home](../../README.md) | [${GROUP_ICONS[catInfo.group] || '📂'} ${groupDisplayName}](../README.md)*
`;
}

// ─── 메인 실행 ───
async function main() {
    const args = process.argv.slice(2);
    const forceMode = args.includes('--force');
    const allMode = args.includes('--all');

    let langs = ['ko'];
    const langArg = args.find(a => a.startsWith('--lang='));
    if (langArg) langs = [langArg.split('=')[1]];
    if (allMode) langs = ['ko', 'en', 'ja', 'zh'];

    console.log('══════════════════════════════════════════════');
    console.log('  SO,NOW GitHub Hub - MD Generator (DB API)');
    console.log(`  Languages: ${langs.join(', ')}${forceMode ? ' | --force' : ''}`);
    console.log('══════════════════════════════════════════════\n');

    for (const lang of langs) {
        const langConfig = LANG_CONFIG[lang];
        if (!langConfig) { console.log(`  Unknown lang: ${lang}, skip.`); continue; }

        const langPrefix = langConfig.subdir ? `${langConfig.subdir}/` : '';

        console.log(`\n─── [${lang.toUpperCase()}] ───────────────────────────────`);

        // 1. API fetch
        const apiUrl = `${API_BASE}?lang=${lang}`;
        console.log(`  1. Fetching: ${apiUrl}`);
        const articles = await fetchJSON(apiUrl);
        console.log(`     → ${articles.length} articles\n`);

        if (articles.length === 0) { console.log('  No articles. Skip.'); continue; }

        // 2. 그룹별 분류
        const groupedArticles = {};
        for (const a of articles) {
            const code = a.article_id.slice(0, 2);
            const cat = CATEGORY_MAP[code] || CATEGORY_MAP['nw'];
            if (!groupedArticles[cat.group]) groupedArticles[cat.group] = [];
            groupedArticles[cat.group].push(a);
        }

        for (const [group, arts] of Object.entries(groupedArticles)) {
            console.log(`     ${group}: ${arts.length}`);
        }

        // 3. 파일명 충돌 처리
        const filenameGroups = new Map();
        for (const a of articles) {
            const code = a.article_id.slice(0, 2);
            const cat = CATEGORY_MAP[code] || CATEGORY_MAP['nw'];
            const baseName = makeFilename(a);
            const key = `${cat.folder}/${baseName}`;
            if (!filenameGroups.has(key)) filenameGroups.set(key, []);
            filenameGroups.get(key).push(a);
        }

        const idToFilename = new Map();
        let collisionCount = 0;

        for (const [key, group] of filenameGroups) {
            const folder = key.split('/')[0];
            const baseName = key.slice(folder.length + 1);

            if (group.length === 1) {
                idToFilename.set(group[0].article_id, baseName);
            } else {
                const filePath = path.join(HUB_ROOT, langPrefix + folder, 'articles', baseName);
                let ownerArticleId = null;

                if (fs.existsSync(filePath)) {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    for (const a of group) {
                        if (content.includes(a.article_id)) { ownerArticleId = a.article_id; break; }
                    }
                }

                for (const a of group) {
                    if (a.article_id === ownerArticleId) {
                        idToFilename.set(a.article_id, baseName);
                    } else if (!ownerArticleId && a === group[0]) {
                        idToFilename.set(a.article_id, baseName);
                    } else {
                        idToFilename.set(a.article_id, baseName.replace('.md', `-${a.article_id}.md`));
                        collisionCount++;
                    }
                }
            }
        }
        console.log(`\n  Collisions resolved: ${collisionCount}`);

        // 4. MD 파일 생성
        let created = 0, skipped = 0;
        for (const a of articles) {
            const code = a.article_id.slice(0, 2);
            const cat = CATEGORY_MAP[code] || CATEGORY_MAP['nw'];
            const articlesDir = path.join(HUB_ROOT, langPrefix + cat.folder, 'articles');

            if (!fs.existsSync(articlesDir)) fs.mkdirSync(articlesDir, { recursive: true });

            const fileName = idToFilename.get(a.article_id) || makeFilename(a);
            const filePath = path.join(articlesDir, fileName);

            if (fs.existsSync(filePath) && !forceMode) { skipped++; continue; }

            fs.writeFileSync(filePath, generateArticleMD(a, articles, groupedArticles, idToFilename, langConfig), 'utf-8');
            created++;
        }
        console.log(`  Created: ${created}, Skipped: ${skipped}`);

        // 5. data/ 에 JSON 저장
        const dataDir = path.join(HUB_ROOT, langPrefix + 'data');
        if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(path.join(dataDir, 'articles.json'), JSON.stringify(articles, null, 2), 'utf-8');
        console.log(`  Saved: ${langPrefix}data/articles.json`);
    }

    console.log('\n══════════════════════════════════════════════');
    console.log('  Done!');
    console.log('══════════════════════════════════════════════');
}

main().then(() => process.exit(0)).catch(err => { console.error('Error:', err.message); process.exit(1); });
