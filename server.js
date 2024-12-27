/**
 * server.js
 */
const express = require('express');
const fileUpload = require('express-fileupload');
const path = require('path');
const fs = require('fs');
const { JSDOM } = require('jsdom');
const convert = require('xml-js');

// Thư viện chuyển PDF -> ảnh
const poppler = require('pdf-poppler');

// Thư viện OCR
const Tesseract = require('tesseract.js');

// Thư viện tạo docx từ text
const { Document, Packer, Paragraph, TextRun } = require('docx');

const app = express();
const PORT = 3000;

// Sử dụng middleware để phục vụ file tĩnh (index.html)
app.use(express.static('public'));

// Sử dụng middleware để upload file
app.use(fileUpload());

// Đường dẫn lưu file upload
const UPLOAD_DIR = path.join(__dirname, 'uploads');
// Đường dẫn lưu ảnh tạm sau khi chuyển
const OUTPUT_IMG_DIR = path.join(__dirname, 'outputs', 'images');
// Đường dẫn lưu file docx kết quả
const OUTPUT_DOCX_DIR = path.join(__dirname, 'outputs', 'docx');

// Tạo folder nếu chưa tồn tại
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_IMG_DIR)) fs.mkdirSync(OUTPUT_IMG_DIR, { recursive: true });
if (!fs.existsSync(OUTPUT_DOCX_DIR)) fs.mkdirSync(OUTPUT_DOCX_DIR, { recursive: true });

/**
 * Hàm chuyển PDF -> ảnh (PNG) cho tất cả các trang
 * Trả về mảng đường dẫn ảnh đã sinh ra
 */
async function convertPdfToImages(pdfFilePath) {
  // Tên file không có extension
  const baseName = path.basename(pdfFilePath, path.extname(pdfFilePath));
  const option = {
    format: 'png',
    out_dir: OUTPUT_IMG_DIR,
    out_prefix: baseName,
    page: null, // null => chuyển tất cả các trang
  };

  // Xóa các ảnh cũ liên quan đến file cũ (nếu cần)
  // ...

  await poppler.convert(pdfFilePath, option);

  // Tìm các file ảnh mới sinh
  // Mặc định pdf-poppler đặt tên: <baseName>-1.png, <baseName>-2.png, ...
  const files = fs.readdirSync(OUTPUT_IMG_DIR);
  // Lọc những file bắt đầu với baseName + '-' (hoặc regex)
  const imagePaths = files
    .filter((f) => f.startsWith(baseName + '-'))
    .map((f) => path.join(OUTPUT_IMG_DIR, f));

  // Sắp xếp theo thứ tự trang (phòng trường hợp listing không theo thứ tự)
  imagePaths.sort((a, b) => {
    const aNum = parseInt(path.basename(a).split('-')[1]);
    const bNum = parseInt(path.basename(b).split('-')[1]);
    return aNum - bNum;
  });

  return imagePaths;
}

/**
 * Hàm OCR danh sách ảnh bằng Tesseract.js (tiếng Việt)
 * Trả về text gộp của tất cả trang
 */
async function ocrImages(imagePaths) {
    let combinedText = '';
    const worker = await Tesseract.createWorker('vie'); // Khởi tạo worker với ngôn ngữ Vietnamese

    try {
        const results = await Promise.all(imagePaths.map((imgPath) => worker.recognize(imgPath)));

        results.forEach(({ data: { text } }) => {
            combinedText += text + '\n\n\n';
        });
    } catch (err) {
        console.error('Lỗi OCR:', err);
    } finally {
        await worker.terminate();
    }

    return combinedText;
}

async function ocrHocrImages(imagePaths) {
    let combinedHocr = ''; // Thay vì combinedText
    const worker = await Tesseract.createWorker('vie');

    try {
        const results = await Promise.all(
            imagePaths.map((imgPath) =>
                worker.recognize(imgPath, {
                    tessjs_create_hocr: '1', // Bật chế độ hOCR
                })
            )
        );

        results.forEach(({ data: { hocr } }) => {
            combinedHocr += hocr; // Nối hOCR của các trang
        });
    } catch (err) {
        console.error('Lỗi OCR:', err);
    } finally {
        await worker.terminate();
    }

    return combinedHocr; // Trả về chuỗi hOCR
}
/**
 * Hàm tạo file .docx đơn giản từ văn bản
 * Trả về đường dẫn file docx đã tạo
 */
async function createDocxFromText(text, outputFileName) {
    // Tách thành các dòng
    const lines = text.split('\n');
  
    // Tạo Document
    const doc = new Document({
      sections: [
        {
          properties: {},
          children: lines.map((line) => {
            return new Paragraph({
              children: [new TextRun(line)],
            });
          }),
        },
      ],
    });
  
    // Tạo buffer
    const buffer = await Packer.toBuffer(doc); // Sửa thành Packer.toBuffer(doc)
  
    const outputPath = path.join(OUTPUT_DOCX_DIR, outputFileName);
    fs.writeFileSync(outputPath, buffer);
    return outputPath;
  }


async function createDocxFromHocr(hocr, outputFileName) {
  const doc = new Document({
    sections: [],
  });

  // Chuyển đổi hOCR (XML) sang JSON để dễ xử lý
  const hocrJson = convert.xml2js(hocr, { compact: true, spaces: 4 });

  // jsdom để phân tích cú pháp hOCR
  const dom = new JSDOM(hocr, { contentType: 'text/html' });
  const document = dom.window.document;

  // Lấy tất cả các phần tử ocr_line
  const lines = document.querySelectorAll('.ocr_line');

  let paragraphs = [];
  
  lines.forEach((line) => {
      const lineText = line.textContent.trim();
      if (lineText !== "") {
          let paragraph = new Paragraph({
              children: [
                  new TextRun({
                      text: lineText
                  })
              ]
          });
          paragraphs.push(paragraph);
      }
  });

  doc.addSection({
      children: paragraphs
  });

  // Tạo buffer
  const buffer = await Packer.toBuffer(doc);

  const outputPath = path.join(OUTPUT_DOCX_DIR, outputFileName);
  fs.writeFileSync(outputPath, buffer);
  return outputPath;
}

/**
 * Xử lý upload file PDF và thực hiện OCR
 */
app.post('/upload', async (req, res) => {
  try {
    // Kiểm tra có file không
    if (!req.files || !req.files.pdfFile) {
      return res.status(400).send('Vui lòng chọn file PDF!');
    }

    // Lấy file từ request
    const pdfFile = req.files.pdfFile;
    // Kiểm tra định dạng
    if (path.extname(pdfFile.name).toLowerCase() !== '.pdf') {
      return res.status(400).send('Chỉ chấp nhận file .pdf');
    }

    // Tạo đường dẫn lưu file
    const pdfFileName = Date.now() + '_' + pdfFile.name;
    const pdfFilePath = path.join(UPLOAD_DIR, pdfFileName);

    // Lưu file PDF vào server
    await pdfFile.mv(pdfFilePath);

    // Bước 1: Chuyển PDF -> ảnh
    console.log('Đang chuyển PDF -> ảnh...');
    const imagePaths = await convertPdfToImages(pdfFilePath);

    // Bước 2: OCR ảnh (tiếng Việt)
    console.log('Đang OCR các trang ảnh...');
    const hocrText  = await ocrImages(imagePaths);

    // Bước 3: Tạo file .docx từ text
        console.log('Đang tạo file DOCX...');
        const docxFileName = path.basename(pdfFileName, '.pdf') + '.docx';
        const docxFilePath = await createDocxFromText(hocrText, docxFileName);

    // Trả về link download cho client
    // (Ở đây, ta có thể tự động tải xuống hoặc gửi đường dẫn)
    res.download(docxFilePath, (err) => {
      if (err) {
        console.error('Lỗi trả file docx:', err);
      }
      // Optionally: Xóa file tạm (nếu muốn)
    });
  } catch (error) {
    console.error(error);
    res.status(500).send('Có lỗi xảy ra khi xử lý file.');
  }
});

/**
 * Khởi động server
 */
app.listen(PORT, () => {
  console.log(`Server đang chạy tại http://localhost:${PORT}`);
});
