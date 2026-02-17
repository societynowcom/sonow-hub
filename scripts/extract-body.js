#!/usr/bin/env node
/**
 * Track B 본문 추출기
 * article_backup/ HTML 파일에서 본문을 추출하여 list.json 업데이트
 */

const fs = require('fs');
const path = require('path');

const BACKUP_DIR = 'C:/Users/82105/Desktop/sonow_system/article_backup';
const HUB_ROOT = path.join(__dirname, '..');
const DATA_FILE = path.join(HUB_ROOT, 'data', 'articles.json');

// HTML에서 article-body 본문 추출
function extractBody(html) {
    // <article class="article-body"> ... </article> 추출
    const match = html.match(/<article class="article-body">([\s\S]*?)<\/article>/);
    if (!match) return null;

    let body = match[1];

    // HTML 태그 제거하되 h2는 줄바꿈으로, p는 줄바꿈으로
    body = body.replace(/<h2[^>]*>/g, '\n\n## ');
    body = body.replace(/<\/h2>/g, '\n');
    body = body.replace(/<p[^>]*>/g, '\n');
    body = body.replace(/<\/p>/g, '');
    body = body.replace(/<br\s*\/?>/g, '\n');

    // 나머지 HTML 태그 제거
    body = body.replace(/<[^>]+>/g, '');

    // HTML 엔티티 디코딩
    body = body.replace(/&amp;/g, '&')
               .replace(/&lt;/g, '<')
               .replace(/&gt;/g, '>')
               .replace(/&quot;/g, '"')
               .replace(/&#039;/g, "'")
               .replace(/&nbsp;/g, ' ');

    // 연속 줄바꿈 정리
    body = body.replace(/\n{3,}/g, '\n\n').trim();

    // "더 많은 정보는", "Tags" 이후 내용 제거
    const cutIdx = body.indexOf('더 많은 정보는');
    if (cutIdx > 0) body = body.slice(0, cutIdx).trim();

    return body || null;
}

// 50% 요약 (문장 단위)
function summarize50(text) {
    if (!text) return '';
    const targetLen = Math.round(text.length * 0.50);
    if (text.length <= targetLen) return text;

    const sentences = text.match(/[^.!?다]+[.!?다]+/g) || [text];
    let result = '';
    for (const sent of sentences) {
        if (result.length + sent.length > targetLen && result.length > 0) break;
        result += sent;
    }
    return result.trim() || sentences[0];
}

async function main() {
    console.log('═══════════════════════════════════════');
    console.log('  Track B 본문 추출기');
    console.log('═══════════════════════════════════════\n');

    // 1. articles.json 로드
    console.log('1. articles.json 로드...');
    const apiData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    const articles = apiData.articles || (Array.isArray(apiData) ? apiData : []);
    console.log(`   전체: ${articles.length}개\n`);

    // 2. Track B 식별
    const trackB = articles.filter(a => {
        const sec = a.article_sections || [];
        return sec.length === 0;
    });
    console.log(`2. Track B (섹션 없음): ${trackB.length}개\n`);

    // 3. 로컬 HTML 스캔
    console.log('3. article_backup 스캔 중...');
    const cats = fs.readdirSync(BACKUP_DIR).filter(d => {
        const p = path.join(BACKUP_DIR, d);
        return fs.statSync(p).isDirectory() && d.length === 2;
    });

    // article_id → HTML 파일 경로 매핑
    const htmlMap = new Map();
    for (const cat of cats) {
        const catDir = path.join(BACKUP_DIR, cat);
        const folders = fs.readdirSync(catDir).filter(d => {
            return fs.statSync(path.join(catDir, d)).isDirectory();
        });
        for (const folder of folders) {
            const folderPath = path.join(catDir, folder);
            const files = fs.readdirSync(folderPath).filter(f =>
                f.endsWith('.html') && !f.startsWith('._') && !f.startsWith('debug')
            );
            if (files.length > 0) {
                htmlMap.set(folder, path.join(folderPath, files[0]));
            }
        }
    }
    console.log(`   HTML 폴더: ${htmlMap.size}개\n`);

    // 4. 매칭 및 본문 추출
    console.log('4. 본문 추출 중...');
    let extracted = 0, noHtml = 0, noBody = 0, alreadyHas = 0;
    const trackBIds = new Set(trackB.map(a => a.article_id));

    // articles 배열을 직접 수정
    for (const article of articles) {
        if (!trackBIds.has(article.article_id)) continue;

        const htmlPath = htmlMap.get(article.article_id);
        if (!htmlPath) {
            noHtml++;
            continue;
        }

        try {
            const html = fs.readFileSync(htmlPath, 'utf-8');
            const body = extractBody(html);
            if (!body || body.length < 30) {
                noBody++;
                continue;
            }

            // description 업데이트 (50% 요약)
            article.description = summarize50(body);
            extracted++;
        } catch (e) {
            noBody++;
        }
    }

    console.log(`   추출 성공: ${extracted}개`);
    console.log(`   HTML 없음: ${noHtml}개`);
    console.log(`   본문 추출 실패: ${noBody}개\n`);

    // 5. articles.json 저장
    console.log('5. articles.json 저장...');
    fs.writeFileSync(DATA_FILE, JSON.stringify(apiData, null, 2), 'utf-8');
    console.log('   완료\n');

    console.log('═══════════════════════════════════════');
    console.log(`  완료! ${extracted}개 기사 본문 추출`);
    console.log('═══════════════════════════════════════');
}

main().catch(err => {
    console.error('오류:', err.message);
    process.exit(1);
});
