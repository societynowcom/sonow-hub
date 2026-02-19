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

const API_URL = 'https://www.society-now.com/sonow/article/list.json';
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

// ─── description 정제 (마크다운 제거 + 문장 단위 자르기) ───
function cleanDescription(raw) {
    if (!raw) return '';
    // 마크다운 기호 제거
    let clean = raw.replace(/^#{1,6}\s*/gm, '').replace(/\*\*/g, '').replace(/\*/g, '').replace(/\n/g, ' ').trim();
    // 160자 이내, 문장 단위로 자르기
    if (clean.length <= 160) return clean;
    const truncated = clean.slice(0, 160);
    const lastPeriod = Math.max(truncated.lastIndexOf('.'), truncated.lastIndexOf('다.'), truncated.lastIndexOf('다 '));
    if (lastPeriod > 80) return truncated.slice(0, lastPeriod + 1).trim();
    return truncated.trim() + '...';
}

// ─── 본문 50% 요약 생성 (Track A: article_sections 있는 기사) ───
function generateBodySummary(article) {
    const sections = article.article_sections || [];
    if (sections.length === 0) {
        // Track B: description 있으면 전문 사용, 없으면 빈 문자열
        return (article.description || '').trim();
    }

    // Track A: 섹션 본문 합산 후 50%
    const fullBodies = sections.map(s => (s.body || '').trim()).filter(b => b.length > 0);
    const fullText = fullBodies.join(' ');
    const targetLen = Math.round(fullText.length * 0.50);

    // 섹션 단위로 채우기
    let result = '';
    for (const body of fullBodies) {
        if (result.length >= targetLen) break;
        result += (result ? '\n\n' : '') + body;
    }

    // 1개 섹션이 목표를 크게 넘으면 문장 단위로 자르기
    if (result.length > targetLen * 1.3) {
        const sentences = result.match(/[^.!?다]+[.!?다]+/g) || [result];
        let trimmed = '';
        for (const sent of sentences) {
            if (trimmed.length + sent.length > targetLen) break;
            trimmed += sent;
        }
        result = trimmed || sentences[0];
    }

    return result.trim();
}

// ─── keywords 정제 (소스명/카테고리코드 제거) ───
function cleanKeywords(keywords) {
    if (!Array.isArray(keywords)) return '';
    const EXCLUDE = new Set([...Object.keys(CATEGORY_MAP), '경향신문', '조선일보', '중앙일보', '한겨레', '동아일보', 'SBS', 'KBS', 'MBC', 'JTBC', 'YTN', '연합뉴스', '뉴시스', '뉴스1', '한국경제', '매일경제']);
    return keywords.filter(k => !EXCLUDE.has(k) && k.length > 1).join(', ');
}

// ─── [제미나이 3] Front-matter 메타데이터 생성 ───
function generateFrontMatter(article, catInfo) {
    const date = parseDate(article.article_id) || '';
    const desc = cleanDescription(article.description || article.subtitle || '');
    const keywords = cleanKeywords(article.keywords);
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
function getRelatedArticles(article, allArticles, catInfo, idToFilename) {
    const code = article.article_id.slice(0, 2);
    const sameCategory = allArticles.filter(a =>
        a.article_id.slice(0, 2) === code && a.article_id !== article.article_id
    ).slice(0, 3);

    if (sameCategory.length === 0) return '';

    let md = '\n## 📌 관련 기사\n\n';
    for (const rel of sameCategory) {
        const date = formatDate(parseDate(rel.article_id));
        const relFile = (idToFilename && idToFilename.get(rel.article_id)) || makeFilename(rel);
        md += `- [${rel.title}](./${relFile}) (${date})\n`;
    }
    return md;
}

// ─── [제미나이 4] 타 카테고리 교차 링크 ───
function getCrossLinks(article, groupedArticles, catInfo, idToFilename) {
    const crossGroups = CROSS_LINKS[catInfo.group] || [];
    let md = '\n## 🔗 다른 카테고리 최신 뉴스\n\n';

    for (const crossGroup of crossGroups) {
        const articles = groupedArticles[crossGroup] || [];
        if (articles.length > 0) {
            const pick = articles[Math.floor(Math.random() * Math.min(5, articles.length))];
            const icon = GROUP_ICONS[crossGroup] || '📄';
            const crossFolder = crossGroup;
            const pickFile = (idToFilename && idToFilename.get(pick.article_id)) || makeFilename(pick);
            md += `- ${icon} [${pick.title}](../${crossFolder}/articles/${pickFile})\n`;
        }
    }
    return md;
}

// ─── 개별 기사 MD 파일 생성 ───
function generateArticleMD(article, allArticles, groupedArticles, idToFilename) {
    const code = article.article_id.slice(0, 2);
    const catInfo = CATEGORY_MAP[code] || CATEGORY_MAP['nw'];
    const date = formatDate(parseDate(article.article_id));
    const articleUrl = article.url || `https://society-now.com/sonow/article/${code}/${article.article_id}/`;

    const frontMatter = generateFrontMatter(article, catInfo);
    const subtitle = article.subtitle ? `> ${article.subtitle}\n` : '';
    const bodySummary = generateBodySummary(article);
    const description = bodySummary ? `\n${bodySummary}\n` : '';
    const relatedArticles = getRelatedArticles(article, allArticles, catInfo, idToFilename);
    const crossLinks = getCrossLinks(article, groupedArticles, catInfo, idToFilename);
    const cleanedKw = cleanKeywords(article.keywords);
    const keywordsLine = cleanedKw ? `\n**🏷️ 키워드:** ${cleanedKw.replace(/, /g, ' · ')}\n` : '';

    const GROUP_NAMES = {
        'headlines': 'HEADLINES', 'tech-ai': 'TECH & AI', 'economy': 'ECONOMY',
        'education': 'EDUCATION', 'k-culture': 'K-CULTURE'
    };
    const groupDisplayName = GROUP_NAMES[catInfo.group] || catInfo.group;

    // CTA 문구 배열 (기사마다 다른 문구 사용)
    const ctaVariants = [
        '이 기사의 전체 분석과 관련 보도를',
        '더 자세한 내용과 관련 기사를',
        '전문가 분석과 심층 보도를',
        '실시간 업데이트와 전체 기사를',
        '이 이슈의 전체 맥락과 배경을'
    ];
    const ctaIdx = Math.abs(article.article_id.split('').reduce((s, c) => s + c.charCodeAt(0), 0)) % ctaVariants.length;
    const midCTA = `> **${ctaVariants[ctaIdx]} [Society-Now에서 확인하세요](${articleUrl})**`;

    return `${frontMatter}

# ${article.title || '제목 없음'}

${subtitle}
**${catInfo.name}** | ${date} | SO,NOW
${description}
${midCTA}
${keywordsLine}${relatedArticles}${crossLinks}
---

**[전체 기사 읽기 → Society-Now](${articleUrl})** | *[🏠 홈](../../README.md) | [${GROUP_ICONS[catInfo.group] || '📂'} ${groupDisplayName}](../README.md)*
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
function updateCategoryReadmes(groupedArticles, idToFilename) {
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
            const fileName = (idToFilename && idToFilename.get(a.article_id)) || makeFilename(a);
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

    // 3. 파일명 충돌 감지 및 매핑
    console.log('3. 파일명 충돌 감지 중...');

    // 같은 파일명을 만드는 기사끼리 그룹화
    const filenameGroups = new Map(); // "folder/filename" → [article, ...]
    for (const a of articles) {
        const code = a.article_id.slice(0, 2);
        const cat = CATEGORY_MAP[code] || CATEGORY_MAP['nw'];
        const baseName = makeFilename(a);
        const key = `${cat.folder}/${baseName}`;
        if (!filenameGroups.has(key)) filenameGroups.set(key, []);
        filenameGroups.get(key).push(a);
    }

    // 충돌 해결: article_id → 실제 파일명
    const idToFilename = new Map();
    let collisionCount = 0;

    for (const [key, group] of filenameGroups) {
        const folder = key.split('/')[0];
        const baseName = key.slice(folder.length + 1);

        if (group.length === 1) {
            // 충돌 없음
            idToFilename.set(group[0].article_id, baseName);
        } else {
            // 충돌 발생! 기존 파일의 소유자 확인
            const filePath = path.join(HUB_ROOT, folder, 'articles', baseName);
            let ownerArticleId = null;

            if (fs.existsSync(filePath)) {
                const content = fs.readFileSync(filePath, 'utf-8');
                for (const a of group) {
                    if (content.includes(a.article_id)) {
                        ownerArticleId = a.article_id;
                        break;
                    }
                }
            }

            for (const a of group) {
                if (a.article_id === ownerArticleId) {
                    // 기존 파일 소유자 → 기본 파일명 유지
                    idToFilename.set(a.article_id, baseName);
                } else if (!ownerArticleId && a === group[0]) {
                    // 기존 파일 없으면 첫 번째가 기본 파일명
                    idToFilename.set(a.article_id, baseName);
                } else {
                    // 충돌 기사 → article_id 접미사 붙임
                    const altName = baseName.replace('.md', `-${a.article_id}.md`);
                    idToFilename.set(a.article_id, altName);
                    collisionCount++;
                }
            }
        }
    }
    console.log(`   → 충돌 감지: ${collisionCount}개 (article_id 접미사로 해결)\n`);

    // 4. MD 파일 생성
    const forceMode = process.argv.includes('--force');
    console.log(`4. MD 파일 생성 중...${forceMode ? ' (--force: 기존 파일도 재생성)' : ''}`);
    let created = 0, updated = 0, skipped = 0;

    for (const a of articles) {
        const code = a.article_id.slice(0, 2);
        const cat = CATEGORY_MAP[code] || CATEGORY_MAP['nw'];
        const articlesDir = path.join(HUB_ROOT, cat.folder, 'articles');

        if (!fs.existsSync(articlesDir)) {
            fs.mkdirSync(articlesDir, { recursive: true });
        }

        const fileName = idToFilename.get(a.article_id) || makeFilename(a);
        const filePath = path.join(articlesDir, fileName);

        if (fs.existsSync(filePath)) {
            if (forceMode) {
                const md = generateArticleMD(a, articles, groupedArticles, idToFilename);
                fs.writeFileSync(filePath, md, 'utf-8');
                updated++;
            } else {
                skipped++;
            }
            continue;
        }

        const md = generateArticleMD(a, articles, groupedArticles, idToFilename);
        fs.writeFileSync(filePath, md, 'utf-8');
        created++;
    }
    console.log(`   → 신규: ${created}개, 업데이트: ${updated}개, 스킵: ${skipped}개\n`);

    // 5. README 업데이트
    console.log('5. README 파일 업데이트...');
    updateMainReadme(articles);
    updateCategoryReadmes(groupedArticles, idToFilename);
    console.log('   → 완료\n');

    // 6. data/ 에 JSON 저장
    console.log('6. data/articles.json 저장...');
    const dataDir = path.join(HUB_ROOT, 'data');
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(path.join(dataDir, 'articles.json'), JSON.stringify(apiData, null, 2), 'utf-8');
    console.log('   → 완료\n');

    // 7. sitemap.xml 생성
    console.log('7. sitemap.xml 생성...');
    const BASE_URL = 'https://societynowcom.github.io/sonow-hub';
    const today = new Date().toISOString().slice(0, 10);

    let sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    sitemap += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`;

    // 메인 페이지
    sitemap += `  <url>\n    <loc>${BASE_URL}/</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>\n`;

    // 카테고리 페이지
    for (const group of ['headlines', 'tech-ai', 'economy', 'education', 'k-culture']) {
        sitemap += `  <url>\n    <loc>${BASE_URL}/${group}/</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
    }

    // 개별 기사 MD
    let sitemapCount = 0;
    for (const a of articles) {
        const code = a.article_id.slice(0, 2);
        const cat = CATEGORY_MAP[code] || CATEGORY_MAP['nw'];
        const fileName = idToFilename.get(a.article_id) || makeFilename(a);
        const encodedName = encodeURIComponent(fileName).replace(/%2F/g, '/');
        const articleDate = parseDate(a.article_id) || today;

        sitemap += `  <url>\n    <loc>${BASE_URL}/${cat.folder}/articles/${encodedName}</loc>\n    <lastmod>${articleDate}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>\n`;
        sitemapCount++;
    }

    sitemap += `</urlset>\n`;
    fs.writeFileSync(path.join(HUB_ROOT, 'sitemap.xml'), sitemap, 'utf-8');
    console.log(`   → ${sitemapCount + 6}개 URL 등록 완료\n`);

    console.log('══════════════════════════════════════════════');
    console.log(`  완료! 신규 ${created}개 MD 생성`);
    console.log('══════════════════════════════════════════════');
}

main().catch(err => {
    console.error('오류:', err.message);
    process.exit(1);
});
