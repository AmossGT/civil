# OpenTender

A mobile-first tender transparency portal and FastAPI backend built from the supplied architecture. The existing UI is served by the API and uses live database records.

## Start locally

1. Install Docker Desktop and Python 3.11 or newer.
2. Start PostgreSQL/PostGIS: `docker compose up -d db`.
3. Create a virtual environment and install `backend/requirements.txt`.
4. Copy `.env.example` to `.env`; set a strong `SECRET_KEY` and bootstrap admin password.
5. From the repository root run `uvicorn backend.app.main:app --reload --port 8000`.
6. Open `http://localhost:8000/` for the portal and `http://localhost:8000/docs` for API docs.

The API creates the PostGIS extension and tables at startup. The bootstrap admin is created only if its configured email is not registered. Admins can provision officer accounts with `POST /api/v1/users`.

## Connected features

- Public search, department/status/value filters, pagination, tender details, contacts, award records, and work-order download
- Live headline metrics, public activity, geospatial map pins, and opt-in nearby search
- HttpOnly signed sessions, password hashing, role checks, and officer department isolation
- Officer workspace for draft creation, PDF upload, submission, and award entry
- Admin review queue for tender and award verification or rejection
- Department, officer, contractor and user management, audit history, and CSV import

Tender records include an additive `extra_data` JSON object for future structured attributes. The current page ignores keys it does not know, while API clients can preserve and consume them. Future sensitive or internal fields should be added to explicit schemas rather than exposing them through that public extension object.

CSV imports require `tender_ref,department_id,title,estimated_value`; optional columns are `description,bid_open_date,bid_close_date,latitude,longitude,location_label`. Imported tenders start as drafts.

Production deployment should use HTTPS (`COOKIE_SECURE=true`), a strong secret, exact CORS origins, persistent file storage, request rate limiting, and database/upload backups.
