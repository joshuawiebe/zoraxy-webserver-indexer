# Zoraxy WebManager

Zoraxy WebManager is an extension for the [Zoraxy](https://github.com/tobychui/zoraxy) static web server.  
It provides an auto-updating **index page**, an **admin panel** for managing Git repos and uploads, and a **file explorer/editor** for quick changes to your hosted sites.

---

## ✨ Features

- 🔄 **Auto index generator**: Systemd timer regenerates `index.html` every few seconds.
- 🖥️ **Admin backend (Node.js)**:
  - Git **clone** repos directly into Zoraxy webroot
  - Upload and extract ZIP archives
  - Run `git pull` on all repos with one click
  - Browse directories (file explorer)
  - Edit or delete files with syntax highlighting
- 🔐 **Password-protected admin area**:
  - Login required
  - Admin HTML is only sent after successful login
  - Password can be auto-generated with OpenSSL
- ⚡ **Systemd services & timer**:
  - `zoraxy-webadmin.service` → runs the backend
  - `zoraxy-generate-index.service` + `.timer` → regenerates index automatically

---

## 📂 Project Structure

```bash
.
├── admin-server.js       # Admin backend (Express, CommonJS)
├── generate-index.js     # Index generator (runs via systemd timer)
├── admin.html            # Admin frontend (loaded after login)
├── setup.sh              # Interactive installer
├── README.md             # Documentation
└── LICENSE               # MIT License
````

---

## 🚀 Installation

> **Requirements**
>
> - Node.js (v16+ recommended)
> - Zoraxy installed and serving a static webroot
> - Systemd (Linux only)

### 1. Clone this repository

```bash
git clone https://github.com/yourname/zoraxy-webmanager.git
cd zoraxy-webmanager
```

### 2. Run the installer

```bash
chmod +x setup.sh
sudo ./setup.sh
```

The script will:

- Ask for your Zoraxy webroot (default: `~/zoraxy/config/www/html`)
- Ask for your admin directory (where backend will live)
- Ask for backend port (default: `3000`, only listens on `127.0.0.1`)
- Ask for index generator interval (default: `10` seconds)
- Ask for admin password (or auto-generate with OpenSSL)
- Install required npm packages
- Write `.env` file
- Install and enable systemd services

---

### 🔧 Manual setup (without script)

If you don’t want to use `setup.sh`:

1. Copy `admin-server.js`, `generate-index.js`, and `admin.html` to your admin directory.
2. Install npm packages:

    ```bash
    npm install express multer unzipper simple-git dotenv fs-extra
    ```

3. Create a `.env` file:

    ```env
    ADMIN_PORT=3000
    ADMIN_PASSWORD=your-secret
    ZORAXY_DIR=/home/user/zoraxy/config/www/html
    FRONTEND_ADMIN_URL=/admin
    GEN_INTERVAL=10
    ```

4. Write systemd unit files for `zoraxy-webadmin` and `zoraxy-generate-index`.
5. Enable/start with:

```bash
sudo systemctl enable --now zoraxy-webadmin
sudo systemctl enable --now zoraxy-generate-index.timer
```

---

### 🔒 Security

- The backend only listens on `127.0.0.1` (loopback).
- Use Zoraxy (or Nginx/Traefik) to reverse proxy `/admin/` to `http://127.0.0.1:PORT/admin/`.
- Always use HTTPS externally.
- Password is stored in `.env` (chmod `600`).

---

## 🖱️ Usage

1. Go to your domain and open `/admin`.
2. Enter the admin password.
3. Use the interface to:

   - Clone repos
   - Upload ZIPs
   - Browse/edit files
   - Pull all repos
4. Check logs:

```bash
sudo journalctl -u zoraxy-webadmin -f
sudo journalctl -u zoraxy-generate-index.timer -f
```

---

## 🤝 Contributing

- Fork this repo
- Create a new branch: `git checkout -b feature-name`
- Commit changes: `git commit -m "Add feature"`
- Push and open a PR

---

## 📜 License

MIT License – see LICENSE

---

## 🙌 Credits

- Zoraxy by Toby Chui
- Inspired by the need for a simple self-hosted Git + static hosting manager
