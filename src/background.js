// background.js - Service Worker xử lý Context Menu, Cache và Gemini API (Manifest V3)

// ==========================================
// 1. CACHE SERVICE (chrome.storage.local)
// ==========================================
const CacheService = {
  createKey(word, explainLang = 'vi') {
    return `dict_cache_${explainLang}_${word.trim().toLowerCase()}`;
  },

  async get(word, explainLang = 'vi') {
    const key = this.createKey(word, explainLang);
    return new Promise((resolve) => {
      chrome.storage.local.get([key], (result) => {
        if (result && result[key]) {
          console.log(`[CloudDict Cache] Hit cho từ "${word}":`, result[key]);
          resolve(result[key]);
        } else {
          resolve(null);
        }
      });
    });
  },

  async set(word, explainLang = 'vi', data) {
    const key = this.createKey(word, explainLang);
    return new Promise((resolve) => {
      chrome.storage.local.set(
        {
          [key]: {
            ...data,
            cachedAt: Date.now()
          }
        },
        () => {
          console.log(`[CloudDict Cache] Đã lưu cache cho từ "${word}"`);
          resolve();
        }
      );
    });
  }
};

// ==========================================
// 2. GEMINI LLM SERVICE
// ==========================================
const GeminiService = {
  async getConfig() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(
        {
          geminiApiKey: '',
          geminiModel: 'gemini-2.5-flash',
          geminiCustomModel: '',
          explainLang: 'vi'
        },
        (config) => {
          const model = config.geminiModel === 'custom' 
            ? (config.geminiCustomModel || 'gemini-2.5-flash') 
            : (config.geminiModel || 'gemini-2.5-flash');
          resolve({
            apiKey: config.geminiApiKey,
            model: model,
            explainLang: config.explainLang || 'vi'
          });
        }
      );
    });
  },

  isSentenceText(text) {
    if (!text) return false;
    const trimmed = text.trim();
    // 1. Chứa dấu câu kết thúc hoặc xuống dòng
    if (/[.!?。！？\n]/.test(trimmed)) return true;

    // 2. Tiếng Anh / Latin: từ 4 từ trở lên
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length >= 4) return true;

    // 3. Tiếng Nhật: chứa Kanji/Kana và độ dài từ 8 ký tự trở lên
    const hasJapanese = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(trimmed);
    if (hasJapanese && trimmed.length >= 8) return true;

    return false;
  },

  buildSentencePrompt(sentence, explainLang) {
    const langLabel = explainLang === 'en' ? 'English' : 'Vietnamese';
    return `You are an expert translator specializing in English and Japanese.
The user selected a FULL SENTENCE or CLAUSE to translate:
"${sentence}"

Target Translation Language: ${langLabel}

Instructions:
1. Detect whether the sentence is Japanese (ja) or English (en).
2. For "reading":
   - If Japanese: Provide the full, natural Romaji reading of the entire sentence (e.g. "Otouto no tokoro ni otoko no ko ga umareta.").
   - If English: Provide natural phonetic transcription or standard sentence pronunciation.
3. For "meaning":
   - Provide an accurate, natural, fluent translation of the entire sentence in ${langLabel}.
4. CRITICAL: Do NOT provide part_of_speech. Do NOT provide extra examples.

Return strictly a valid JSON object:
{
  "mode": "sentence",
  "detected_lang": "ja",
  "word": "${sentence.replace(/"/g, '\\"')}",
  "reading": "Full romaji or phonetic reading of the entire sentence",
  "meaning": "Natural translation in ${langLabel}"
}`;
  },

  buildWordPrompt(word, contextSentence, explainLang) {
    const langLabel = explainLang === 'en' ? 'English' : 'Vietnamese';
    return `You are an expert bilingual lexicographer and translator specializing in English and Japanese.
Target Word/Short Phrase: "${word}"
Context Sentence: "${contextSentence || 'N/A'}"
Target Explanation Language: ${langLabel}

Instructions:
1. Detect language (ja or en).
2. If this text is actually a full sentence or clause, return "mode": "sentence", "reading", "meaning", without part_of_speech and example.
3. If this is a single word or short phrase, return "mode": "word", "part_of_speech", "reading", "meaning", and "example".

Return strictly a valid JSON object:
{
  "mode": "word",
  "detected_lang": "ja",
  "word": "Base form of word",
  "part_of_speech": "Danh từ, Động từ...",
  "reading": "Reading with kana/romaji or IPA",
  "meaning": "Clear meaning in ${langLabel}",
  "example": {
    "original": "Natural everyday example sentence",
    "vietnamese": "Vietnamese translation of example sentence"
  }
}`;
  },

  buildPrompt(word, contextSentence, explainLang) {
    if (this.isSentenceText(word)) {
      console.log(`[CloudDict] Nhận diện chế độ Dịch Câu (Sentence Mode) cho: "${word.slice(0, 30)}..."`);
      return this.buildSentencePrompt(word, explainLang);
    }
    console.log(`[CloudDict] Nhận diện chế độ Tra Từ (Word Mode) cho: "${word}"`);
    return this.buildWordPrompt(word, contextSentence, explainLang);
  },

  cleanJsonResponse(rawText) {
    let text = rawText.trim();
    if (text.startsWith('```json')) {
      text = text.replace(/^```json\s*/i, '').replace(/\s*```$/, '');
    } else if (text.startsWith('```')) {
      text = text.replace(/^```\s*/, '').replace(/\s*```$/, '');
    }
    return text.trim();
  },

  async callGeminiAPI(modelName, apiKey, prompt, timeoutMs = 4500) {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${apiKey}`;
    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2
      }
    };

    console.log(`[CloudDict] Đang gọi Gemini (${modelName}) với giới hạn timeout ${timeoutMs}ms...`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal
      });

      clearTimeout(timer);

      const data = await response.json();

      if (!response.ok) {
        const msg = data.error?.message || `Mã lỗi HTTP: ${response.status}`;
        const err = new Error(msg);
        err.status = response.status;
        throw err;
      }

      const candidate = data.candidates?.[0];
      if (!candidate || !candidate.content?.parts?.[0]?.text) {
        throw new Error('Không nhận được nội dung phản hồi từ mô hình Gemini.');
      }

      const rawOutput = candidate.content.parts[0].text;
      const cleanedOutput = this.cleanJsonResponse(rawOutput);
      return JSON.parse(cleanedOutput);
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new Error(`Quá thời gian chờ (${timeoutMs / 1000}s) do máy chủ Google phản hồi chậm.`);
      }
      throw err;
    }
  },

  normalizeModelId(rawName) {
    if (!rawName) return 'gemini-3.8-flash';
    return rawName.trim().toLowerCase().replace(/\s+/g, '-');
  },

  async lookup(word, contextSentence = '') {
    const { apiKey, model, explainLang } = await this.getConfig();

    if (!apiKey) {
      throw new Error('Chưa cấu hình Gemini API Key. Vui lòng chuột phải vào icon extension -> chọn "Options" để cài đặt.');
    }

    // 1. Kiểm tra Cache trước
    const cached = await CacheService.get(word, explainLang);
    if (cached) {
      return {
        ...cached,
        fromCache: true
      };
    }

    // 2. Chuẩn bị gọi Gemini API
    const prompt = this.buildPrompt(word, contextSentence, explainLang);

    // Danh sách model ưu tiên (Model chính -> các model dự phòng nhẹ & ít tải bạn cung cấp)
    const fallbackList = [
      'gemini-3.5-flash-lite',
      'gemini-3.1-flash-lite',
      'gemini-3-flash-preview'
    ];

    const primaryModel = this.normalizeModelId(model);
    const modelsToTry = [primaryModel];

    for (const fb of fallbackList) {
      const norm = this.normalizeModelId(fb);
      if (!modelsToTry.includes(norm)) {
        modelsToTry.push(norm);
      }
    }

    let lastError = null;
    let parsedResult = null;
    let successfulModel = null;

    for (const currentModel of modelsToTry) {
      try {
        console.log(`[CloudDict] Đang thử model: ${currentModel}`);
        parsedResult = await this.callGeminiAPI(currentModel, apiKey, prompt);
        if (parsedResult) {
          successfulModel = currentModel;
          break; // Thành công!
        }
      } catch (err) {
        lastError = err;
        console.warn(`[CloudDict] Model "${currentModel}" không khả dụng hoặc bị quá tải: ${err.message}`);
        
        // Nếu lỗi do sai API key hoàn toàn thì không cần thử tiếp
        if (err.message.includes('API_KEY_INVALID') || err.status === 400) {
          throw new Error(`API Key không hợp lệ: ${err.message}`);
        }
      }
    }

    if (!parsedResult) {
      throw new Error(lastError?.message || 'Tất cả các model đều đang bận, vui lòng thử lại sau giây lát.');
    }

    console.log(`[CloudDict] Đã tra từ thành công qua model: ${successfulModel}`);

    // 3. Lưu vào Cache
    await CacheService.set(word, explainLang, parsedResult);

    return {
      ...parsedResult,
      fromCache: false
    };
  }
};

// ==========================================
// 3. CONTEXT MENU & ROUTER
// ==========================================

// Đăng ký context menu khi extension được cài đặt hoặc cập nhật
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'lookup-cloud-dict',
      title: 'Tra đám mây: "%s"',
      contexts: ['selection']
    });
    console.log('[CloudDict] Context menu đã được tạo thành công.');
  });
});

// Xử lý sự kiện click chuột phải
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'lookup-cloud-dict' || !tab?.id) return;

  const rawSelection = (info.selectionText || '').trim();
  if (!rawSelection) return;

  console.log('[CloudDict] Bắt đầu tra từ:', rawSelection);

  let contextSentence = '';

  try {
    // 1. Gửi lệnh INIT_LOOKUP tới content script để:
    //    - Bật bong bóng Loading ngay lập tức quanh từ vừa bôi đen
    //    - Trích xuất câu ngữ cảnh (context sentence)
    const initResponse = await chrome.tabs.sendMessage(tab.id, {
      type: 'CMD_INIT_LOOKUP',
      payload: { selectionText: rawSelection }
    });

    if (initResponse && initResponse.contextSentence) {
      contextSentence = initResponse.contextSentence;
    }
  } catch (err) {
    console.warn('[CloudDict] Không nhận được phản hồi từ content script (có thể trang vừa reload hoặc là trang hệ thống):', err);
  }

  try {
    // 2. Gọi Gemini Service (đã tích hợp Cache)
    const result = await GeminiService.lookup(rawSelection, contextSentence);

    // 3. Gửi kết quả thành công về Content Script để render cụm bong bóng
    await chrome.tabs.sendMessage(tab.id, {
      type: 'CMD_RENDER_SUCCESS',
      payload: {
        queryWord: rawSelection,
        result: result
      }
    });
  } catch (err) {
    console.error('[CloudDict] Lỗi trong quá trình tra từ:', err);
    // 4. Báo lỗi về Content Script để hiển thị bong bóng lỗi
    chrome.tabs.sendMessage(tab.id, {
      type: 'CMD_RENDER_ERROR',
      payload: {
        queryWord: rawSelection,
        errorMsg: err.message || 'Đã xảy ra lỗi không xác định.'
      }
    }).catch(() => {});
  }
});

// Lắng nghe message trực tiếp từ Content Script (nếu sau này mở rộng phím tắt hoặc double-click)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'REQ_OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
    return true;
  }

  if (request.type === 'REQ_LOOKUP_WORD') {
    const { word, contextSentence } = request.payload || {};
    GeminiService.lookup(word, contextSentence)
      .then(result => sendResponse({ success: true, data: result }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true; // async response
  }
});

// Lắng nghe phím tắt từ trình duyệt (Alt + Q)
chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'lookup-selection' && tab?.id) {
    chrome.tabs.sendMessage(tab.id, { type: 'CMD_TRIGGER_SHORTCUT' }).catch(() => {});
  }
});

