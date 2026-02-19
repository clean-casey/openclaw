# RAG Citation Guide (Dashboard + Agents)

This project’s RAG system returns **chunk-level hits**. To cite sources reliably, use the metadata attached to each hit.

## Fields You Can Cite

Every search hit includes:

- `tenant_id` (which tenant the hit belongs to)
- `doc_id` (stable internal document id)
- `filename` (human-friendly label)
- `file_type` (e.g. `pdf`, `txt`, `url`)
- `page_number` (files only; `null` for URL docs)
- `chunk_index` (0-based chunk index within the document)

URL-ingested hits additionally include:

- `source_url` (canonical URL that was fetched)
- `title` (best-effort page title; may be `null`)

## Recommended Citation Formats

### URL Sources (`file_type = "url"`)

Prefer `source_url` as the primary citation.

Example:

```text
Source: neverssl.com (http://neverssl.com), chunk 0, tenant pattern-energy, doc_id 84e32b5b-fec3-4915-9255-11db3ab11801
```

If `title` is present, use it instead of the hostname:

```text
Source: <title> (<source_url>), chunk <chunk_index>, tenant <tenant_id>, doc_id <doc_id>
```

### Uploaded Files (PDF/DOCX/PPTX/TXT, etc.)

Prefer `filename + page_number` when available. Use `chunk_index` for precision and `doc_id` for a stable reference.

Example:

```text
Source: WebOMS Technical Specification.pdf, page 12, chunk 3, tenant clean-incentive, doc_id 5ad9e189-689b-4fa1-82da-e2ca990549d7
```

If `page_number` is `null` (e.g., plain text ingestion), cite by chunk only:

```text
Source: notes.txt, chunk 7, tenant global, doc_id <doc_id>
```

## Where These Fields Come From

- **REST**: `POST /search`
- **MCP tool**: `rag_search`
- **Dashboard**: Documents tab “Search” results are displayed from `rag.search` (gateway RPC → RAG REST `/search`)

## Notes / Limitations

- The RAG search hit `text` is the chunk body; it is not the full document.
- URL pages are extracted from HTML; `title` can be missing.
- Multi-tenant systems: always include `tenant_id` in citations to avoid ambiguity.

