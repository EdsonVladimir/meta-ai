# Bookings

A small room-booking app. It is a demo target for Ruth: the IDE opens
this project to show the architecture map and the Code X-ray, and the
demo asks Muse to add a user-registration feature that does not exist
here yet.

## Layout

- `backend/` — NestJS + TypeORM API (SQLite). Serves `GET /bookings`
  and `POST /bookings` with no path prefix.
- `frontend/` — Angular standalone UI with signals. The store keeps
  the bookings in a `signal` with a `computed` count, and the service
  calls the API through `HttpClient`.

## Run

Backend first (NestJS + SQLite, no external database):

```sh
cd backend
npm install     # first time only; compiles sqlite3, takes a while
npm run typecheck
npm start       # builds, then serves the API
```

`GET http://localhost:3000/bookings` answers `[]` on a fresh
database; the `bookings.db` file is created next to the backend and
is ignored by git. `POST /bookings` with
`{"room": "A1", "date": "2026-11-01", "guests": 2}` stores a row.

Then the frontend (Angular 18 standalone):

```sh
cd frontend
npm install     # first time only
npm run typecheck
npm start       # serves on http://localhost:4200/
```

Open `http://localhost:4200/` in a browser. The API address
matches `environment.apiUrl` in the frontend, so the UI reads the
same data the backend serves.
