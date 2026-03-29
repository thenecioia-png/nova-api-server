#!/usr/bin/env python3
  """
  NOVA Frontend Auto-Deploy Script
  N.O.V.A. corre esto via bot: set NOVA_GH_TOKEN=XXX && python nova_deploy_frontend.py
  """
  import os, subprocess, sys, shutil, tempfile

  GITHUB_TOKEN = os.environ.get("NOVA_GH_TOKEN", "")
  if not GITHUB_TOKEN:
      print("[ERROR] Falta env var NOVA_GH_TOKEN. Ejecuta con: set NOVA_GH_TOKEN=tutoken && python nova_deploy_frontend.py")
      sys.exit(1)

  SOURCE_REPO = "https://github.com/thenecioia-png/nova-api-server.git"
  DEPLOY_REPO = f"https://x-access-token:{GITHUB_TOKEN}@github.com/thenecioia-png/nova-ui.git"
  BUILD_DIR   = os.path.join(tempfile.gettempdir(), "nova_build_src")

  def run(cmd, cwd=None, extra_env=None):
      env = os.environ.copy()
      if extra_env:
          env.update(extra_env)
      print(f"  > {cmd[:120]}")
      r = subprocess.run(cmd, shell=True, cwd=cwd, env=env, capture_output=True, text=True)
      if r.stdout.strip(): print(r.stdout[-2000:])
      if r.returncode != 0:
          print(f"[ERROR] {r.stderr[-1000:]}")
          sys.exit(1)
      return r.stdout

  print("=== NOVA Frontend Auto-Deploy ===")

  # 1. Clone or pull source
  if os.path.exists(os.path.join(BUILD_DIR, ".git")):
      print("Pulling latest source...")
      run("git pull --rebase", cwd=BUILD_DIR)
  else:
      print("Cloning source repo...")
      if os.path.exists(BUILD_DIR): shutil.rmtree(BUILD_DIR)
      run(f"git clone --depth 1 {SOURCE_REPO} \"{BUILD_DIR}\"")

  # 2. Install pnpm + deps
  print("Installing dependencies...")
  run("npm install -g pnpm@9 2>nul || true")
  run("pnpm install --frozen-lockfile", cwd=BUILD_DIR)

  # 3. Build frontend
  print("Building frontend...")
  run("pnpm --filter @workspace/asistente-ia run build", cwd=BUILD_DIR, extra_env={
      "STATIC_BUILD": "1",
      "BASE_PATH": "/nova-ui/",
      "VITE_API_URL": "https://nova-api-server.onrender.com",
  })

  # 4. Add 404.html for SPA routing
  dist_dir = os.path.join(BUILD_DIR, "artifacts", "asistente-ia", "dist", "public")
  shutil.copy(os.path.join(dist_dir, "index.html"), os.path.join(dist_dir, "404.html"))

  # 5. Force push dist to nova-ui
  print("Pushing to GitHub Pages...")
  run("git init", cwd=dist_dir)
  run('git config user.name "N.O.V.A"', cwd=dist_dir)
  run('git config user.email "nova@thenecioia.ai"', cwd=dist_dir)
  run("git add -A", cwd=dist_dir)
  run('git commit -m "NOVA auto-deploy frontend"', cwd=dist_dir)
  run(f"git push -f \"{DEPLOY_REPO}\" HEAD:main", cwd=dist_dir)

  print("\n OK Deploy completado! Disponible en https://thenecioia-png.github.io/nova-ui/ en ~2 min")
  