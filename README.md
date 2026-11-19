# Chat With Data

A document workspace with in-browser retrieval, source inspection and spreadsheet analysis. The hosted site processes uploaded data in the browser. The local edition can also generate answers using an installed Ollama model. Uploads and conversations are kept in tab memory. Refreshing or closing the tab clears them.

## Start on a Mac

1. Install Node.js 22 or later.
2. From the extracted folder, run `node local-server.mjs`.
3. Open `http://127.0.0.1:8700`.

### Enable local generated answers

Install Ollama from its official site. Run `OLLAMA_NO_CLOUD=1 ollama serve` in Terminal. If the Ollama desktop app already owns port 11434, quit it before starting the terminal server. In a second Terminal window, download the pretrained model with `ollama pull qwen3:4b`, then start RAG AI with `RAG_AI_MODEL=qwen3:4b node local-server.mjs`. Refresh after starting. The privacy menu displays the installed model and lets you disable it for the current tab. An installation and model download require network access. The running application sends selected excerpts only to the loopback Ollama service when the model is enabled.

## Run the regression tests

Run `node --test` from the project folder. The tests cover conflicting notice periods, insufficient evidence, source diversity, Hindi notice questions, incomplete rows, period and currency checks, pricing, upload parsing and large-source retrieval.

## Files and calculations

Use PDF with selectable text, DOCX, XLSX, PPTX, CSV, TSV, JSON, TXT, Markdown, HTML or LOG files. The file picker supports batch uploads and the folder picker keeps relative file paths. Limits are 20 MB per file, 80 MB combined, 30 sources and 150,010 sections in a tab. Legacy binary Office files, images and OCR are outside the current format support. Workbooks use stored formula values. Convert currencies and include all relevant costs before calculating. Profit and loss are calculated per source table. The analysis checks symbols against explicit currency codes. Profit questions can scope results to explicit quarter, month and year labels in source names, sheet names or period columns. Fiscal quarters require explicit labels. Expected pricing is a scenario calculation from user-entered inputs.

The hosted edition retrieves and cites source excerpts, flags contradictory numeric notice durations, and directly answers straightforward notice-duration questions. Hindi/English matching covers common business and notice terms. The app reports insufficient evidence when retrieval cannot find a strong match. The local model can compose an answer from those excerpts and return references. Source links identify the originating section. Generated claims require review against the cited wording. Retrieval can miss paraphrases and multilingual matches. The model is pretrained and no uploaded files are used for training.

The private hosted link is owner-only. Institutional deployment with organization SSO, roles, cross-tenant isolation tests, retention policies and independent accuracy evaluations requires the organization’s environment. The local server listens only on loopback.

Transaction CSV tables support up to 100,000 data rows and 1.5 million cells within the file-size limit. Filtered profit rankings use signed revenue and cost, explicit period labels, region, channel and status. Combined results check matching transaction IDs and currency.

## PDF question answering

Choose a PDF in **Search in**, or leave **All sources** selected. Ask about a topic, section, or page range. The workspace searches readable PDF text and shows the pages that matched.

Select **Enable AI** to use the on-device language model in a compatible desktop Chrome browser. The local edition also supports Ollama when configured as described above. The model receives at most eight selected passages per question. It must cite exact quotes from those passages. The workspace checks the quote text and page references before displaying an answer. Check whether the excerpt supports the model's interpretation.

Image-only scans need a searchable text layer from OCR. When the model is unavailable, the workspace shows searchable excerpts.

## Financial reports

Upload a searchable annual report, income statement, balance sheet, or cash-flow statement. Use **Search in** to select a report. Try asking for revenue growth between two years, gross or net margin, the current ratio, or operating cash flow. Supported calculations use recognized row labels and explicit year columns and cite the original page or table row. Broader questions about management commentary, risks, and accounting notes use PDF retrieval and the optional local model. Image-only PDFs need a searchable OCR layer. Ambiguous figures and incompatible units require clarification.
