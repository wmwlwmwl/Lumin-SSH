// 文件类型分类函数测试（node scripts/test-file-type-classify.mjs）
import assert from 'node:assert/strict';
import { isArchive, isBinaryLike, isViewable } from '../src/utils/fileTypeClassify.js';

// isArchive：常见与复合后缀
['app.zip', 'pkg.tar', 'app.tar.gz', 'app.tar.bz2', 'app.tar.xz', 'app.tar.zst',
 'a.gz', 'a.bz2', 'a.xz', 'a.tgz', 'a.rar', 'a.7z', 'a.iso', 'a.cab', 'a.jar',
 'backup.TAR.GZ', 'dist/lz4.bin.zst'.split('/').pop()].forEach((n) => {
  assert.equal(isArchive(n), true, `应为压缩包: ${n}`);
});
['a.txt', 'a.lua', 'gzip', 'tarball.md', '', '.gz-hidden'].forEach((n) => {
  assert.equal(isArchive(n), false, `不应为压缩包: ${n}`);
});

// isBinaryLike
['a.exe', 'b.dll', 'libfoo.so', 'x.dylib', 'drv.sys', 'data.bin', 'setup.msi',
 'app.deb', 'app.rpm', 'app.apk', 'mod.ko', 'boot.efi', 'main.o', 'a.obj',
 'libx.a', 'msvcrt.lib', 'x.pyd', 'm.wasm', 'App.class', 'x.db', 'x.sqlite',
 'x.sqlite3', 'x.mdb', 'disk.img', 'mac.dmg', 'v.vmdk', 'v.vdi', 'v.qcow2'].forEach((n) => {
  assert.equal(isBinaryLike(n), true, `应为二进制: ${n}`);
});
['a.txt', 'a.exe.bak', 'exec', ''].forEach((n) => {
  assert.equal(isBinaryLike(n), false, `不应为二进制: ${n}`);
});

// isViewable
['p.png', 'p.jpg', 'p.jpeg', 'p.gif', 'p.webp', 'p.bmp', 'p.ico',
 'v.mp4', 'v.mkv', 'v.avi', 'v.mov', 'v.wmv', 'a.mp3', 'a.wav', 'a.flac',
 'a.ogg', 'doc.pdf', 'DOC.PDF'].forEach((n) => {
  assert.equal(isViewable(n), true, `应为媒体类: ${n}`);
});
// svg 是文本，归 isEditable，不属 viewable
['a.txt', 'a.svg', 'a.svgz', 'pdf', ''].forEach((n) => {
  assert.equal(isViewable(n), false, `不应为媒体类: ${n}`);
});

console.log('fileTypeClassify: all assertions passed');
