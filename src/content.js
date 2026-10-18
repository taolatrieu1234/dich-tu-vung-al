// content.js - Content script: Fixed Viewport, Notion Optimizer, Alt+Q, Ghim (Pin), Quick Floating Cloud & Copy Romaji

(function () {
  'use strict';

  if (window.__CLOUD_DICT_INJECTED__) return;
  window.__CLOUD_DICT_INJECTED__ = true;

  console.log('[CloudDict] Content script đã tải (Hỗ trợ Pin, Quick Trigger & Romaji Copy).');

  // ==========================================
  // HELPER: LÀM SẠCH TỪ VỰNG (SANITIZE)
  // ==========================================
  function sanitizeWord(raw) {
    if (!raw) return '';
    return raw.trim().replace(/^[\s\(\[\{<"'`«“「『【（〔]+|[\s\)\]\}>"'`»”」』】）〕、,.;:!?。！？]+$/g, '');
  }

  function escapeHTML(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Lưu tọa độ con trỏ chuột dự phòng khi click chuột phải
  let lastMouseCoords = null;
  document.addEventListener('contextmenu', (e) => {
    lastMouseCoords = {
      top: e.clientY,
      bottom: e.clientY + 20,
      left: e.clientX,
      right: e.clientX,
      width: 0,
      height: 20
    };
    SelectionManager.saveCurrentSelection();
  }, true);

  // ==========================================
  // 1. SELECTION & CONTEXT EXTRACTOR MANAGER
  // ==========================================
  const SelectionManager = {
    lastRange: null,
    lastRect: null,
    lastContextSentence: '',
    lastText: '',

    saveCurrentSelection() {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return null;
      }

      const selectedText = selection.toString().trim();
      if (!selectedText) return null;

      try {
        const range = selection.getRangeAt(0);
        this.lastRange = range.cloneRange();
        this.lastRect = this.calculateRect(range);
        this.lastContextSentence = this.extractContextSentence(range, selectedText);
        this.lastText = selectedText;

        return {
          range: this.lastRange,
          rect: this.lastRect,
          contextSentence: this.lastContextSentence,
          text: selectedText
        };
      } catch (e) {
        console.warn('[CloudDict] Lỗi khi lưu selection:', e);
        return null;
      }
    },

    calculateRect(range) {
      if (!range) return null;
      const rect = range.getBoundingClientRect();

      if (rect.width === 0 && rect.height === 0) {
        const rects = range.getClientRects();
        if (rects.length > 0) {
          const first = rects[0];
          return {
            top: first.top,
            bottom: first.bottom,
            left: first.left,
            right: first.right,
            width: first.width,
            height: first.height
          };
        }
      }

      return {
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
        width: rect.width,
        height: rect.height
      };
    },

    extractContextSentence(range, selectedText) {
      if (!range) return '';

      try {
        let container = range.commonAncestorContainer;
        if (container.nodeType === Node.TEXT_NODE) {
          container = container.parentElement;
        }

        const blockTags = ['P', 'DIV', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'ARTICLE', 'SECTION', 'TD'];
        let blockElement = container;

        while (blockElement && blockElement !== document.body && blockElement !== document.documentElement) {
          if (
            blockTags.includes(blockElement.tagName) ||
            blockElement.getAttribute('contenteditable') === 'true' ||
            blockElement.classList?.contains('notion-text-block') ||
            blockElement.hasAttribute('data-content-editable-leaf')
          ) {
            break;
          }
          blockElement = blockElement.parentElement;
        }

        const fullText = (blockElement || container).innerText || (blockElement || container).textContent || '';
        if (!fullText) return selectedText;

        const wordIndex = fullText.indexOf(selectedText);
        if (wordIndex === -1) {
          return fullText.slice(0, 250).trim();
        }

        const delimiters = ['.', '!', '?', '。', '！', '？', '\n'];
        let startIndex = 0;
        for (let i = wordIndex - 1; i >= 0; i--) {
          if (delimiters.includes(fullText[i])) {
            startIndex = i + 1;
            break;
          }
        }

        let endIndex = fullText.length;
        for (let i = wordIndex + selectedText.length; i < fullText.length; i++) {
          if (delimiters.includes(fullText[i])) {
            endIndex = i + 1;
            break;
          }
        }

        const sentence = fullText.substring(startIndex, endIndex).replace(/\s+/g, ' ').trim();
        return sentence.length > 250 ? sentence.substring(0, 250) + '...' : sentence;
      } catch (err) {
        console.warn('[CloudDict] Lỗi khi trích xuất câu ngữ cảnh:', err);
        return selectedText;
      }
    }
  };

  // Tự động lưu selection và hiển thị Quick Trigger khi nhả chuột
  document.addEventListener('mouseup', (e) => {
    // Không hiện trigger nếu click vào bên trong Cloud UI
    if (CloudDictUI.hostElement && e.composedPath().includes(CloudDictUI.hostElement)) {
      return;
    }

    setTimeout(() => {
      const selectionData = SelectionManager.saveCurrentSelection();
      if (!selectionData || !selectionData.text) {
        CloudDictUI.hideTriggerIcon();
        return;
      }

      // Nếu đang có bong bóng mở thì không hiện quick trigger
      if (CloudDictUI.isBubbleActive()) {
        CloudDictUI.hideTriggerIcon();
        return;
      }

      // Kiểm tra cấu hình có bật Floating Trigger không
      chrome.storage.sync.get({ enableFloatingTrigger: true }, (items) => {
        if (items.enableFloatingTrigger !== false) {
          CloudDictUI.showTriggerIcon(selectionData.rect, selectionData.text);
        }
      });
    }, 30);
  }, true);

  document.addEventListener('selectionchange', () => {
    SelectionManager.saveCurrentSelection();
  });

  // ==========================================
  // 2. SHADOW DOM & BUBBLE UI ENGINE (FIXED VIEWPORT)
  // ==========================================
  const CloudDictUI = {
    hostElement: null,
    shadowRoot: null,
    isPinned: false,
    triggerTimer: null,

    ensureShadowRoot() {
      if (!this.hostElement) {
        let existing = document.getElementById('cloud-dict-host');
        if (existing) existing.remove();

        this.hostElement = document.createElement('div');
        this.hostElement.id = 'cloud-dict-host';
        document.body.appendChild(this.hostElement);

        this.shadowRoot = this.hostElement.attachShadow({ mode: 'open' });

        const linkElem = document.createElement('link');
        linkElem.rel = 'stylesheet';
        linkElem.href = chrome.runtime.getURL('src/bubbles.css');
        this.shadowRoot.appendChild(linkElem);
      }
      return this.shadowRoot;
    },

    isBubbleActive() {
      if (!this.shadowRoot) return false;
      return !!this.shadowRoot.querySelector('.cloud-container');
    },

    // 1. Quản lý Icon Đám Mây Nổi Nhanh (Floating Quick Trigger)
    showTriggerIcon(rect, rawText) {
      const root = this.ensureShadowRoot();
      this.hideTriggerIcon();

      if (!rect) return;

      const trigger = document.createElement('div');
      trigger.className = 'cloud-quick-trigger';
      trigger.id = 'cloud-quick-btn';
      trigger.title = `Tra đám mây cho "${sanitizeWord(rawText)}"`;

      // Đặt icon ngay góc trên bên phải vùng chọn
      const topPos = Math.max(10, rect.top - 28);
      const leftPos = Math.min(window.innerWidth - 38, rect.right + 6);

      trigger.style.top = `${topPos}px`;
      trigger.style.left = `${leftPos}px`;

      // SVG biểu tượng đám mây
      trigger.innerHTML = `
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
          <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z"/>
        </svg>
      `;

      trigger.onpointerdown = (e) => {
        e.stopPropagation();
        e.preventDefault();
      };

      trigger.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        this.hideTriggerIcon();
        executeLookup(rawText, rect);
      };

      root.appendChild(trigger);

      // Tự động mờ và biến mất sau 3 giây nếu người dùng không bấm
      this.triggerTimer = setTimeout(() => {
        this.hideTriggerIcon();
      }, 3000);
    },

    hideTriggerIcon() {
      if (this.triggerTimer) {
        clearTimeout(this.triggerTimer);
        this.triggerTimer = null;
      }
      if (this.shadowRoot) {
        const trigger = this.shadowRoot.getElementById('cloud-quick-btn');
        if (trigger) trigger.remove();
      }
    },

    // 2. Đóng và dọn dẹp Bong bóng
    close() {
      this.hideTriggerIcon();
      this.isPinned = false;

      if (this.shadowRoot) {
        const container = this.shadowRoot.querySelector('.cloud-container');
        if (container) {
          container.style.opacity = '0';
          container.style.transform = container.getAttribute('data-position') === 'above' 
            ? 'translateY(-100%) scale(0.85)' 
            : 'translateY(0) scale(0.85)';
          container.style.transition = 'all 0.15s ease';
          setTimeout(() => {
            if (this.hostElement) {
              this.hostElement.remove();
              this.hostElement = null;
              this.shadowRoot = null;
            }
          }, 150);
        } else if (this.hostElement) {
          this.hostElement.remove();
          this.hostElement = null;
          this.shadowRoot = null;
        }
      }
      this.detachDismissListeners();
    },

    speak(word, lang = 'ja') {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(word);
        utterance.lang = lang === 'ja' ? 'ja-JP' : 'en-US';
        utterance.rate = 0.9;
        window.speechSynthesis.speak(utterance);
      }
    },

    calculatePlacement(rect) {
      const innerW = window.innerWidth;
      const innerH = window.innerHeight;

      const effectiveRect = rect || lastMouseCoords || {
        left: innerW / 2 - 50,
        top: innerH / 2 - 20,
        right: innerW / 2 + 50,
        bottom: innerH / 2 + 20,
        width: 100,
        height: 25
      };

      const wordCenterX = effectiveRect.left + (effectiveRect.width || 0) / 2;
      const wordTop = effectiveRect.top;
      const wordBottom = effectiveRect.bottom || (wordTop + (effectiveRect.height || 20));

      const clusterWidth = 330;
      let targetLeft = wordCenterX - (clusterWidth / 2);

      const minLeft = 16;
      const maxLeft = innerW - clusterWidth - 24;
      targetLeft = Math.max(minLeft, Math.min(targetLeft, maxLeft));

      const preferAbove = wordTop > 230;
      let targetTop;

      if (preferAbove) {
        targetTop = wordTop - 12;
      } else {
        targetTop = wordBottom + 12;
      }

      return {
        left: targetLeft,
        top: targetTop,
        isAbove: preferAbove
      };
    },

    showLoading(rect, queryWord) {
      this.hideTriggerIcon();
      const root = this.ensureShadowRoot();
      const existingContainer = root.querySelector('.cloud-container');
      if (existingContainer) existingContainer.remove();

      const pos = this.calculatePlacement(rect);

      const container = document.createElement('div');
      container.className = 'cloud-container';
      container.setAttribute('data-position', pos.isAbove ? 'above' : 'below');
      container.style.left = `${pos.left}px`;
      container.style.top = `${pos.top}px`;

      container.innerHTML = `
        <div class="cloud-bubble bubble-loading" style="position: relative;">
          <span>☁️ Đang tra <strong>"${escapeHTML(queryWord)}"</strong></span>
          <div class="loading-dots">
            <span class="loading-dot"></span>
            <span class="loading-dot"></span>
            <span class="loading-dot"></span>
          </div>
        </div>
      `;

      root.appendChild(container);
      this.attachDismissListeners();
    },

    renderResult(rect, queryWord, result) {
      this.hideTriggerIcon();
      const root = this.ensureShadowRoot();
      const existingContainer = root.querySelector('.cloud-container');
      if (existingContainer) existingContainer.remove();

      const pos = this.calculatePlacement(rect);

      const container = document.createElement('div');
      container.className = 'cloud-container';
      container.setAttribute('data-position', pos.isAbove ? 'above' : 'below');
      container.style.left = `${pos.left}px`;
      container.style.top = `${pos.top}px`;

      const detectedLang = result.detected_lang || 'ja';
      const word = result.word || queryWord;
      const reading = result.reading || '';
      const posText = result.part_of_speech || '';
      const meaning = result.meaning || 'Không tìm thấy giải nghĩa phù hợp.';
      const example = result.example;

      // Nhận diện chế độ: Dịch Câu (Sentence Mode) vs Tra Từ Vựng (Word Mode)
      const isSentence = result.mode === 'sentence' || (!posText && !example);

      if (isSentence) {
        // ==========================================
        // GIAO DIỆN CHẾ ĐỘ DỊCH CÂU (SENTENCE MODE)
        // Chỉ hiện 2 bong bóng: Romaji + Bản dịch
        // ==========================================
        container.innerHTML = `
          <!-- Nút Ghim (Pin) & Nút Đóng -->
          <div class="bubble-pin-btn ${this.isPinned ? 'is-pinned' : ''}" id="btn-pin" title="${this.isPinned ? 'Bỏ ghim (cho phép tự đóng)' : 'Ghim cố định (không tự đóng khi click ngoài)'}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="17" x2="12" y2="22"></line>
              <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>
            </svg>
          </div>
          <div class="bubble-close-btn" id="btn-close" title="Đóng (Esc)">✕</div>

          <!-- 1. Bong bóng Romaji / Cách đọc cả câu -->
          ${reading ? `
            <div style="margin-bottom: 8px;">
              <div class="cloud-bubble bubble-reading is-sentence" style="position: static; display: flex; align-items: flex-start; justify-content: space-between;">
                <div style="flex: 1; word-break: break-word; padding-right: 6px;">${escapeHTML(reading)}</div>
                <div style="display: flex; gap: 6px; align-items: center; flex-shrink: 0; margin-top: 2px;">
                  <span class="reading-icon" id="btn-speak" title="Nghe phát âm cả câu">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                    </svg>
                  </span>
                  <span class="reading-copy-icon" id="btn-copy-reading" title="Sao chép Romaji / Phiên âm">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  </span>
                </div>
              </div>
            </div>
          ` : ''}

          <!-- 2. Bong bóng Bản dịch tiếng Việt -->
          <div class="cloud-bubble bubble-meaning is-sentence" style="position: static;">
            <div class="meaning-header">
              <span style="font-size: 11.5px; font-weight: 700; color: #38bdf8; text-transform: uppercase; letter-spacing: 0.04em;">
                Dịch câu
                ${result.fromCache ? '<span style="font-size: 10px; color: #10b981; font-weight: normal; background: rgba(16, 185, 129, 0.15); padding: 1px 6px; border-radius: 8px; margin-left: 6px;">Cache</span>' : ''}
              </span>
              <button class="btn-bubble-action" id="btn-copy" title="Sao chép bản dịch">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>
            <div class="meaning-text" style="font-size: 14.5px; line-height: 1.5; color: #f8fafc;">${escapeHTML(meaning)}</div>
          </div>
        `;
      } else {
        // ==========================================
        // GIAO DIỆN CHẾ ĐỘ TRA TỪ VỰNG (WORD MODE)
        // Đầy đủ 4 bong bóng: Romaji, Từ loại, Nghĩa, Ví dụ
        // ==========================================
        container.innerHTML = `
          <!-- Nút Ghim (Pin) & Nút Đóng -->
          <div class="bubble-pin-btn ${this.isPinned ? 'is-pinned' : ''}" id="btn-pin" title="${this.isPinned ? 'Bỏ ghim (cho phép tự đóng)' : 'Ghim cố định (không tự đóng khi click ngoài)'}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="17" x2="12" y2="22"></line>
              <path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"></path>
            </svg>
          </div>
          <div class="bubble-close-btn" id="btn-close" title="Đóng (Esc)">✕</div>

          <!-- 1. Hàng trên: Phát âm & Từ loại -->
          <div style="display: flex; gap: 8px; margin-bottom: 8px; align-items: center;">
            ${reading ? `
              <div class="cloud-bubble bubble-reading" style="position: static;">
                <span>${escapeHTML(reading)}</span>
                <span class="reading-icon" id="btn-speak" title="Nghe phát âm">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path>
                  </svg>
                </span>
                <span class="reading-copy-icon" id="btn-copy-reading" title="Sao chép phiên âm / cách đọc">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                  </svg>
                </span>
              </div>
            ` : ''}

            ${posText ? `
              <div class="cloud-bubble bubble-pos" style="position: static;">
                ${escapeHTML(posText)}
              </div>
            ` : ''}
          </div>

          <!-- 2. Bong bóng Trung tâm: Nghĩa tiếng Việt -->
          <div class="cloud-bubble bubble-meaning" style="position: static; margin-bottom: 8px;">
            <div class="meaning-header">
              <span class="meaning-word">
                ${escapeHTML(word)}
                ${result.fromCache ? '<span style="font-size: 10px; color: #10b981; font-weight: normal; background: rgba(16, 185, 129, 0.15); padding: 1px 6px; border-radius: 8px;">Cache</span>' : ''}
              </span>
              <button class="btn-bubble-action" id="btn-copy" title="Sao chép nghĩa">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>
            <div class="meaning-text">${escapeHTML(meaning)}</div>
          </div>

          <!-- 3. Bong bóng Dưới cùng: Ví dụ & Bản dịch -->
          ${example && (example.original || example.vietnamese) ? `
            <div class="cloud-bubble bubble-example" style="position: static;">
              ${example.original ? `<div class="example-original">${escapeHTML(example.original)}</div>` : ''}
              ${example.vietnamese ? `<div class="example-vietnamese">${escapeHTML(example.vietnamese)}</div>` : ''}
            </div>
          ` : ''}
        `;
      }

      root.appendChild(container);

      // Gắn sự kiện nút Đóng
      const closeBtn = root.getElementById('btn-close');
      if (closeBtn) {
        closeBtn.onclick = () => {
          this.isPinned = false;
          this.close();
        };
      }

      // Gắn sự kiện nút Ghim (Pin)
      const pinBtn = root.getElementById('btn-pin');
      if (pinBtn) {
        pinBtn.onclick = (e) => {
          e.stopPropagation();
          this.isPinned = !this.isPinned;
          pinBtn.classList.toggle('is-pinned', this.isPinned);
          pinBtn.title = this.isPinned 
            ? 'Bỏ ghim (cho phép tự đóng)' 
            : 'Ghim cố định (không tự đóng khi click ngoài)';
        };
      }

      // Gắn sự kiện nút Nghe phát âm
      const speakBtn = root.getElementById('btn-speak');
      if (speakBtn) speakBtn.onclick = () => this.speak(word, detectedLang);

      // Gắn sự kiện nút Copy Romaji / Reading
      const copyReadingBtn = root.getElementById('btn-copy-reading');
      if (copyReadingBtn && reading) {
        copyReadingBtn.onclick = (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(reading).then(() => {
            copyReadingBtn.innerHTML = `
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            `;
            setTimeout(() => {
              copyReadingBtn.innerHTML = `
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              `;
            }, 1600);
          });
        };
      }

      // Gắn sự kiện nút Copy Nghĩa tiếng Việt
      const copyBtn = root.getElementById('btn-copy');
      if (copyBtn) {
        copyBtn.onclick = () => {
          const textToCopy = isSentence ? meaning : `${word}: ${meaning}`;
          navigator.clipboard.writeText(textToCopy).then(() => {
            copyBtn.innerHTML = `
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            `;
            setTimeout(() => {
              copyBtn.innerHTML = `
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              `;
            }, 1800);
          });
        };
      }

      this.attachDismissListeners();
    },

    showError(rect, queryWord, errorMsg) {
      this.hideTriggerIcon();
      const root = this.ensureShadowRoot();
      const existingContainer = root.querySelector('.cloud-container');
      if (existingContainer) existingContainer.remove();

      const pos = this.calculatePlacement(rect);

      const container = document.createElement('div');
      container.className = 'cloud-container';
      container.setAttribute('data-position', pos.isAbove ? 'above' : 'below');
      container.style.left = `${pos.left}px`;
      container.style.top = `${pos.top}px`;

      const isKeyError = errorMsg.includes('API Key');

      container.innerHTML = `
        <div class="bubble-close-btn" id="btn-close" title="Đóng">✕</div>
        <div class="cloud-bubble bubble-error" style="position: static;">
          <span class="error-icon">⚠️</span>
          <div>
            <div style="font-weight: 600; margin-bottom: 3px;">Không thể tra từ "${escapeHTML(queryWord)}"</div>
            <div style="color: #fca5a5; font-size: 12px; margin-bottom: 6px;">${escapeHTML(errorMsg)}</div>
            ${isKeyError ? `<a href="#" id="link-open-options" style="color: #38bdf8; text-decoration: underline; font-size: 11.5px;">Cài đặt API Key ngay ↗</a>` : ''}
          </div>
        </div>
      `;

      root.appendChild(container);

      const closeBtn = root.getElementById('btn-close');
      if (closeBtn) closeBtn.onclick = () => this.close();

      const optLink = root.getElementById('link-open-options');
      if (optLink) {
        optLink.onclick = (e) => {
          e.preventDefault();
          chrome.runtime.sendMessage({ type: 'REQ_OPEN_OPTIONS' });
        };
      }

      this.attachDismissListeners();
    },

    handleOutsideClick: null,
    handleKeyDown: null,
    handleScroll: null,

    attachDismissListeners() {
      this.detachDismissListeners();

      this.handleOutsideClick = (e) => {
        // NẾU ĐANG GHIM -> KHÔNG TỰ ĐÓNG KHI CLICK NGOÀI!
        if (this.isPinned) return;

        if (!this.hostElement) return;
        if (!e.composedPath().includes(this.hostElement)) {
          this.close();
        }
      };

      this.handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          this.close();
        }
      };

      let scrollCount = 0;
      this.handleScroll = () => {
        // NẾU ĐANG GHIM -> KHÔNG TỰ ĐÓNG KHI CUỘN TRANG!
        if (this.isPinned) return;

        scrollCount++;
        if (scrollCount > 4) {
          this.close();
        }
      };

      setTimeout(() => {
        document.addEventListener('pointerdown', this.handleOutsideClick, true);
        document.addEventListener('keydown', this.handleKeyDown, true);
        window.addEventListener('scroll', this.handleScroll, { capture: true, passive: true });
      }, 50);
    },

    detachDismissListeners() {
      if (this.handleOutsideClick) {
        document.removeEventListener('pointerdown', this.handleOutsideClick, true);
        this.handleOutsideClick = null;
      }
      if (this.handleKeyDown) {
        document.removeEventListener('keydown', this.handleKeyDown, true);
        this.handleKeyDown = null;
      }
      if (this.handleScroll) {
        window.removeEventListener('scroll', this.handleScroll, true);
        this.handleScroll = null;
      }
    }
  };

  window.CloudDictUI = CloudDictUI;

  // ==========================================
  // 3. HÀM KÍCH HOẠT TRA TỪ CHUNG (TRIGGER)
  // ==========================================
  let currentSession = null;

  function executeLookup(rawText, rect, contextSentence) {
    const cleanWord = sanitizeWord(rawText);
    if (!cleanWord) return;

    const targetRect = rect || SelectionManager.lastRect || lastMouseCoords;
    const targetSentence = contextSentence || SelectionManager.lastContextSentence;

    currentSession = {
      word: cleanWord,
      rect: targetRect,
      contextSentence: targetSentence,
      timestamp: Date.now()
    };

    CloudDictUI.showLoading(targetRect, cleanWord);

    chrome.runtime.sendMessage(
      {
        type: 'REQ_LOOKUP_WORD',
        payload: {
          word: cleanWord,
          contextSentence: targetSentence
        }
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error('[CloudDict] Lỗi kết nối extension:', chrome.runtime.lastError);
          CloudDictUI.showError(targetRect, cleanWord, 'Không thể kết nối với extension.');
          return;
        }

        if (response && response.success) {
          CloudDictUI.renderResult(targetRect, cleanWord, response.data);
        } else {
          CloudDictUI.showError(targetRect, cleanWord, response?.error || 'Đã xảy ra lỗi.');
        }
      }
    );
  }

  // ==========================================
  // 4. PHÍM TẮT ALT + Q
  // ==========================================
  document.addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'q' || e.key === 'Q' || e.code === 'KeyQ')) {
      const currentSelection = SelectionManager.saveCurrentSelection();
      const rawText = currentSelection?.text || window.getSelection()?.toString()?.trim() || SelectionManager.lastText;

      if (rawText) {
        e.preventDefault();
        e.stopPropagation();
        console.log('[CloudDict] Kích hoạt bằng phím tắt Alt+Q:', rawText);
        executeLookup(rawText, currentSelection?.rect, currentSelection?.contextSentence);
      }
    }
  }, true);

  // ==========================================
  // 5. MESSAGE LISTENER TỪ SERVICE WORKER
  // ==========================================
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'CMD_INIT_LOOKUP': {
        const rawText = message.payload?.selectionText || '';
        const cleanWord = sanitizeWord(rawText);

        const currentData = SelectionManager.saveCurrentSelection() || {
          rect: SelectionManager.lastRect || lastMouseCoords,
          contextSentence: SelectionManager.lastContextSentence
        };

        const targetRect = currentData.rect || SelectionManager.lastRect || lastMouseCoords;
        const targetSentence = currentData.contextSentence || SelectionManager.lastContextSentence;

        currentSession = {
          word: cleanWord,
          rect: targetRect,
          contextSentence: targetSentence,
          timestamp: Date.now()
        };

        CloudDictUI.showLoading(targetRect, cleanWord);

        sendResponse({
          success: true,
          word: cleanWord,
          contextSentence: targetSentence,
          rect: targetRect
        });
        break;
      }

      case 'CMD_TRIGGER_SHORTCUT': {
        const currentData = SelectionManager.saveCurrentSelection();
        const rawText = currentData?.text || window.getSelection()?.toString()?.trim() || SelectionManager.lastText;
        if (rawText) {
          executeLookup(rawText, currentData?.rect, currentData?.contextSentence);
        }
        sendResponse({ success: true });
        break;
      }

      case 'CMD_RENDER_SUCCESS': {
        const { queryWord, result } = message.payload || {};
        const rect = currentSession ? currentSession.rect : (SelectionManager.lastRect || lastMouseCoords);
        CloudDictUI.renderResult(rect, sanitizeWord(queryWord), result);
        sendResponse({ success: true });
        break;
      }

      case 'CMD_RENDER_ERROR': {
        const { queryWord, errorMsg } = message.payload || {};
        const rect = currentSession ? currentSession.rect : (SelectionManager.lastRect || lastMouseCoords);
        CloudDictUI.showError(rect, sanitizeWord(queryWord), errorMsg);
        sendResponse({ success: true });
        break;
      }

      default:
        break;
    }
    return true;
  });
})();
