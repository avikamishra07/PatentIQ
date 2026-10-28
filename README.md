# PatentIQ — run locally

Requirements: **Python 3.11–3.13** and **Node.js 20 LTS or newer** (Vite 5 needs Node 18+/20+).
Keep the project in a short, local, non-synced folder such as `C:\PatentIQ` (not OneDrive / Desktop / a network drive).

## Windows CMD — quick start

Open **Command Prompt** (not PowerShell) in the project root, i.e. the folder containing `backend` and `frontend`:

    cd C:\PatentIQ
    setup-windows.bat          (one time: creates backend\venv, installs Python packages, clean `npm ci`)
    run-backend.bat            (window 1 -> http://localhost:8000)
    run-frontend.bat           (window 2 -> http://localhost:5173)

Then open http://localhost:5173. The first backend start builds the similarity index
(about 40 s – 2 min); the app shows "index still building" and retries automatically. Later starts reuse
`backend\cache`. Check it: http://localhost:8000/health returns `{"status":"ok","classes":16}`.

Run all checks: `run-tests.bat` (pytest + vitest + production build).

### The same thing by hand
    cd C:\PatentIQ\backend
    python -m venv venv
    venv\Scripts\activate
    pip install -r requirements-dev.txt
    python -m uvicorn main:app --host 127.0.0.1 --port 8000
    :: second CMD window
    cd C:\PatentIQ\frontend
    copy .env.example .env
    npm ci
    npm run dev
    :: tests
    cd C:\PatentIQ\backend && venv\Scripts\activate && python -m pytest tests -q
    cd C:\PatentIQ\frontend && npm test && npm run build

(macOS/Linux: same steps with `source venv/bin/activate` and `cp`.) Do not use `--reload` with this
dataset; it would reload the 751k-row index on every file save.

## Troubleshooting

**scikit-learn 1.8.0 vs 1.9.1 warning** — `model\*.joblib` were saved with scikit-learn **1.8.0**, so
`requirements.txt` now pins `scikit-learn==1.8.0`. If you already have 1.9.1: `pip install scikit-learn==1.8.0`.
(Checked: 1.9.1 gives identical predictions on 5,000 real titles, so nothing is broken, but 1.8.0 removes the
warning. The backend prints a notice at startup if the versions differ.)

**npm: DNS / ENOTFOUND / EAI_AGAIN / ETIMEDOUT** — your machine cannot reach the npm registry. Check
`nslookup registry.npmjs.org`, then `npm config get registry` (should be https://registry.npmjs.org/ unless your
company uses a mirror) and, behind a proxy, `npm config set proxy http://host:port` and
`npm config set https-proxy http://host:port`. Try another network / disable VPN. `frontend\.npmrc` already adds retries
and longer timeouts. Offline machines need a copy of `node_modules` made on a connected PC with the same OS.

**npm: EPERM / EBUSY / "operation not permitted"** — something has files in `node_modules` open. Stop `npm run dev`,
close VS Code terminals and file explorers, pause OneDrive sync, and add the project folder to the Windows Defender /
antivirus exclusions. Then run `setup-windows.bat` again (it deletes `node_modules` first). Never run npm from
a OneDrive folder; do not use an Administrator prompt unless the folder requires it.

**npm: corrupted / ERR_INVALID_ARG / integrity checksum / "Cannot find module"** —
    cd frontend
    rmdir /s /q node_modules
    npm cache clean --force
    npm ci

**"'vite' is not recognized"** — the install did not finish, so Vite was never placed in `node_modules\.bin`. Fix the
install error above and re-run `npm ci`; do not run `npx vite` (it tries to download a different version).
Use `npm ci` rather than `npm install` so the exact versions in `package-lock.json` are used.

**Browser says "Cannot reach the PatentIQ API"** — start `run-backend.bat` first. If your browser resolves
`localhost` oddly, set `VITE_API_BASE_URL=http://127.0.0.1:8000` in `frontend\.env` and restart `npm run dev`.

**Port already in use** — `netstat -ano | findstr :8000`, then `taskkill /PID <pid> /F`.

## Frontend notes
The backend address comes from `VITE_API_BASE_URL` (see `frontend/.env.example`); restart `npm run dev` after
changing it. The UI has eight sections: Dashboard, Classify, Similar patents, Suggestions, Dataset explorer,
Analytics, Reports and System status. All data comes from the API; there is no built-in or fallback data. If the
backend is unreachable, each section shows an error with a "Try again" button.

## Analytics endpoints (used by the Analytics and Dashboard screens)

backend/analytics.py adds three read-only routes on top of the existing
dataset_stats.json — pure arithmetic on real numbers, no new data, no
frontend changes:

    GET /analytics/grant-rate          granted ÷ published, by field and city
    GET /analytics/application-types   filing-type mix with plain-language labels
    GET /analytics/insights            5 short factual sentences from real totals

Try them once the backend is running:
    curl http://localhost:8000/analytics/grant-rate
    curl http://localhost:8000/analytics/application-types
    curl http://localhost:8000/analytics/insights

Note on grant-rate: published and granted counts are different filing
cohorts (a patent granted now may have been filed years before the
published-application snapshot), so a handful of small fields show a
rate over 100%. The endpoint returns a "note" field explaining this —
treat it as an activity ratio, not a literal approval percentage.



## Dataset, similarity and report endpoints

    GET  /dataset/stats        statistics computed from the 751,100-record combined dataset
    GET  /patents/search       filter + paginate patent metadata
    POST /similarity/search    title-overlap similar-patent search with per-match explanation
    GET  /similarity/status    index state (not_started | building | ready | failed)
    GET  /similarity/filters   allowed field / status / office values
    POST /report/generate      structured report for an invention title

The similarity index is built in a background thread at startup and cached on
disk under backend/cache/ (first build is slow; later starts load the cache).
While it is building, /similarity/search returns 503 + Retry-After; all other
endpoints keep working. Set PATENTIQ_SIMILARITY_AUTOSTART=0 to build lazily on
the first similarity request instead.

    curl -X POST http://localhost:8000/similarity/search \
         -H "Content-Type: application/json" \
         -d '{"description": "solar powered water pump for irrigation", "top_k": 5}'

Scores are TITLE-ONLY word-overlap similarity. They are not a novelty,
prior-art or patentability assessment.

## Tests
    cd backend
    pip install -r requirements-dev.txt
    python -m pytest tests -v
    # engine tests only, no FastAPI needed:
    python -m unittest discover -s tests -p "test_similarity_engine.py" -v

See PHASE3_HANDOFF.md for project status.


## Personalized suggestions

    POST /suggestions/search   ranked patent records for an invention idea

Body: `description` (required, 1–2000 chars) plus optional `top_k` (1–30, default 10),
`min_score`, `max_per_title` (default 2), and the filters the dataset really has:
`field`, `status`, `office`, `year_from`, `year_to` (publication year). Allowed filter values
come from `GET /similarity/filters`.

It is a thin layer over the existing similarity index (`similarity_engine.manager`), so scores
are the same title-only TF-IDF overlap — not a novelty or prior-art assessment. Each suggestion
carries title, publication/application numbers, field of invention (the dataset's only
classification), status, office, publication/filing dates, relevance score, matched words/phrases
and reasons built from those matches. Missing values (blank, `NA`, `NaT`) are returned as `null`.
Nothing is stored: description and filters are used only for the request.

## GroqCloud Innovation Assistant (hosted API)

The Personalized Suggestions page includes a conversational Innovation Assistant. The FastAPI backend sends chat requests to GroqCloud; the secret API key remains on the backend and is never sent to React. Patent search continues to use PatentIQ's existing local similarity index. Groq's free-tier access has rate limits and may change; check your GroqCloud console before public use.

### Windows setup

1. Create a GroqCloud account and API key at <https://console.groq.com/keys>.
2. Copy `backend/.env.example` to `backend/.env` and replace the placeholder with your key. Never commit or share `backend/.env`.
3. From `backend/`, install dependencies into your existing virtual environment:

       venv\Scripts\python.exe -m pip install -r requirements.txt

4. Start or restart the backend:

       venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000

5. Check `http://localhost:8000/suggestions/chat/status`. It should say `available: true` when the key is configured. This only confirms the key is present, not that the key/quota has been validated.
6. Start the frontend in another terminal from `frontend/` with `npm run dev`, open the local URL, go to Personalized Suggestions, enter an idea, optionally search matching patents, and then chat.

### Configuration

- `GROQ_API_KEY` is required and must only be set in the backend environment.
- `PATENTIQ_GROQ_MODEL` defaults to `openai/gpt-oss-20b`; change it only to a model currently available in your GroqCloud account.
- Chat conversation history is sent by the browser for follow-up context but is not persisted by PatentIQ. The selected provider processes the submitted conversation and patent context; do not describe unpublished or confidential invention data as fully private. Groq documents that inference data is not retained by default but may be temporarily logged for system reliability/abuse monitoring for up to 30 days unless Zero Data Retention is enabled. See <https://console.groq.com/docs/your-data>.
- Groq free-tier limits are account/model-specific and may be reached; the API will return an error rather than fabricating an answer.
- Protect the public chat endpoint against abuse and quota exhaustion before broad deployment. A single backend API key serves all site visitors unless you add authentication or rate limiting.

Chat answers are brainstorming aids, not novelty, prior-art, or patentability conclusions. The similarity engine compares title-level lexical overlap; the dataset does not contain the full claims/description needed for a legal conclusion.
