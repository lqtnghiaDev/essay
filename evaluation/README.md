# RAG Evaluation (DeepEval)

Thư mục này nằm cùng cấp với `be/` và `fe/`. Dùng **Python**, framework **DeepEval**, và **Gemini** làm LLM judge để đo các metric trong `rag-evaluation-bilingual.md` (RAG Triad và tách retriever/generator).

## Chuẩn bị

- **Python 3.10+** (đã thử trên Windows với UTF-8; script cố `reconfigure` stdout sang UTF-8).
- Khóa **Gemini**: cùng loại khóa với backend (`GEMINI_API_KEY` trong `be/.env`). Mỗi lần chạy đánh giá có thể có **chi phí gọi API** (Gemini Flash thường rẻ hơn Pro).
- Tuỳ chọn đọc **`GOOGLE_API_KEY`**: nếu không có thì script dùng `GEMINI_API_KEY`.

## Cài đặt (một lần)

PowerShell — tại thư mục **`internship-management/evaluation`**:

```powershell
cd "d:\2. HCMUTE\Nam4\KLTN\internship-management\evaluation"

# Môi trường ảo (khuyến nghị)
python -m venv .venv
.\.venv\Scripts\Activate.ps1

# Cập nhật pip (tuỳ chọn nhưng nên có)
python -m pip install --upgrade pip

# Dependencies
pip install -r requirements.txt
```

Copy biến môi trường:

```powershell
copy .env.example .env
# Chỉnh .env — đặt GEMINI_API_KEY=... và (tuỳ chọn) EVAL_GEMINI_MODEL=gemini-2.5-flash
```

## Cấu trúc dataset (JSON)

### RAG Triad — `data/rag_triad.demo.json`

Không cần `expected_output`. Mỗi phần tử trong `cases` có:

- `id`, `input`, `actual_output`, `retrieval_context` (mảng chuỗi).

Đây là dữ liệu **đã có sẵn** sau khi bạn hoặc ghi log từ pipeline (câu hỏi, câu trả lời model, các chunk retrieval). Backend thật của bạn có thêm context từ DB; khi đánh giá độ trung thực so với “ngữ cảnh đầy đời”, hãy gộp các chunk và phần tương đương DB vào các chuỗi trong `retrieval_context`.

### Approach 1 (tách retrieval / generator) — `data/rag_split.demo.json`

- **`retrieval_cases`**: phải có **`expected_output`** (golden answer); thêm `input`, `actual_output`, `retrieval_context`.
- **`generation_cases`**: `input`, `actual_output`, `retrieval_context` (không bắt buộc `expected_output` cho faithfulness/relevancy).

## Chạy đánh giá

Luôn kích hoạt venv trong `evaluation` trước khi chạy.

Script in **hai phần** trên terminal: (1) bảng **`deepeval`-style** (package `rich`, cột *Test case / Metric / Score / Status / Overall Success Rate*), (2) tóm tắt số và cảnh báo. Chỉ cần file JSON không in bảng: thêm **`--no-table`**.

Screenshots ví dụ dùng trong tài liệu: `evaluation/docs/assets/` và được nhúng ở `rag-evaluation-bilingual.md`.

### 1) RAG Triad (mặc định khuyến nghị để bắt đầu)

```powershell
cd "d:\2. HCMUTE\Nam4\KLTN\internship-management\evaluation"
.\.venv\Scripts\Activate.ps1
python run_rag_eval.py triad
```

Tuỳ chọn chỉ định dataset và file kết quả:

```powershell
python run_rag_eval.py triad --cases .\data\rag_triad.demo.json --output .\results\triad_run_1.json
```

### 2) Tách Retrieval + Generation

```powershell
python run_rag_eval.py split --cases .\data\rag_split.demo.json --output .\results\split_run_1.json
```

### 3) Xem kết quả

1. **Trên terminal**: sau khi chạy xong, script in phần **tóm tắt** (điểm trung bình theo nhóm metric).
2. **Trong file JSON** (`results/triad_latest.json` hoặc đường dẫn bạn truyền `--output`): mở bằng editor — mục **`cases`** chứa từng testcase với **`score`**, **`success`**, và **`reason`** (giải thích ngắn từ LLM judge).

Gợi ý đọc nhanh bằng PowerShell:

```powershell
Get-Content .\results\triad_latest.json -Encoding utf8 | Select-Object -First 80
```

## Ý nghĩa metric (ánh xạ bài trong `rag-evaluation-bilingual.md`)

| Metric (DeepEval) | Ý nghĩa ngắn |
|-------------------|----------------|
| **AnswerRelevancy** | Câu trả lời có sát **câu hỏi** không |
| **Faithfulness** | Câu trả lời có **bám** các chuỗi trong `retrieval_context` không |
| **ContextualRelevancy** | Các đoạn context có **liên quan** tới **câu hỏi** không |

Với **`split`** — retrieval: thêm Contextual Precision / Recall (so với `expected_output`).

## Gắn với pipeline thực của dự án

1. Log từ `ChatService`: trước khi gọi Gemini, ghi **`content`** (câu hỏi), **`ragChunks`** `.pageContent`, và **`aiResponse`**.
2. Chép các bộ `{ input, retrieval_context[], actual_output }` vào `data/` (file JSON hoặc mở rộng demo).
3. Chạy lại `triad`; so sánh khi đổi `RAG_TOP_K`, embedding model hoặc chunk size trong `be`.

## Troubleshooting

- **`GeminiModel requires google.genai`**: chạy `pip install google-genai` trong cùng venv.
- **Thiếu API key**: kiểm tra `evaluation/.env` có `GEMINI_API_KEY` (hoặc `GOOGLE_API_KEY`).
- **`403 PERMISSION_DENIED` … `API key was reported as leaked`**: Google đã vô hiệu hoá khóa (thường do để lộ: commit `.env`, dán vào gist, screenshot, chat công khai). **Tạo khóa mới** tại [Google AI Studio → API keys](https://aistudio.google.com/apikey), chỉnh `evaluation/.env` và **`be/.env`**, không commit file chứa khóa. Nếu key từng lên Git, nên revoke và làm sạch lịch sử Git theo khuyến nghị của trường/dự án.
- **`429 RESOURCE_EXHAUSTED` … `free_tier_requests … limit: 5`**: gói miễn phí chỉ có vài **request/phút** cho một model mỗi khi có nhiều lượt `generate_content` (một metric có thể gọi API nhiều lần nội bộ). Giảm tải: **chạy ít testcase** trong JSON tạm; **chờ 1–2 phút** rồi chạy lại; hoặc dùng tham số **nghỉ giữa các case** để không vượt RPM:
  ```powershell
  python run_rag_eval.py triad --delay-after-case 15 --output .\results\triad_slow.json
  ```
  Hoặc đặt biến môi trường `EVAL_DELAY_AFTER_CASE_SECONDS=15` trong `.env`. Nếu cần đánh giá nặng/thường xuyên, bật **billing** và xem quota tại [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).
- **File JSON báo `summary` toàn `null`** khi các metric **`score`: `null`** và có **`error`**: đó không phải là “pipeline RAG tệ”, mà là **LLM judge chưa gọi Gemini thành công**. Sửa 403/429 trước; khi thành công bạn sẽ thấy `score` từ 0.0 đến 1.0 và `reason` mô tả ngắn.
- **Hiển thị tiếng Việt lỗi trên terminal Windows**: trong PowerShell thử `$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::UTF8`; hoặc mở file JSON trong Cursor/VS Code.

---

## English summary

Same folder level as `be` and `fe`. Create `.venv`, `pip install -r requirements.txt`, copy `.env.example` → `.env` with Gemini key.

```bash
python run_rag_eval.py triad --output ./results/triad_latest.json
python run_rag_eval.py split --output ./results/split_latest.json
```

Read summaries in stdout and full scores/reasons in the output JSON under `cases[].metrics`.
