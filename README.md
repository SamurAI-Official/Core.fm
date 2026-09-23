<p align="center">
  <img src="https://img.shields.io/badge/🎵-Core.fm-18181b?style=for-the-badge&labelColor=1a1a1a" alt="Core.fm" height="60">
</p>

<h1 align="center">Core.fm</h1>

<p align="center">
  <strong>Local-first AI music studio with cross-market trend intelligence</strong><br>
  <em>Seamless integration with <a href="https://github.com/ace-step/ACE-Step-1.5">ACE-Step 1.5</a> - The Open Source AI Music Generation Model</em>
</p>

<p align="center">
  <a href="https://www.youtube.com/@Ambsd-yy7os">
    <img src="https://img.shields.io/badge/▶_Subscribe-YouTube-FF0000?style=for-the-badge&logo=youtube" alt="Subscribe on YouTube">
  </a>
  <a href="https://x.com/AmbsdOP">
    <img src="https://img.shields.io/badge/Follow-@AmbsdOP-1DA1F2?style=for-the-badge&logo=x&logoColor=white" alt="Follow on X">
  </a>
  <a href="https://webdesignstudio.london">
    <img src="https://img.shields.io/badge/Web_Design-webdesignstudio.london-d4ff00?style=for-the-badge&labelColor=000000" alt="Web Design Studio London">
  </a>
</p>

<p align="center">
  <a href="#-demo">Demo</a> •
  <a href="#-why-ace-step-ui">Why ACE-Step</a> •
  <a href="#-features">Features</a> •
  <a href="#-installation">Installation</a> •
  <a href="#-usage">Usage</a> •
  <a href="#-contributing">Contributing</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/React-18.3-61DAFB?style=flat-square&logo=react" alt="React">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat-square&logo=typescript" alt="TypeScript">
  <img src="https://img.shields.io/badge/TailwindCSS-3.x-06B6D4?style=flat-square&logo=tailwindcss" alt="TailwindCSS">
  <img src="https://img.shields.io/badge/SQLite-Local_First-003B57?style=flat-square&logo=sqlite" alt="SQLite">
  <img src="https://img.shields.io/badge/License-MIT-green?style=flat-square" alt="License">
  <img src="https://img.shields.io/github/stars/fspecii/ace-step-ui?style=flat-square" alt="Stars">
</p>

---

## 🎬 Demo

<p align="center">
  <a href="https://www.youtube.com/watch?v=8zg0Xi36qGc">
    <img src="https://img.shields.io/badge/▶_Watch_Full_Demo-YouTube-FF0000?style=for-the-badge&logo=youtube" alt="Watch Demo on YouTube">
  </a>
</p>

<p align="center">
  <img src="docs/demo.gif" alt="Core.fm - local AI music studio" width="100%">
</p>

<p align="center">
  <em>Generate professional AI music with a Spotify-like interface - 100% free and local</em>
</p>

---

## 🚀 Why Core.fm?

**Core.fm runs entirely on your own GPU.** Generation is powered by [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5) (MIT licensed). On top of it, Core.fm adds the layer that makes generated music useful for actually releasing it: cross-market trend intelligence, market-fit song design, and a rating loop that learns what works in each country.

| Feature | Cloud AI music services | Core.fm |
|---------|-----------|-------------|
| **Cost** | $10-50/month | **FREE forever** |
| **Privacy** | Cloud-based | **100% local** |
| **Ownership** | Licensed | **You own everything** |
| **Customization** | Limited | **Full control** |
| **Queue Limits** | Restricted | **Unlimited** |
| **Commercial Use** | Expensive tiers | **No restrictions** |

### What Makes ACE-Step 1.5 Special?

- **State-of-the-art quality** rivaling commercial services
- **Full song generation** up to 4+ minutes with vocals
- **Runs locally** - no internet required after setup
- **Open source** - inspect, modify, improve
- **Active development** - constant improvements

---

## 🧠 What Core.fm adds: the loop that learns

ACE-Step turns a style prompt into audio. Core.fm is the layer around it that decides *what* to make, and
learns from what you think of it. Three parts, each with its own service on your machine:

| part | what it does | runs on |
|---|---|---|
| **Core.fm** (this repo) | interface, storage, render queue, the dislike button and "try another take" | 3000 / 3001 |
| **The loop** (`signal-aggregator`) | reads the charts, writes briefs, designs songs, learns from every verdict | 3002 |
| **The engine** (ACE-Step 1.5 + patches) | renders and, when asked, trains | 8001 |

**What it does, end to end.** Chart signals for ten markets (`us gb fr de br jp kr cn in ng`) are collected,
enriched and turned into a dated **brief** per market with a stated confidence. A **design** is derived from
that brief - genre, tempo, key, production tags, a one-line premise, lyrics written by one of 21 writing
styles in nine languages, with singability, meter, script and repetition ceilings checked before anything is
rendered. You render it, listen, and judge it.

**Your judgement is the signal.** A **like** or a **hard no**, with optional reasons (*mix*, *vocals*,
*lyrics*, *tempo*, *language*, *not what I asked for*, …) that decide *which part* of the song is blamed. Two
layers act on it:

- **The listener's own profile** moves immediately - a hard no changes what you are offered next, with no
  waiting, no threshold, and it never rewrites the words you typed yourself.
- **A market's weights** move only when `FEEDBACK_MIN_USERS` **distinct** listeners agree, so one person
  cannot reshape a whole market's taste. Untouched opinions decay back toward neutral at 2%/week, and one
  listener can only act so many times a day.
- **"Try another take"** turns a rejection into a different render, changing only what the machine chose.

**Model editions.** The loop can tune the engine on your own verdicts, and adopt a new edition only if it
wins on held-out prompts (a listening test, or a measured spectral comparison) *and* passes the existing
quality gates. The training mix deliberately keeps chart-derived and curated material in it, caps how many
rejections it learns from, and refuses to train when there is too little evidence - which is the state of
this install today (one held-out pair short of the guard, reported rather than papered over).

**Agents are first-class raters.** `GET /api/agent` describes the whole surface as data, and a rater's
verdicts can move market weights without agreement only when it is named in the trust list
(`POST /api/agent/trust`) - a deliberate act with a record, not a launch flag.

---

## 📁 Where the code lives

Everything is in one repository, **[Core.fm](https://github.com/SamurAI-Official/Core.fm)**, on three branches:

| branch | what it is |
|---|---|
| `main` | the app (this README), with the loop vendored in as a git subtree at `signal-aggregator/` |
| `signal-aggregator` | the loop's own history - the same commits, checked out and run separately on 3002 |
| `ace-step-1.5-patches` | the ACE-Step 1.5 engine with our patches on top of upstream |

The engine patches are six small, documented commits (the reason this install must launch with
`--use_flash_attention false` and `--quantization none`, a `lora_status` endpoint, a real unload, and so on).
The engineering record - every measurement, every trap, and what is still open - lives in
[`docs/INSTALL-NOTES.md`](docs/INSTALL-NOTES.md).

---

## ✨ Features

### 🎵 AI Music Generation
| Feature | Description |
|---------|-------------|
| **Full Song Generation** | Create complete songs with vocals and lyrics up to 4+ minutes |
| **Instrumental Mode** | Generate instrumental tracks without vocals |
| **Custom Mode** | Fine-tune BPM, key, time signature, and duration |
| **Style Tags** | Define genre, mood, tempo, and instrumentation |
| **Batch Generation** | Generate multiple variations at once |
| **AI Enhance** | Enrich genre tags into detailed captions with proper BPM/key/time |
| **Thinking Mode** | Let AI reason about structure and generate audio codes |

### 🎨 Advanced Parameters
| Feature | Description |
|---------|-------------|
| **Reference Audio** | Use any audio file as a style reference |
| **Audio Cover** | Transform existing audio with new styles |
| **Repainting** | Regenerate specific sections of a track |
| **Seed Control** | Reproduce exact generations for consistency |
| **Inference Steps** | Control quality vs speed tradeoff |

### 🎤 Lyrics & Prompts
| Feature | Description |
|---------|-------------|
| **Lyrics Editor** | Write and format lyrics with structure tags |
| **Format Assistant** | AI-powered caption and lyrics formatting |
| **Prompt Templates** | Quick-start with genre presets |
| **Reuse Prompts** | Clone settings from any previous generation |

### 🎧 Professional Interface
| Feature | Description |
|---------|-------------|
| **Spotify-Inspired UI** | Clean, modern design with dark/light mode |
| **Bottom Player** | Full-featured player with waveform and progress |
| **Library Management** | Browse, search, and organize all your tracks |
| **Likes & Playlists** | Organize favorites into custom playlists |
| **Real-time Progress** | Live generation progress with queue position |
| **LAN Access** | Use from any device on your local network |

### 🛠️ Built-in Tools
| Feature | Description |
|---------|-------------|
| **Audio Editor** | Trim, fade, and apply effects with AudioMass |
| **Stem Extraction** | Separate vocals, drums, bass, and other with Demucs |
| **Video Generator** | Create music videos with Pexels backgrounds |
| **Gradient Covers** | Beautiful procedural album art (no internet needed) |

---

## 💻 Tech Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React 18, TypeScript, TailwindCSS, Vite |
| **Backend** | Express.js, SQLite, better-sqlite3 |
| **AI Engine** | [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5) (Gradio API) |
| **Audio Tools** | AudioMass, Demucs, FFmpeg |

---

## 📋 Requirements

| Requirement | Specification |
|-------------|---------------|
| **Node.js** | 18 or higher |
| **Python** | 3.10+ (3.11 recommended) OR Windows Portable Package |
| **NVIDIA GPU** | 4GB+ VRAM (works without LLM), 12GB+ recommended (with LLM) |
| **CUDA** | 12.8 (for Windows Portable Package) |
| **FFmpeg** | For audio processing |
| **uv** | Python package manager (recommended for standard install) |

---

## ⚡ Quick Start

### 🎯 Pinokio - 1-Click Install (Recommended for All Users!)

The easiest way to get Core.fm up and running on **any platform** — no terminal, no manual setup:

<p align="center">
  <a href="https://beta.pinokio.co/apps/github-com-cocktailpeanut-ace-step-ui-pinokio">
    <img src="https://img.shields.io/badge/⚡_Install_with_Pinokio-One_Click-ff69b4?style=for-the-badge&labelColor=1a1a1a" alt="Install with Pinokio" height="50">
  </a>
</p>

> **[Pinokio](https://pinokio.computer)** handles everything automatically: Python, Node.js, dependencies, model downloads, and launching. Just click install and start making music.

---

### 🪟 Windows - One-Click Start (Easiest!)
```batch
cd ace-step-ui
start-all.bat
```
**That's it!** This starts everything: API + Backend + Frontend in one command.

> **Note:** By default, it looks for ACE-Step in `..\ACE-Step-1.5`.
> If yours is elsewhere, set `ACESTEP_PATH` first:
> ```batch
> set ACESTEP_PATH=C:\path\to\ACE-Step-1.5
> start-all.bat
> ```

### 🪟 Windows - Manual Start
```batch
REM 1. Start ACE-Step Gradio (with API endpoints)
cd C:\ACE-Step-1.5
python_embeded\python -m acestep --port 8001 --enable-api --backend pt --server-name 127.0.0.1

REM 2. Start Core.fm (in another terminal)
cd ace-step-ui
start.bat
```

### Linux / macOS - One-Click Start (Easiest!)
```bash
cd ace-step-ui
./start-all.sh
```
**That's it!** This starts everything: Gradio + Backend + Frontend in one command.

> **Note:** By default, it looks for ACE-Step in `../ACE-Step-1.5`.
> If yours is elsewhere, set `ACESTEP_PATH` first:
> ```bash
> export ACESTEP_PATH=/path/to/ACE-Step-1.5
> ./start-all.sh
> ```
> **To stop:** `./stop-all.sh`

### Linux / macOS - Manual Start
```bash
# 1. Start ACE-Step Gradio with API (in ACE-Step-1.5 directory)
cd /path/to/ACE-Step-1.5
uv run acestep --port 8001 --enable-api --backend pt --server-name 127.0.0.1

# 2. Start Core.fm (in another terminal)
cd ace-step-ui
./start.sh
```

### Windows (Standard Installation)
```batch
REM 1. Start ACE-Step Gradio with API (in ACE-Step-1.5 directory)
cd C:\path\to\ACE-Step-1.5
uv run acestep --port 8001 --enable-api --backend pt --server-name 127.0.0.1

REM 2. Start Core.fm (in another terminal)
cd ace-step-ui
start.bat
```

Open **http://localhost:3000** and start creating!

---

## 📦 Installation

### 1. Install ACE-Step (The AI Engine)

#### 🪟 Windows Portable Package (Recommended for Windows)

**The easiest way to get started on Windows!** This package includes everything pre-configured:

1. **Download** [ACE-Step-1.5.7z](https://files.acemusic.ai/acemusic/win/ACE-Step-1.5.7z) (~5GB)
2. **Extract** to `C:\ACE-Step-1.5` (or your preferred location)
3. **Done!** The package includes `python_embeded` with all dependencies

✅ **Works with 4GB GPU** - No LLM installation required
✅ **CUDA 12.8** included
✅ **Zero setup hassle**

> **Note:** Thinking Mode (LLM features) is automatically disabled on GPUs with <12GB VRAM. You can still enable it manually if you have 12GB+.

#### Standard Installation (All Platforms)

```bash
# Clone the ACE-Step 1.5 engine
git clone https://github.com/ace-step/ACE-Step-1.5
cd ACE-Step-1.5

# Create virtual environment and install
uv venv
uv pip install -e .

# Models download automatically on first run (~5GB)
cd ..
```

### 2. Install Core.fm (This Repository)

#### Linux / macOS
```bash
# Clone the UI
git clone https://github.com/fspecii/ace-step-ui
cd ace-step-ui

# Run setup script (installs all dependencies)
./setup.sh
```

#### Windows
```batch
REM Clone the UI
git clone https://github.com/fspecii/ace-step-ui
cd ace-step-ui

REM Run setup script (installs all dependencies)
setup.bat
```

#### Manual Installation (All Platforms)

```bash
# Install frontend dependencies
npm install

# Install server dependencies
cd server
npm install
cd ..

# Copy environment file
# Linux/macOS:
cp server/.env.example server/.env
# Windows:
copy server\.env.example server\.env
```

---

## 🎮 Usage

### Step 1: Start ACE-Step Gradio Server

**🪟 Windows Portable Package:**
```batch
cd C:\ACE-Step-1.5
python_embeded\python -m acestep --port 8001 --enable-api --backend pt --server-name 127.0.0.1
```

**Linux / macOS:**
```bash
cd /path/to/ACE-Step-1.5
uv run acestep --port 8001 --enable-api --backend pt --server-name 127.0.0.1
```

**Windows (Standard Installation):**
```batch
cd C:\path\to\ACE-Step-1.5
uv run acestep --port 8001 --enable-api --backend pt --server-name 127.0.0.1
```

Wait for "API endpoints enabled" before proceeding.

### Step 2: Start Core.fm

**Linux / macOS:**
```bash
cd ace-step-ui
./start.sh
```

**Windows:**
```batch
cd ace-step-ui
start.bat
```

This opens one window per service — the engine, the Core.fm backend (3001) and frontend (3000), plus the
**Trends** loop on http://localhost:3002 when `signal-aggregator/` is installed alongside. The loop is the part
that reads the charts and learns from your verdicts; the app works without it, and what it contributes lands
in the Trends tab.

### Step 3: Create Music!

| Access | URL |
|--------|-----|
| Local | http://localhost:3000 |
| LAN (other devices) | http://YOUR_IP:3000 |

---

## ⚙️ Configuration

Edit `server/.env`:

```env
# Server
PORT=3001

# ACE-Step Gradio URL (must match --port used when starting ACE-Step)
ACESTEP_API_URL=http://localhost:8001

# Database (local-first, no cloud)
DATABASE_PATH=./data/acestep.db

# Optional: Pexels API for video backgrounds
PEXELS_API_KEY=your_key_here
```

---

## 🎼 Generation Modes

### Simple Mode
Just describe what you want. ACE-Step handles the rest.

> "An upbeat pop song about summer adventures with catchy hooks"

### Custom Mode
Full control over every parameter:

| Parameter | Description |
|-----------|-------------|
| **Lyrics** | Full lyrics with `[Verse]`, `[Chorus]` tags |
| **Style** | Genre, mood, instruments, tempo |
| **Duration** | 30-240 seconds |
| **BPM** | 60-200 beats per minute |
| **Key** | Musical key (C major, A minor, etc.) |

### AI Enhance & Thinking Mode

| Mode | What it does | Speed impact |
|------|-------------|--------------|
| **AI Enhance OFF** | Sends your style tags directly to the model | Fastest |
| **AI Enhance ON** | LLM enriches your tags into a detailed caption and generates proper BPM, key, time signature | +10-20s |
| **Thinking Mode** | Full LLM reasoning with audio code generation | Slowest, best quality |

> **Tip:** If your genre tags (e.g. "pop, rock") produce ballad-like output, turn on **AI Enhance** for much better genre accuracy. No extra VRAM needed — the LLM runs on CPU with the PT backend.

### Batch Size & Bulk Generation

| Setting | Description |
|---------|-------------|
| **Batch Size** | Number of variations generated per job (1-4). Default is **1** for broad GPU compatibility. Higher values generate more variations but use more VRAM. **8GB GPU users should keep this at 1.** |
| **Bulk Generate** | Queue multiple independent generation jobs (1-10). Each job runs sequentially, so this is safe for any GPU. |
| **LM Backend** | Choose between **PT** (~1.6 GB VRAM) and **VLLM** (~9.2 GB VRAM). PT is the default and works on most GPUs. |

> **Tip:** Both batch size and bulk count are remembered in your browser — set them once and they stick for future sessions.

---

## 🔧 Built-in Tools

| Tool | Description |
|------|-------------|
| **🎚️ Audio Editor** | Cut, trim, fade, and apply effects |
| **🎤 Stem Extraction** | Separate vocals, drums, bass, other |
| **🎬 Video Generator** | Create music videos with stock footage |
| **🎨 Album Art** | Auto-generated gradient covers |

---

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| **ACE-Step not reachable** | Ensure Gradio server is running with `--enable-api` flag (see Usage section) |
| **CUDA out of memory** | Use `--backend pt` (default), set batch size to **1**, reduce duration, or disable Thinking Mode |
| **4GB GPU - Out of memory** | Use **PT** backend (default), batch size **1**, and keep **Thinking Mode OFF**. LLM features require 12GB+ |
| **Genre always sounds like ballad** | Enable **AI Enhance** toggle in the Style section — it enriches your tags with proper metadata |
| **AttributeError: 'NoneType'** | Update to latest ACE-Step-1.5 (fix merged in PR #109) |
| **Songs show 0:00 duration** | Install FFmpeg: `sudo apt install ffmpeg` (Linux) or download from [ffmpeg.org](https://ffmpeg.org) (Windows) |
| **LAN access not working** | Check firewall allows ports 3000 and 3001 |

---

## 🤝 Contributing

**We need your help to make Core.fm even better!**

This is a community-driven project and contributions are what make open source amazing. Whether you're fixing bugs, adding features, improving documentation, or sharing ideas - every contribution counts!

### Ways to Contribute

- 🐛 **Report bugs** - Found an issue? Open a GitHub issue
- 💡 **Suggest features** - Have an idea? We'd love to hear it
- 🔧 **Submit PRs** - Code contributions are always welcome
- 📖 **Improve docs** - Help others get started
- ⭐ **Star the repo** - Show your support!

### How to Contribute

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

## 📣 Stay Connected

<p align="center">
  <a href="https://www.youtube.com/@Ambsd-yy7os">
    <img src="https://img.shields.io/badge/YouTube-Subscribe_for_Tutorials-FF0000?style=for-the-badge&logo=youtube" alt="YouTube">
  </a>
</p>

<p align="center">
  <a href="https://x.com/AmbsdOP">
    <img src="https://img.shields.io/badge/X_(Twitter)-Follow_for_Updates-1DA1F2?style=for-the-badge&logo=x&logoColor=white" alt="X/Twitter">
  </a>
</p>

<p align="center">
  <strong>Subscribe and follow for:</strong><br>
  🎥 Video tutorials and demos<br>
  🚀 New feature announcements<br>
  💡 Tips and tricks<br>
  🎵 AI music generation news
</p>

---

## 💼 Need a Website Like This?

If you like the engineering and design behind Core.fm and want something similar built for your business, the same team offers professional web development services.

**We build:**
- 🌐 Custom websites & web apps — Next.js, Astro, WordPress, React
- 🤖 AI integrations & automations — OpenAI, Anthropic, custom LLM workflows
- 📱 Mobile apps — iOS, Android, React Native
- 🎨 UI/UX design tailored to your brand

<p align="center">
  <a href="https://webdesignstudio.london">
    <img src="https://img.shields.io/badge/Get_in_Touch-webdesignstudio.london-d4ff00?style=for-the-badge&labelColor=000000" alt="webdesignstudio.london">
  </a>
</p>

<p align="center">
  <em>From the makers of Core.fm — we ship production-grade web experiences.</em>
</p>

---

## 👤 About the Author

Core.fm is built and maintained by **Vali** — open-source developer and founder of [Web Design Studio London](https://webdesignstudio.london), a specialist web design and development studio serving London businesses and international clients.

Web Design Studio London builds high-performance Next.js websites, ecommerce platforms, and AI-integrated web applications — the same technical approach that powers this project.

If you need a professional website, ecommerce build, or AI integration for your business, visit [webdesignstudio.london](https://webdesignstudio.london).

---

## 🙏 Credits

- **[ACE-Step](https://github.com/ace-step/ACE-Step-1.5)** - The revolutionary open source AI music generation model
- **[AudioMass](https://github.com/pkalogiros/AudioMass)** - Web audio editor
- **[Demucs](https://github.com/facebookresearch/demucs)** - Audio source separation
- **[Pexels](https://www.pexels.com)** - Stock video backgrounds

---

## 📄 License

This project is open source under the [MIT License](LICENSE).

---

<p align="center">
  <strong>⭐ If Core.fm helps you create amazing music, please star this repo! ⭐</strong>
</p>

<p align="center">
  <em>Made with ❤️ for the open-source AI music community</em>
</p>

<p align="center">
  <strong>Make music that fits a market. Run all of it locally.</strong>
</p>
