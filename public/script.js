// DOM references
const pdfPreviewContainer = document.querySelector('.pdf-preview-container');
const pdfPreview = document.getElementById('pdf-preview');
const pdfPreviewPlaceholder = document.getElementById('pdf-preview-placeholder');
const fileInput = document.getElementById('pdfFile');
const progressBar = document.getElementById('progress-bar');
const progressText = document.getElementById('progress-text');
const downloadLink = document.getElementById('download-link');
const errorMessage = document.getElementById('error-message');
const progressArea = document.querySelector('.progress-area');

// Interval để “nhấp nháy” progress
let blinkingInterval = null;

pdfPreviewContainer.addEventListener('click', () => {
  fileInput.click();
});

pdfPreviewContainer.addEventListener('dragover', (e) => {
  e.preventDefault();
  pdfPreviewContainer.classList.add('dragover');
});

pdfPreviewContainer.addEventListener('dragleave', () => {
  pdfPreviewContainer.classList.remove('dragover');
});

pdfPreviewContainer.addEventListener('drop', (e) => {
  e.preventDefault();
  pdfPreviewContainer.classList.remove('dragover');

  const files = e.dataTransfer.files;
  if (files.length > 0 && files[0].type === 'application/pdf') {
    fileInput.files = files;
    showPdfPreview(files[0]);
    uploadFile(files[0]);
  } else {
    showError('Vui lòng chọn đúng file PDF.');
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    const file = fileInput.files[0];
    if (file.type === 'application/pdf') {
      showPdfPreview(file);
      uploadFile(file);
    } else {
      showError('Vui lòng chọn đúng file PDF.');
      fileInput.value = '';
    }
  }
});

// Hiển thị PDF preview
function showPdfPreview(file) {
  const fileURL = URL.createObjectURL(file);
  pdfPreview.src = fileURL;
  pdfPreview.style.display = 'block';
  pdfPreviewPlaceholder.style.display = 'none';
  hideError();
}

// Upload file
async function uploadFile(file) {
  const formData = new FormData();
  formData.append('pdfFile', file);

  // Tính toán thời gian giả lập tùy vào dung lượng file (đơn vị bytes)
  // Ví dụ: 3 giây trên mỗi MB
  const fileSizeMB = file.size / (1024 * 1024);
  const fakeProgressDuration = Math.round(fileSizeMB * 3000); // tuỳ chỉnh

  progressArea.style.display = 'block';
  progressBar.value = 0;
  progressText.textContent = '0%';
  downloadLink.style.display = 'none';

  // Mục tiêu giả lập lên 70%
  const fakeProgressTarget = 70;
  const startTime = Date.now();
  let currentProgress = 0;

  // Interval 1: tăng dần từ 0 lên 70%
  const progressInterval = setInterval(() => {
    const elapsedTime = Date.now() - startTime;
    currentProgress = Math.floor(
      (elapsedTime / fakeProgressDuration) * fakeProgressTarget
    );

    // Khi đến 70% (hoặc quá), dừng lại
    if (currentProgress >= fakeProgressTarget) {
      currentProgress = fakeProgressTarget;
      clearInterval(progressInterval);

      // Bắt đầu nhấp nháy tại 70%
      startBlinkingProgress();
    }

    updateProgressUI(currentProgress);
  }, 50);

  try {
    // Gửi request (thay "/upload" bằng endpoint thật)
    const response = await fetch('/upload', {
      method: 'POST',
      body: formData,
    });

    // Khi có phản hồi, dừng nhấp nháy
    stopBlinkingProgress();

    if (response.ok) {
      // Thanh progress nhảy lên 100% khi server xử lý xong
      updateProgressUI(100);

      // Giả sử server trả về file docx dạng blob
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      downloadLink.href = url;
      downloadLink.download = file.name.replace('.pdf', '.docx');
      downloadLink.style.display = 'inline-block';

      setTimeout(() => {
        progressArea.style.display = 'none';
      }, 500);

      hideError();
    } else {
      const error = await response.text();
      showError('Lỗi: ' + error);
      progressArea.style.display = 'none';
    }
  } catch (error) {
    stopBlinkingProgress();
    showError('Lỗi kết nối: ' + error);
    progressArea.style.display = 'none';
  }
}

// Bắt đầu nhấp nháy ở giá trị hiện tại (thường là 70%)
function startBlinkingProgress() {
  blinkingInterval = setInterval(() => {
    // Cách 1: toggle opacity
    if (progressBar.style.opacity === '0.5') {
      progressBar.style.opacity = '1';
    } else {
      progressBar.style.opacity = '0.5';
    }

    // Cách 2: toggle hiển thị (nếu muốn)
    // progressBar.style.display = (progressBar.style.display === 'none' ? 'block' : 'none');
  }, 300); // thời gian nhấp nháy (300ms)
}

// Dừng nhấp nháy
function stopBlinkingProgress() {
  if (blinkingInterval) {
    clearInterval(blinkingInterval);
    blinkingInterval = null;
  }
  // Đảm bảo progress bar hiển thị lại bình thường
  progressBar.style.opacity = '1';
  // progressBar.style.display = 'block'; // nếu dùng toggle display
}

// Cập nhật giá trị hiển thị trên progress bar và text
function updateProgressUI(value) {
  progressBar.value = value;
  progressText.textContent = `${value}%`;
}

// Hiển thị lỗi
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.style.display = 'block';
}

// Ẩn lỗi
function hideError() {
  errorMessage.style.display = 'none';
}
