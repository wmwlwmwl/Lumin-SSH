// 文件类型分类：用于文件管理器双击打开前的类型校验。
// 压缩包与二进制不适合编辑，不应进入编辑器路径；媒体类适合用系统关联程序查看。

// 压缩包扩展名（按最后一个扩展名判定，可覆盖 tar.gz/tar.bz2/tar.xz/tar.zst 等复合后缀）
const ARCHIVE_EXTS = new Set([
  'zip', 'tar', 'gz', 'bz2', 'xz', 'zst', 'lz4', 'tgz', 'tbz2', 'txz',
  'rar', '7z', 'iso', 'cab', 'jar', 'war', 'ear',
]);

// 不适合编辑的二进制文件扩展名
const BINARY_EXTS = new Set([
  'exe', 'dll', 'so', 'dylib', 'sys', 'bin', 'msi', 'deb', 'rpm', 'apk',
  'ko', 'efi', 'o', 'obj', 'a', 'lib', 'pyd', 'wasm', 'class',
  'db', 'sqlite', 'sqlite3', 'mdb',
  'img', 'dmg', 'vmdk', 'vdi', 'qcow2',
]);

// 可看不可编的媒体类扩展名（适合系统关联程序打开）
// 注：svg 是文本，归可编辑（isEditable），不在此列。
const VIEWABLE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico',
  'mp4', 'mkv', 'avi', 'mov', 'wmv',
  'mp3', 'wav', 'flac', 'ogg',
  'pdf',
]);

// 提取文件名最后一个扩展名（小写），无扩展名返回 ''
function lastExt(name) {
  const base = String(name || '');
  const idx = base.lastIndexOf('.');
  if (idx <= 0 || idx === base.length - 1) return '';
  return base.slice(idx + 1).toLowerCase();
}

/**
 * 是否为压缩包
 * @param {string} name 文件名（不含路径）
 */
export function isArchive(name) {
  return ARCHIVE_EXTS.has(lastExt(name));
}

/**
 * 是否为不适合编辑的二进制文件
 * @param {string} name 文件名（不含路径）
 */
export function isBinaryLike(name) {
  return BINARY_EXTS.has(lastExt(name));
}

/**
 * 是否为适合系统关联程序查看的媒体文件（图片/音视频/PDF）
 * @param {string} name 文件名（不含路径）
 */
export function isViewable(name) {
  return VIEWABLE_EXTS.has(lastExt(name));
}
