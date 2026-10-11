# FORMA

An authentication product with its own visual identity: registration, sign-in, a protected dashboard, and the states in between. Built with plain HTML, CSS and JavaScript on the front end, and Node.js, Express, SQLite, bcrypt and express-session on the back end. No React, no Next.js, no templates.

## The idea

*Forma* means shape. FORMA treats a form as a sentence you finish, and finishing it builds a shape.

- **The form is the headline.** Fields are set as large display type in a sentence: *"I go by ___, reach me at ___, I'll lock it with ___."* Every input still has a real, visible `<label>`; the sentence fragment is the label.
- **The mark.** A 2×2 grid of geometric primitives (circle, square, triangle, quarter-circle, half-circle) in three pigment colours. While you register, each valid answer stamps one cell into place. All four shapes are derived deterministically from your username, so the mark you assemble is the same mark the dashboard shows afterwards. It is also the loading indicator (the four slots pulse in turn), the error indicator (the slots turn red), and the success state (the mark completes).
- **The rail.** The wordmark runs vertically in a solid ink band and is allowed to be cropped by the edge of it. It is the page's one loud element; everything else is quiet. On phones the band lies down across the top.
- **The dashboard stays in the language.** Your username is the headline, set very large. Below it is a ledger of rules and labels, not cards: your account details, the devices you're signed in on (each can be signed out from here), and a change-password form written as a sentence ("Replace ___ with ___"). There are no statistics, because there is nothing honest to count.

### Why this direction

Three concepts were considered: a type-specimen sheet (strong but cramped inputs), a blueprint/drafting layout (coherent, but a familiar trope that turns the dashboard into a CAD panel), and this one. This one won on originality (the form *is* the composition), usability (plain labelled inputs that reflow naturally), and portfolio impact (one idea carried through every screen).

### Tokens

| | |
|---|---|
| Paper | `#E9ECEA` cool grey-green ground; deliberately not white or cream |
| Ink | `#10302C` bottle green for type, rules and the rail |
| Sun / Cobalt / Coral | `#F2B600` / `#2540D9` / `#E8472B`, used inside the mark. Cobalt is also the focus colour |
| Error | `#B3261E`, darker than coral so small text keeps its contrast |
| Display type | Anybody (variable width), run extra-wide for the wordmark |
| Text type | Instrument Sans |

## Setup

Requires Node.js 18 or newer.

```bash
npm install
cp .env.example .env
npm run secret        # prints a random value; paste it into .env as SESSION_SECRET
npm start             # http://localhost:3000
```

`npm run dev` restarts on file changes. `npm test` runs the integration suite.

`better-sqlite3` and `bcrypt` are native modules. Both ship prebuilt binaries for current Node versions; if your platform needs a build step you will need a C++ toolchain and Python.

### Configuration

All configuration is by environment variable (see `.env.example`).

| Variable | Default | Purpose |
|---|---|---|
| `SESSION_SECRET` | none (required in production) | Signs the session cookie. 32+ characters. The server refuses to start in production without it |
| `PORT` | `3000` | |
| `NODE_ENV` | `development` | `production` turns on Secure cookies and HSTS |
| `DATABASE_PATH` | `./data/forma.db` | SQLite file |
| `SESSION_TTL_HOURS` | `168` | Session lifetime |
| `BCRYPT_ROUNDS` | `12` | bcrypt cost factor |
| `COOKIE_SECURE` | `true` in production | Override the Secure flag |
| `TRUST_PROXY` | `false` | Set `true` behind a proxy that terminates HTTPS, otherwise Secure cookies are not set |
| `RATE_LIMIT_MAX` | `10` | Attempts per IP per 15 minutes on auth endpoints |

## Project structure

```
forma/
├── src/
│   ├── server.js            App factory, security headers, session, routing
│   ├── config.js            Environment variables → config
│   ├── db.js                SQLite connection and schema
│   ├── sessionStore.js      express-session store backed by SQLite
│   ├── validate.js          Server-side validation rules
│   ├── util.js              Session id handles, user-agent parsing
│   ├── middleware/
│   │   └── security.js      CSRF, origin check, auth guards
│   └── routes/
│       ├── auth.js          /api: register, login, logout, me, sessions, password
│       └── pages.js         /, /login, /register, /dashboard
├── views/                   Static HTML: register, login, dashboard, 404
├── public/
│   ├── css/forma.css        The whole design system
│   └── js/
│       ├── mark.js          The mark: deterministic shape generator
│       ├── api.js           fetch wrapper with CSRF handling
│       ├── validators.js    Client-side mirror of the server rules
│       ├── ui.js            Shared DOM helpers
│       ├── register.js      login.js    dashboard.js
├── scripts/generate-secret.js
└── test/auth.test.js
```

## Security

| Requirement | How it is met |
|---|---|
| Password rules | 8+ characters and at least one number, enforced in `src/validate.js`. The browser repeats the check for speed; the server never trusts it. Passwords over 72 bytes are rejected because bcrypt ignores everything past that |
| Hashing | bcrypt, cost 12 by default. Only the hash is stored |
| Unique username and email | `UNIQUE` columns with `COLLATE NOCASE`, plus a friendly pre-check. The database constraint is the real guarantee and also catches two people registering the same name at once |
| Login by username or email | One query matches either column, case-insensitively |
| Generic credential errors | A wrong password and an unknown account return the identical status and message. When the account does not exist, a bcrypt comparison against a dummy hash still runs so response time does not reveal which case it was |
| Server-side sessions | express-session with a SQLite store. The browser holds only a signed random id; no user data is in the cookie |
| Session fixation | The session id is regenerated on sign-in and registration |
| Cookies | `HttpOnly`, `SameSite=Lax`, `Secure` in production, 7-day lifetime |
| CSRF | Three layers: SameSite cookies; an `Origin` header check on every state-changing request; and a per-session synchroniser token that must be sent in an `X-CSRF-Token` header (a header a cross-site form cannot set) |
| Logout | The session row is deleted on the server and the cookie cleared. Replaying the old cookie fails (covered by a test) |
| Protected dashboard | `/dashboard` redirects guests to `/login`; every `/api` data route returns 401 without a session |
| SQL injection | Every query is a prepared statement with bound parameters. There is no string-built SQL |
| XSS | A strict Content-Security-Policy (`script-src 'self'`, no inline script or style), and all user-supplied text is inserted with `textContent` |
| Brute force | `express-rate-limit` on register, login and password change. Only failed logins count |
| Secrets | Read from environment variables; `.env` is git-ignored; production refuses to start with a missing or weak secret |
| Other headers | `helmet`: HSTS in production, `frame-ancestors 'none'`, `nosniff`, and others. API responses are `no-store` |

### Known trade-offs

- Registration tells you when a username or email is already taken. That is what makes "unique usernames" usable, but it does let someone test whether an email has an account. The login form does not leak this.
- There is no email verification or password-reset flow. Both need outbound email and are out of scope here.
- Fonts load from Google Fonts. To self-host, download Anybody and Instrument Sans, add `@font-face` rules to `forma.css`, and remove the two Google hosts from the CSP in `src/server.js`.

## API

All routes are JSON. State-changing requests need an `X-CSRF-Token` header; get the token from `GET /api/csrf`. The front end handles this in `public/js/api.js`.

| Method and path | Auth | Purpose |
|---|---|---|
| `GET /api/csrf` | none | Returns the session's CSRF token |
| `POST /api/register` | none | `{username, email, password, confirm}`. 201, 400 (field errors) or 409 (taken) |
| `POST /api/login` | none | `{identifier, password}`. 200, 400 or 401 |
| `POST /api/logout` | any | Destroys the session |
| `GET /api/me` | yes | Username, email, join date |
| `GET /api/sessions` | yes | Devices signed in, with the current one marked |
| `DELETE /api/sessions/:id` | yes | Sign one other device out |
| `DELETE /api/sessions` | yes | Sign every other device out |
| `POST /api/password` | yes | `{current, next, confirm}`. Signs other devices out |

## States and accessibility

- **Loading:** the button changes its label ("Opening…") and is disabled; the mark's four slots pulse in turn.
- **Validation:** errors appear after you leave a field, then clear as you fix them. On submit, focus moves to the first problem and a summary says how many. Errors are text, never colour alone; the password rules show filled or empty markers plus hidden "Done" / "Still needed" text for screen readers.
- **Server errors:** field errors (taken username, wrong current password) land on the field; everything else (network, rate limit, 500) appears in a message above the button.
- **Success:** the form is replaced by a confirmation, focus moves to it, the mark completes, and you're taken to the dashboard.
- Keyboard focus is always visible (cobalt, 3px). A skip link is provided. `prefers-reduced-motion` turns off every animation. Touch targets are at least 44px. Layouts were checked at 1440px, 800px and 390px.

## Tests

`npm test` starts the real app against an in-memory SQLite database and covers: registration and validation, case-insensitive uniqueness, login by username and email, identical errors for wrong password and unknown user, SQL-injection strings, session id rotation, rate limiting, CSRF token and Origin rejection, guest redirect, server-side logout (including cookie replay), device listing and revocation, password change, and security headers.
