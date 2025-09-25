# zoraxy-webserver-indexer

A modern auto-index and admin service for the Zoraxy Static Webserver. It generates a stylish `index.html` listing subfolders and provides a hidden/admin UI for cloning Git repos, uploading ZIPs, editing files, and auto-pulling updates. Easy systemd installation.

This project assumes you use Zoraxy or another reverse-proxy/static-server to serve the static webroot. The admin backend runs on `127.0.0.1:PORT` and must be proxied from `/admin/` by Zoraxy (or nginx). See the **Proxy** notes below.

---

## What it contains

- `setup.sh` — interactive installer. Copies files, writes `.env`, installs npm deps, sets permissions, writes systemd units, and enables them.
- `admin-server.js` — small Express backend (list/clone/upload/edit files, auto `git pull`).
- `generate-index.js` — single-run index generator; intended to be triggered by a systemd timer every N seconds (installer creates the timer).
- Systemd unit templates — installer writes real units with absolute paths.

---

## Key features

- Auto-generate a modern `index.html` listing all directories in your Zoraxy webroot.
- Hidden admin UI that is **served only after a password** is submitted.
- Admin features: clone GitHub repos (HTTPS), upload ZIPs, browse & edit files.
- Auto `git pull` for all repos (runs on server start and every 10 minutes).
- Fully automated install with `setup.sh` that writes systemd units pointing to absolute paths.

---

## Quick install (recommended)

1. Clone this repo onto your server:

    ```bash
    git clone <this-repo-url>
    cd zoraxy-webmanager
    ```

2. Make the installer executable and run it (it will ask questions):

    ```bash
    chmod +x setup.sh
    sudo ./setup.sh
    ```

    The installer will:

    - Ask for your Zoraxy webroot, admin directory, port, and whether to auto-generate a strong password.
    - Copy `admin-server.js` and `generate-index.js` into the admin dir.
    - Create `admin-dir/.env` with `ADMIN_PASSWORD`, `ADMIN_PORT`, `ZORAXY_DIR`.
    - Install Node dependencies (as your user).
    - Create systemd services (backend + timer) with absolute paths.
    - Enable & start the services.

3. Configure Zoraxy to proxy `/admin/` to `http://127.0.0.1:<ADMIN_PORT>/admin/`. This keeps the admin UI hidden unless the password is provided. For nginx users, a location block example:

    ```nginx
    location /admin/ {
        proxy_pass http://127.0.0.1:3000/admin/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;
    }
    ```

### Manual install (if you prefer not to run the script)

1. Copy `admin-server.js` and `generate-index.js` to the directory you want (e.g., `/srv/zoraxy-admin`).

2. Create `.env` next to the scripts:

    ```bash
    ADMIN_PORT=3000
    ADMIN_PASSWORD=yourpassword
    ZORAXY_DIR=/path/to/your/webroot
    FRONTEND_ADMIN_URL=/admin
    GEN_INTERVAL=10
    ```

3. Run the following commands:

    ```bash
    cd /srv/zoraxy-admin && npm init -y && npm install express multer unzipper simple-git dotenv fs-extra
    ```

4. Create systemd units (see templates) and adjust `<path-to-node>`, `<ADMIN_DIR>`, and `<user>`.

5. Reload systemd:

    ```bash
    sudo systemctl daemon-reload
    ```

6. Enable & start:

    ```bash
    sudo systemctl enable --now zoraxy-webadmin.service
    sudo systemctl enable --now zoraxy-generate-index.timer
    ```

---

## Security notes & best practices

- Backend listens only on `127.0.0.1`. Always proxy `/admin/` from your reverse proxy (Zoraxy, nginx) so the admin UI is accessible via your site domain but still routed to localhost.
- Keep `ADMIN_PASSWORD` secret. Consider additional auth (HTTP basic auth at the proxy) and HTTPS when exposing admin remotely.
- Uploaded ZIPs are extracted as-is — do not accept files from untrusted users.
- Timer interval: default 10s is aggressive — consider 30s–60s in production.

---

## How it works (short)

1. `generate-index.js` runs (by systemd timer) and writes `index.html` into your webroot. The index lists all directories and shows an "Unlock admin" button.
2. Clicking "Unlock" opens a prompt: the password is POSTed to `/admin/login` (proxied by Zoraxy). On success, the backend returns admin UI HTML; the browser opens it in a new tab.
3. The admin UI uses `x-admin-password` header for subsequent API calls (`/admin/clone`, `/admin/files`, etc.).
4. The backend auto-pulls git repos every 10 minutes and on start.

---

## References & reading

- Zoraxy docs & getting-started — Zoraxy provides an internal static web server and proxy features (we rely on proxied `/admin/` to our backend).  
    [Zoraxy docs](https://zoraxy.com/docs)
  
- Reverse-proxy / proxy_pass patterns (nginx docs). If you use nginx instead of Zoraxy's UI, the proxy_pass pattern is the same.  
    [nginx docs](https://docs.nginx.com)

---

## Contributing

- Open issues and PRs for improvements: nicer admin UI, permission options, auth tokens, or moving admin UI into a SPA.
- If you want a GitHub-ready repo, I can prepare `README.md`, `.gitignore`, license, and a deploy script.

---

## Final note

This package puts powerful actions (clone, write files) behind a password and localhost-only backend. Please keep the password safe and consider adding proxy-level protections if you will access admin from the public Internet.

---

## Citations for the important assumptions I used

- Zoraxy can act as a reverse proxy and includes an internal static web server — read the Zoraxy getting-started & articles.  
- Use a reverse-proxy pattern (proxy `/admin/` to `127.0.0.1:PORT`) to keep the admin backend local — same pattern used with nginx/other proxies.
