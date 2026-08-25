import {
  Folder, File, FileText, FileCode, FileArchive, Settings, ClipboardList, Wrench,
  Image, Code, Globe, Palette, Database, Terminal, Film, Music, HardDrive, BookOpen,
  FolderSymlink, FileSymlink,
  type LucideIcon,
} from 'lucide-react';

// 文件图标（颜色统一走 CSS 变量，浅/深色主题一致切换）
export const ICON_SIZE = 16;
export function fileIcon(name: unknown, isDir: boolean, isSymlink = false) {
  if (isDir) {
    return (
      <span className={`file-icon-themed file-icon-folder${isSymlink ? ' file-icon-symlink' : ''}`}>
        {isSymlink ? <FolderSymlink size={ICON_SIZE} /> : <Folder size={ICON_SIZE} />}
      </span>
    );
  }
  if (isSymlink) {
    return (
      <span className="file-icon-themed file-icon-default file-icon-symlink">
        <FileSymlink size={ICON_SIZE} />
      </span>
    );
  }
  const lowerName = String(name || '').toLowerCase();
  let ext = (lowerName.split('.').pop() || '').toLowerCase();
  if (lowerName === 'dockerfile' || lowerName.startsWith('dockerfile.')) ext = 'dockerfile';
  if (lowerName === 'makefile') ext = 'makefile';
  if (lowerName === 'cmakelists.txt') ext = 'cmake';
  if (lowerName === 'nginx.conf') ext = 'nginx';

  const iconMap: Record<string, LucideIcon> = {
    js: Code, jsx: Code, mjs: Code, cjs: Code, ts: Code, tsx: Code, vue: Code,
    py: Terminal, pyw: Terminal, pyi: Terminal, rb: HardDrive, lua: Code, go: Code, rs: Code, java: Code,
    c: Code, cc: Code, cpp: Code, cxx: Code, h: Code, hpp: Code, hh: Code, hxx: Code, cs: Code,
    html: Globe, htm: Globe, css: Palette, scss: Palette, less: Palette,
    json: Settings, yaml: Settings, yml: Settings, toml: Settings, ini: Settings, env: Settings, cfg: Settings, conf: Settings,
    md: FileText, txt: File, log: ClipboardList,
    png: Image, jpg: Image, jpeg: Image, gif: Image, svg: Image, webp: Image,
    zip: FileArchive, tar: FileArchive, gz: FileArchive, rar: FileArchive, '7z': FileArchive, tgz: FileArchive, bz2: FileArchive,
    sh: Wrench, bash: Wrench, zsh: Wrench, ksh: Wrench, ps1: Wrench, psm1: Wrench, psd1: Wrench,
    pdf: BookOpen, sql: Database, xml: FileCode, php: Terminal,
    mp4: Film, mkv: Film, avi: Film,
    mp3: Music, wav: Music,
    pl: Terminal, pm: Terminal, diff: FileCode, patch: FileCode,
    dockerfile: FileCode, makefile: FileCode, cmake: FileCode, nginx: FileCode,
  };
  // Sanitize class fragment: keep alnum/._- only
  const safeExt = (ext || 'default').replace(/[^a-z0-9._-]/gi, '') || 'default';
  const IconComp = iconMap[ext] || File;
  return (
    <span className={`file-icon-themed file-icon-${safeExt}`}>
      <IconComp size={ICON_SIZE} />
    </span>
  );
}
