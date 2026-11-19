# Chat With Data

**Analyze financial reports and spreadsheets with source-cited answers, year-over-year comparisons, and profit and margin calculations.**

Upload annual reports, income statements, balance sheets, cash-flow statements, or spreadsheets. Ask a question in plain language, check the calculation, and open the PDF page or spreadsheet row behind the answer.

[Hosted workspace](https://rag-ai-workspace.tinklingowl16.chatgpt.site/) · [Run locally](#run-locally) · [What you can ask](#what-you-can-ask)

The hosted workspace requires owner access. Anyone with the repository can run the local edition.

## What you can ask

| Question | What the workspace returns |
| --- | --- |
| How much did revenue grow from 2024 to 2025? | Reported figures for both years, the absolute and percentage change, and citations. |
| What was the net margin or current ratio in 2025? | A calculation using recognized line items and their source references. |
| Why did management say revenue changed? | Relevant PDF excerpts. With a compatible model enabled, a written answer with citations. |
| Which products were profitable or losing money? | Profit and loss by product for supported transaction tables, with links to the source. |

Try **Try with sample data** in the workspace to explore the transaction workflow. For report-specific questions, upload a searchable financial PDF or a spreadsheet with labeled reporting years, then select it under **Search in**.

## Run locally

Requires **Node.js 22 or later**.

```sh
git clone https://github.com/preeteshchoudhary/chat-with-data.git
cd chat-with-data
node local-server.mjs
```

Open [http://127.0.0.1:8700](http://127.0.0.1:8700). Document search and supported calculations work as soon as the server starts.

### Enable AI-written answers

In a compatible desktop Chrome browser, select **Enable AI** to use the browser’s on-device model. The local edition also supports Ollama.

1. Install Ollama and start its local service. For a terminal-managed instance, use `OLLAMA_NO_CLOUD=1 ollama serve`.
2. In a separate terminal, download the model and start the workspace.

   ```sh
   ollama pull qwen3:4b
   RAG_AI_MODEL=qwen3:4b node local-server.mjs
   ```

## How it works

1. **Read the source.** The browser extracts document text and recognizes supported financial tables.
2. **Find the answer.** Questions are routed to document retrieval or to deterministic report and transaction calculations.
3. **Show the evidence.** Answers link to pages or rows. For model-written replies, the app checks that quoted text exists in the source. Review the cited passage to confirm the interpretation.

| Part | Implementation |
| --- | --- |
| Workspace | HTML, CSS, and JavaScript |
| Document parsing | PDF.js for PDFs and JSZip for modern Office files |
| Calculations | JavaScript functions for report comparisons, ratios, and transaction analysis |
| Optional generation | Chrome on-device AI or a local Ollama model |
| Local server and tests | Node.js |

## File support and limits

- **Formats** include searchable PDF, DOCX, XLSX, PPTX, CSV, TSV, JSON, TXT, Markdown, HTML, and LOG.
- **Upload limits** are 20 MB per file, 80 MB combined, and 30 sources per tab. Transaction CSVs support up to 100,000 data rows and 1.5 million cells within those limits.
- **Report layouts** need recognizable line items and labeled years for automatic calculations. Image-only PDFs need an OCR text layer. XLSX analysis uses stored formula values.
- **Privacy** comes from browser-side processing and tab memory. Closing or refreshing the tab clears the session. If enabled, the local Ollama integration sends selected excerpts to the loopback service.

## Tests

```sh
node --test
```

The regression suite covers PDF retrieval and quote validation, report calculations and ambiguous figures, conflicting evidence, currency and period checks, and filtered profitability at scale.
