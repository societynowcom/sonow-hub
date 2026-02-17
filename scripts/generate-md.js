#!/usr/bin/env node

/**
 * JSON → MD 변환 스크립트
 * society-now.com/sonow/api/articles.json → 카테고리별 MD 파일 생성
 *
 * 제미나이 SEO 제안 4가지 반영:
 * 1. 시멘틱 태그 - 관련 기사 TOP 3 링크
 * 2. YouTube Shorts 전용 페이지
 * 3. OG/Front-matter 메타데이터
 * 4. 거미줄 Internal Linking (타 카테고리 교차 링크)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const API_URL = 'https://www.society-now.com/sonow/api/articles.json';
const HUB_ROOT = path.join(__dirname, '..');

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
    'ai': { folder: 'tech-ai', name: 'AI', group: 'tech-ai' }
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

// ─── HTTP 가져오기 ───
function fetchJSON(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'sonow-hub-generator' } }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const parsed = JSON.parse(data);
                    resolve(parsed);
                } catch (e) {
                    reject(new Error('JSON 파싱 실패: ' + e.message));
                }
            });
        }).on('error', reject);
    });
}

// ─── 날짜 파싱 ───
function parseDate(articleId) {
    const dateStr = articleId.slice(2, 8);
    if (dateStr.length !== 6) return null;
    return `20${dateStr.slice(0,2)}-${dateStr.slice(2,4)}-${dateStr.slice(4,6)}`;
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    return dateStr.replace(/-/g, '.');
}

// ─── 파일명 생성 (SEO 최적화) ───
function makeFilename(article) {
    const date = parseDate(article.article_id) || '';
    let title = (article.title || '').trim();
    // 파일명용 정제: 특수문자 제거, 공백→하이픈
    title = title.replace(/[^\w가-힣\s-]/g, '').replace(/\s+/g, '-').slice(0, 60);
    return `${date}-${title}.md`;
}

// ─── [제미나이 3] Front-matter 메타데이터 생성 ───
function generateFrontMatter(article, catInfo) {
    const date = parseDate(article.article_id) || '';
    const desc = (article.description || article.subtitle || '').slice(0, 160);
    const keywords = Array.isArray(article.keywords) ? article.keywords.join(', ') : '';
    const tags = Array.isArray(article.tags) ? article.tags.join(', ') : '';
    const image = article.image_url || '';

    return `---
title: "${(article.title || '').replace(/"/g, '\\"')}"
description: "${desc.replace(/"/g, '\\"')}"
date: "${date}"
category: "${catInfo.name}"
image: "${image}"
keywords: "${keywords}"
tags: "${tags}"
source: "SO,NOW"
url: "${article.url || ''}"
---`;
}

// ─── [제미나이 1] 관련 기사 TOP 3 ───
function getRelatedArticles(article, allArticles, catInfo) {
    const code = article.article_id.slice(0, 2);
    const sameCategory = allArticles.filter(a =>
        a.article_id.slice(0, 2) === code && a.article_id !== article.article_id
    ).slice(0, 3);

    if (sameCategory.length === 0) return '';

    let md = '\n## 📌 관련 기사\n\n';
    for (const rel of sameCategory) {
        const date = formatDate(parseDate(rel.article_id));
        const relFile = makeFilename(rel);
        md += `- [${rel.title}](./${relFile}) (${date})\n`;
    }
    return md;
}

// ─── [제미나이 4] 타 카테고리 교차 링크 ───
function getCrossLinks(article, groupedArticles, catInfo) {
    const crossGroups = CROSS_LINKS[catInfo.group] || [];
    let md = '\n## 🔗 다른 카테고리 최신 뉴스\n\n';

    for (const crossGroup of crossGroups) {
        const articles = groupedArticles[crossGroup] || [];
        if (articles.length > 0) {
            const pick = articles[Math.floor(Math.random() * Math.min(5, articles.length))];
            const icon = GROUP_ICONS[crossGroup] || '📄';
            const crossFolder = crossGroup;
            const pickFile = makeFilename(pick);
            md += `- ${icon} [${pick.title}](../${crossFolder}/articles/${pickFile})\n`;
        }
    }
    return md;
}

// ─── 개별 기사 MD 파일 생성 ───
function generateArticleMD(article, allArticles, groupedArticles) {
    const code = article.article_id.slice(0, 2);
    const catInfo = CATEGORY_MAP[code] || CATEGORY_MAP['nw'];
    const date = formatDate(parseDate(article.article_id));
    const articleUrl = article.url || `https://society-now.com/sonow/article/${code}/${article.article_id}/`;

    const frontMatter = generateFrontMatter(article, catInfo);
    const subtitle = article.subtitle ? `> ${article.subtitle}\n` : '';
    const description = article.description ? `\n${article.description}\n` : '';
    const relatedArticles = getRelatedArticles(article, allArticles, catInfo);
    const crossLinks = getCrossLinks(article, groupedArticles, catInfo);
    const keywordsLine = Array.isArray(article.keywords) && article.keywords.length > 0
        ? `\n**🏷️ 키워드:** ${article.keywords.join(' · ')}\n` : '';

    return `${frontMatter}

# ${article.title || '제목 없음'}

${subtitle}
**${catInfo.name}** | ${date} | SO,NOW
${description}
**📰 [전체 기사 읽기 → society-now.com](${articleUrl})**
${keywordsLine}${relatedArticles}${crossLinks}
---

*[🏠 홈](../../README.md) | [${GROUP_ICONS[catInfo.group] || '📂'} ${catInfo.group}](../README.md) | [SO,NOW](https://society-now.com/sonow/)*
`;
}

// ─── README 자동 업데이트 ───
function updateReadme(filePath, marker, newContent) {
    if (!fs.existsSync(filePath)) return;
    let content = fs.readFileSync(filePath, 'utf-8');
    const startTag = `<!-- AUTO-UPDATE:${marker} -->`;
    const endTag = `<!-- /AUTO-UPDATE:${marker} -->`;
    const startIdx = content.indexOf(startTag);
    const endIdx = content.indexOf(endTag);
    if (startIdx === -1 || endIdx === -1) return;

    content = content.slice(0, startIdx + startTag.length) + '\n' + newContent + '\n' + content.slice(endIdx);
    fs.writeFileSync(filePath, content, 'utf-8');
}

// ─── 메인 README 업데이트 ───
function updateMainReadme(articles) {
    const readmePath = path.join(HUB_ROOT, 'README.md');
    const today = new Date().toISOString().slice(0, 10);

    // 오늘의 헤드라인 (최신 10개)
    const latest = articles.slice(0, 10);
    let headlinesTable = '| 제목 | 카테고리 | 날짜 |\n|------|---------|------|\n';
    for (const a of latest) {
        const code = a.article_id.slice(0, 2);
        const cat = CATEGORY_MAP[code] || CATEGORY_MAP['nw'];
        const date = formatDate(parseDate(a.article_id));
        const url = a.url || `https://society-now.com/sonow/article/${code}/${a.article_id}/`;
        headlinesTable += `| [${(a.title || '').slice(0, 50)}](${url}) | ${cat.name} | ${date} |\n`;
    }
    updateReadme(readmePath, 'TODAY_HEADLINES', headlinesTable);

    // 통계
    const categories = new Set(articles.map(a => a.article_id.slice(0, 2)));
    let stats = '| 항목 | 수치 |\n|------|------|\n';
    stats += `| 전체 기사 | ${articles.length}개 |\n`;
    stats += `| 카테고리 | ${categories.size}개 |\n`;
    stats += `| YouTube 채널 | 3개 |\n`;
    stats += `| 마지막 업데이트 | ${today} |\n`;
    updateReadme(readmePath, 'STATS', stats);
}

// ─── 카테고리 README 업데이트 ───
function updateCategoryReadmes(groupedArticles) {
    const markerMap = {
        'headlines': 'HEADLINES_LATEST',
        'tech-ai': 'TECH_LATEST',
        'economy': 'ECONOMY_LATEST',
        'education': 'EDUCATION_LATEST',
        'k-culture': 'KCULTURE_LATEST'
    };

    for (const [group, marker] of Object.entries(markerMap)) {
        const readmePath = path.join(HUB_ROOT, group, 'README.md');
        const articles = (groupedArticles[group] || []).slice(0, 15);

        let table = '| 제목 | 날짜 |\n|------|------|\n';
        for (const a of articles) {
            const date = formatDate(parseDate(a.article_id));
            const fileName = makeFilename(a);
            table += `| [${(a.title || '').slice(0, 60)}](./articles/${fileName}) | ${date} |\n`;
        }
        updateReadme(readmePath, marker, table);
    }
}

// ─── 메인 실행 ───
async function main() {
    console.log('══════════════════════════════════════════════');
    console.log('  SO,NOW GitHub Hub - MD 생성기');
    console.log('══════════════════════════════════════════════\n');

    // 1. JSON 다운로드
    console.log('1. articles.json 다운로드 중...');
    const apiData = await fetchJSON(API_URL);
    const articles = apiData.articles || (Array.isArray(apiData) ? apiData : []);
    console.log(`   → ${articles.length}개 기사 로드\n`);

    if (articles.length === 0) {
        console.log('기사 없음. 종료.');
        return;
    }

    // 2. 그룹별 분류
    console.log('2. 카테고리별 분류...');
    const groupedArticles = {};
    for (const a of articles) {
        const code = a.article_id.slice(0, 2);
        const cat = CATEGORY_MAP[code] || CATEGORY_MAP['nw'];
        if (!groupedArticles[cat.group]) groupedArticles[cat.group] = [];
        groupedArticles[cat.group].push(a);
    }

    for (const [group, arts] of Object.entries(groupedArticles)) {
        console.log(`   ${group}: ${arts.length}개`);
    }
    console.log('');

    // 3. MD 파일 생성
    console.log('3. MD 파일 생성 중...');
    let created = 0, skipped = 0;

    for (const a of articles) {
        const code = a.article_id.slice(0, 2);
        const cat = CATEGORY_MAP[code] || CATEGORY_MAP['nw'];
        const articlesDir = path.join(HUB_ROOT, cat.folder, 'articles');

        if (!fs.existsSync(articlesDir)) {
            fs.mkdirSync(articlesDir, { recursive: true });
        }

        const fileName = makeFilename(a);
        const filePath = path.join(articlesDir, fileName);

        // 이미 존재하면 스킵
        if (fs.existsSync(filePath)) {
            skipped++;
            continue;
        }

        const md = generateArticleMD(a, articles, groupedArticles);
        fs.writeFileSync(filePath, md, 'utf-8');
        created++;
    }
    console.log(`   → 생성: ${created}개, 스킵(기존): ${skipped}개\n`);

    // 4. README 업데이트
    console.log('4. README 파일 업데이트...');
    updateMainReadme(articles);
    updateCategoryReadmes(groupedArticles);
    console.log('   → 완료\n');

    // 5. data/ 에 JSON 저장
    console.log('5. data/articles.json 저장...');
    const dataDir = path.join(HUB_ROOT, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'articles.json'), JSON.stringify(apiData, null, 2), 'utf-8');
    console.log('   → 완료\n');

    console.log('══════════════════════════════════════════════');
    console.log(`  완료! 신규 ${created}개 MD 생성`);
    console.log('══════════════════════════════════════════════');
}

main().catch(err => {
    console.error('오류:', err.message);
    process.exit(1);
});
