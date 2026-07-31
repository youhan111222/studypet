"""Fix broken shortcuts on Start Menu after D drive reorganization."""
import os
import glob
import subprocess

SEARCH_ROOTS = [
    r"D:\01_核心资产", r"D:\02_游戏中心", r"D:\03_专业软件",
    r"D:\04_常用工具", r"D:\05_开发编程", r"D:\06_系统与缓存",
    r"D:\07_其他待处理", r"D:\08音乐", r"D:\文档笔记",
    r"D:\BaiduNetdiskDownload", r"D:\BiliDownload", r"D:\CloudMusic",
    r"D:\SteamLibrary", r"D:\Desktop"
]

START_PATHS = [
    r"C:\ProgramData\Microsoft\Windows\Start Menu",
    os.path.expandvars(r"%APPDATA%\Microsoft\Windows\Start Menu"),
]

def resolve_shortcut(lnk_path):
    """Get target of a .lnk file using PowerShell."""
    try:
        ps = f'''
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut("{lnk_path}")
Write-Host $s.TargetPath
'''
        result = subprocess.run(
            ["powershell.exe", "-Command", ps],
            capture_output=True, text=True, timeout=5
        )
        target = result.stdout.strip()
        return target if target else None
    except Exception:
        return None

def fix_shortcut(lnk_path, new_target):
    """Update a .lnk file target using PowerShell."""
    try:
        new_dir = os.path.dirname(new_target)
        ps = f'''
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut("{lnk_path}")
$s.TargetPath = "{new_target}"
$s.WorkingDirectory = "{new_dir}"
$s.Save()
Write-Host "OK"
'''
        result = subprocess.run(
            ["powershell.exe", "-Command", ps],
            capture_output=True, text=True, timeout=5
        )
        return "OK" in result.stdout
    except Exception:
        return False

def find_file(filename, search_roots):
    """Search for a file under search_roots. Returns full path or None."""
    for root in search_roots:
        for dirpath, dirnames, filenames in os.walk(root):
            # Skip deep nesting
            depth = dirpath.replace(root, "").count(os.sep)
            if depth > 5:
                dirnames.clear()
                continue
            if filename in filenames:
                return os.path.join(dirpath, filename)
    return None

def main():
    all_shortcuts = []
    for sp in START_PATHS:
        if os.path.exists(sp):
            all_shortcuts.extend(glob.glob(f"{sp}/**/*.lnk", recursive=True))

    print(f"Found {len(all_shortcuts)} shortcuts\n")

    broken = []
    for lnk in all_shortcuts:
        target = resolve_shortcut(lnk)
        if target and not os.path.exists(target):
            broken.append((lnk, target))

    print(f"Broken: {len(broken)}\n")

    fixed = 0
    still_broken = []

    for lnk_path, old_target in broken:
        exe_name = os.path.basename(old_target)
        old_dir = os.path.dirname(old_target)
        dir_name = os.path.basename(old_dir)

        # Strategy 1: find directory by name, then exe in it
        found = None
        for root in SEARCH_ROOTS:
            candidate_dir = os.path.join(root, dir_name)
            if os.path.isdir(candidate_dir):
                candidate_exe = os.path.join(candidate_dir, exe_name)
                if os.path.exists(candidate_exe):
                    found = candidate_exe
                    break
                # search deeper
                for dirpath, _, filenames in os.walk(candidate_dir):
                    if exe_name in filenames:
                        found = os.path.join(dirpath, exe_name)
                        break
                if found:
                    break

        # Strategy 2: search by exe name across all roots
        if not found:
            found = find_file(exe_name, SEARCH_ROOTS)

        if found:
            if fix_shortcut(lnk_path, found):
                name = os.path.basename(lnk_path)
                print(f"  FIXED: {name} -> {found}")
                fixed += 1
            else:
                still_broken.append((lnk_path, old_target, "fix failed"))
        else:
            name = os.path.basename(lnk_path)
            still_broken.append((lnk_path, old_target, f"cannot find {exe_name}"))
            print(f"  MISSING: {name} | exe={exe_name} | old={old_target}")

    print(f"\n=== Fixed: {fixed} ===")
    print(f"=== Still broken: {len(still_broken)} ===")
    for lnk, old, reason in still_broken:
        print(f"  {os.path.basename(lnk)}: {reason}")

if __name__ == "__main__":
    main()
