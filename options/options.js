// options.js - Quản lý cài đặt Gemini API và Model

document.addEventListener('DOMContentLoaded', () => {
  const apiKeyInput = document.getElementById('api-key');
  const toggleVisibilityBtn = document.getElementById('toggle-key-visibility');
  const eyeIcon = document.getElementById('eye-icon');
  const modelPresetSelect = document.getElementById('model-preset');
  const customModelGroup = document.getElementById('custom-model-group');
  const customModelInput = document.getElementById('custom-model-name');
  const explainLangSelect = document.getElementById('explain-lang');
  const toggleFloatingInput = document.getElementById('toggle-floating');
  const testConnBtn = document.getElementById('btn-test-connection');
  const testSpinner = document.getElementById('test-spinner');
  const testBtnText = document.getElementById('test-btn-text');
  const optionsForm = document.getElementById('options-form');
  const statusBanner = document.getElementById('status-banner');

  // 1. Tải cấu hình đã lưu từ chrome.storage.sync
  chrome.storage.sync.get(
    {
      geminiApiKey: '',
      geminiModel: 'gemini-3.8-flash',
      geminiCustomModel: '',
      explainLang: 'vi',
      enableFloatingTrigger: true
    },
    (items) => {
      apiKeyInput.value = items.geminiApiKey || '';
      explainLangSelect.value = items.explainLang || 'vi';
      toggleFloatingInput.checked = items.enableFloatingTrigger !== false;

      const presetValues = ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3-flash-preview'];
      if (presetValues.includes(items.geminiModel)) {
        modelPresetSelect.value = items.geminiModel;
        customModelGroup.style.display = 'none';
      } else if (items.geminiModel) {
        modelPresetSelect.value = 'custom';
        customModelGroup.style.display = 'flex';
        customModelInput.value = items.geminiModel;
      }

      if (items.geminiCustomModel) {
        customModelInput.value = items.geminiCustomModel;
      }
    }
  );

  // 2. Ẩn/Hiện ô nhập Model tùy chỉnh khi chọn dropdown
  modelPresetSelect.addEventListener('change', () => {
    if (modelPresetSelect.value === 'custom') {
      customModelGroup.style.display = 'flex';
      customModelInput.focus();
    } else {
      customModelGroup.style.display = 'none';
    }
  });

  // 3. Ẩn / Hiện API Key (Password Toggle)
  let isPasswordVisible = false;
  toggleVisibilityBtn.addEventListener('click', () => {
    isPasswordVisible = !isPasswordVisible;
    apiKeyInput.type = isPasswordVisible ? 'text' : 'password';
    
    // Đổi icon
    if (isPasswordVisible) {
      eyeIcon.innerHTML = `
        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
        <line x1="1" y1="1" x2="23" y2="23"></line>
      `;
    } else {
      eyeIcon.innerHTML = `
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
        <circle cx="12" cy="12" r="3"></circle>
      `;
    }
  });

  // 4. Lấy model hiện tại được chọn
  function getSelectedModel() {
    if (modelPresetSelect.value === 'custom') {
      return (customModelInput.value || '').trim() || 'gemini-2.5-flash';
    }
    return modelPresetSelect.value;
  }

  // 5. Hiển thị thông báo trạng thái
  function showStatus(message, type = 'info', autoHide = true) {
    statusBanner.className = `status-banner ${type}`;
    statusBanner.textContent = message;
    statusBanner.style.display = 'flex';

    if (autoHide) {
      setTimeout(() => {
        statusBanner.style.display = 'none';
      }, 5000);
    }
  }

  // 6. Kiểm tra kết nối API Key (Test Connection)
  testConnBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
      showStatus('⚠️ Vui lòng nhập Gemini API Key trước khi kiểm tra!', 'error');
      apiKeyInput.focus();
      return;
    }

    const modelName = getSelectedModel();

    // Hiển thị trạng thái loading
    testSpinner.style.display = 'inline-block';
    testBtnText.textContent = 'Đang kiểm tra...';
    testConnBtn.disabled = true;
    statusBanner.style.display = 'none';

    try {
      // Gọi thử nghiệm lightweight generateContent để kiểm tra cả Key và Model
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelName)}:generateContent?key=${apiKey}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Hello' }] }],
          generationConfig: { maxOutputTokens: 2 }
        }),
        signal: controller.signal
      });

      clearTimeout(timer);

      const data = await response.json();

      if (!response.ok) {
        const errorMsg = data.error?.message || `Mã lỗi HTTP: ${response.status}`;
        throw new Error(errorMsg);
      }

      showStatus(`✓ Kết nối thành công! Model "${modelName}" hoạt động tốt.`, 'success', false);
    } catch (err) {
      if (err.name === 'AbortError') {
        showStatus(`❌ Lỗi kết nối: Quá thời gian chờ (6s). Vui lòng thử lại hoặc chọn model khác.`, 'error', false);
      } else {
        showStatus(`❌ Lỗi kết nối: ${err.message}`, 'error', false);
      }
    } finally {
      testSpinner.style.display = 'none';
      testBtnText.textContent = 'Kiểm Tra Kết Nối';
      testConnBtn.disabled = false;
    }
  });

  // 7. Lưu cài đặt vào chrome.storage.sync
  optionsForm.addEventListener('submit', (e) => {
    e.preventDefault();

    const apiKey = apiKeyInput.value.trim();
    const modelSelection = modelPresetSelect.value;
    const customModelName = customModelInput.value.trim();
    const activeModel = modelSelection === 'custom' ? (customModelName || 'gemini-3.8-flash') : modelSelection;
    const explainLang = explainLangSelect.value;
    const enableFloatingTrigger = toggleFloatingInput.checked;

    if (!apiKey) {
      showStatus('⚠️ Vui lòng nhập Gemini API Key!', 'error');
      apiKeyInput.focus();
      return;
    }

    chrome.storage.sync.set(
      {
        geminiApiKey: apiKey,
        geminiModel: activeModel,
        geminiCustomModel: customModelName,
        explainLang: explainLang,
        enableFloatingTrigger: enableFloatingTrigger
      },
      () => {
        showStatus('🎉 Đã lưu cài đặt thành công! Bạn có thể bắt đầu tra từ.', 'success');
      }
    );
  });
});
