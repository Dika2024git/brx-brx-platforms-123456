// File: server.js
// Deskripsi: Server utama untuk AI Chatbot menggunakan Express.js
// Versi ini mengganti franc-min (ESM) dengan language-detect (CJS)

// 1. Impor modul yang diperlukan
const express = require('express');
const fs = require('fs');
const Fuse = require('fuse.js');
// GANTI: 'franc-min' diganti dengan 'language-detect' yang support CJS
const languageDetect = require('language-detect');
const xml2js = require('xml-js');
const fetch = require('node-fetch'); // Gunakan node-fetch@2 untuk kompatibilitas CommonJS
const cors = require('cors');

// 2. Inisialisasi aplikasi Express
const app = express();

// Middleware
app.use(cors()); // Mengizinkan Cross-Origin Resource Sharing

// --- FUNGSI UTAMA CHATBOT ---

/**
 * Memuat dan mem-parsing knowledge base dari data.xml
 * Ini adalah implementasi dari poin #12 (Training Data) dan #17 (Struktur Rapi)
 * @returns {Array} Array of objects yang berisi knowledge base.
 */
function loadKnowledgeBase() {
    try {
        const xmlData = fs.readFileSync('data.xml', 'utf8');
        const jsonData = xml2js.xml2js(xmlData, { compact: true, alwaysArray: true });

        // Poin #17: Mengubah struktur agar mudah digunakan
        const items = jsonData[0].qna[0].item.map(i => {
            const patterns = i.patterns[0].pattern.map(p => p._text[0]);
            const responses = i.responses[0].response.map(r => r._text[0]);
            
            // Poin #4: Threshold berbeda-beda
            const threshold = i.threshold && i.threshold[0]._text[0] ? parseFloat(i.threshold[0]._text[0]) : 0.4; // Default threshold

            // Poin #3, #15, #16: Intent Detection & Gabungan
            const intent = i._attributes.intent;
            
            // Poin #18: Next Context Gabungan
            const nextContext = i.next_context && i.next_context[0]._text ? i.next_context[0]._text[0].split(',') : [];

            // Poin #10: Entity Recognition (konfigurasi)
            const entities = i.entities && i.entities[0].entity ? i.entities[0].entity.map(e => e._attributes.name) : [];
            
            // Poin #11: Knowledge Base dari API
            const apiCall = i._attributes.api_call === 'true';

            return {
                intent,
                patterns,
                responses,
                threshold,
                nextContext,
                entities,
                apiCall
            };
        });
        console.log("Knowledge base berhasil dimuat.");
        return items;
    } catch (error) {
        console.error("Gagal memuat atau parsing data.xml:", error);
        return []; // Kembalikan array kosong jika gagal
    }
}

// Muat knowledge base saat server dimulai
const knowledgeBase = loadKnowledgeBase();

/**
 * Mencari fakta umum dari API eksternal
 * Implementasi poin #5 (Mencari informasi dari API) dan #11 (Knowledge Base dari API)
 * @returns {string} Fakta random.
 */
async function getGeneralFact() {
    try {
        const response = await fetch('https://uselessfacts.jsph.pl/random.json?language=en');
        const data = await response.json();
        return data.text || "Gagal dapet fakta, API-nya lagi ngambek kayaknya.";
    } catch (error) {
        console.error("Error fetching fact:", error);
        return "Gue coba cari fakta, tapi internetnya lagi lemot, bro.";
    }
}

/**
 * Menyimpan log pertanyaan pengguna ke dalam file log.json
 * Implementasi poin #13 (Logging Input Pengguna)
 * @param {string} userInput - Pertanyaan dari pengguna.
 */
function logUserQuery(userInput) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        query: userInput
    };

    fs.readFile('log.json', 'utf8', (err, data) => {
        let logs = [];
        if (!err && data) {
            try {
                logs = JSON.parse(data);
            } catch (parseErr) {
                console.error("Gagal parse log.json, akan membuat file baru.");
            }
        }
        logs.push(logEntry);
        fs.writeFile('log.json', JSON.stringify(logs, null, 2), (writeErr) => {
            if (writeErr) {
                console.error("Gagal menulis ke log.json:", writeErr);
            }
        });
    });
}

// --- ROUTE UTAMA ---
// Poin #2: Pakai metode GET
app.get('/chatbot', async (req, res) => {
    const userInput = req.query.q;

    if (!userInput) {
        return res.status(400).json({
            answer: "Woy, nanya apaan? Kosong gitu pesannya. Santai aja kali, gue kaga gigit."
        });
    }
    
    // Poin #13: Log setiap pertanyaan
    logUserQuery(userInput);

    // Poin #7 & #14: Pemahaman & Deteksi Bahasa Otomatis menggunakan 'language-detect'
    let detectedLang = 'unknown';
    try {
        // language-detect mengembalikan array, contoh: [['Indonesian', 0.6], ['English', 0.2]]
        const detectionResult = languageDetect.detect(userInput, 1);
        if (detectionResult.length > 0) {
            detectedLang = detectionResult[0][0]; // Ambil nama bahasa yang paling mungkin
        }
    } catch (langErr) {
        console.error("Language detection error:", langErr);
    }
    console.log(`Bahasa terdeteksi: ${detectedLang}`);

    let bestMatch = null;
    let highestScore = -1;

    // Poin #1, #4, #9, #19: Proses Q&A dengan Fuse.js dan threshold dinamis
    knowledgeBase.forEach(item => {
        const fuse = new Fuse(item.patterns, {
            includeScore: true,
            threshold: item.threshold, // Menggunakan threshold dari XML
        });

        const results = fuse.search(userInput);

        if (results.length > 0) {
            const score = 1 - results[0].score;
            if (score > highestScore) {
                highestScore = score;
                bestMatch = item;
            }
        }
    });

    // Poin #8: Dibuat menjadi AI chatbot gaul
    if (bestMatch) {
        let responseText = bestMatch.responses[Math.floor(Math.random() * bestMatch.responses.length)];

        if (bestMatch.apiCall) {
            const fact = await getGeneralFact();
            responseText = responseText.replace('{fact}', fact);
        }

        bestMatch.entities.forEach(entity => {
            const regex = new RegExp(`\\b(\\w+)\\b`, 'i');
            const match = userInput.match(regex);
            if (match) {
                 responseText = responseText.replace(`{${entity}}`, match[1]);
            }
        });

        res.json({
            answer: responseText,
            intent: bestMatch.intent,
            score: highestScore,
            detected_language: detectedLang, // Menggunakan hasil dari language-detect
            next_context: bestMatch.nextContext
        });
    } else {
        res.status(404).json({
            answer: "Waduh, otak gue nge-lag nih. Kaga ngerti maksud lo apaan. Coba tanya yang laen, yang lebih gampang gitu.",
            detected_language: detectedLang
        });
    }
});

module.exports = app;