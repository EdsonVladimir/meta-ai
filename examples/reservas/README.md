# Reservas

A small room-booking app. It is a demo target for Ruth: the IDE opens
this project to show the architecture map and the Code X-ray, and the
demo asks Muse to add a user-registration feature that does not exist
here yet.

## Layout

- `backend/` — NestJS + TypeORM API (SQLite). Serves `GET /reservas`
  and `POST /reservas` with no path prefix.
- `frontend/` — Angular standalone UI with signals. The store keeps
  the bookings in a `signal` with a `computed` count, and the service
  calls the API through `HttpClient`.

## Run

```sh
cd backend && npm install && npm start
cd frontend && npm install && npm start
```

The API listens on `http://localhost:3000`, which matches
`environment.apiUrl` in the frontend.
