import { useState, useEffect, useCallback, useRef } from 'react';
import * as AppGo from '../../wailsjs/go/main/App.js';
import { APP_VERSION } from '../config.js';
import { EventsOn } from '../../wailsjs/runtime/runtime.js';

const RELEASE_API = 'https://api.github.com/repos/wmwlwmwl/Lumin-SSH/releases/latest';

// 语义化版本比较：latest > current 返回 true
export function compareVersions(latestVer, currentVer) {
  if (latestVer === currentVer) return false;
  const lParts = latestVer.split('.').map(Number);
  const cParts = currentVer.split('.').map(Number);
  for (let i = 0; i < Math.max(lParts.length, cParts.length); i++) {
    const l = lParts[i] || 0;
    const c = cParts[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

// 判断当前是否 Linux 平台
function isLinux() {
  return navigator.userAgent.includes('Linux') || navigator.platform.includes('Linux');
}

// 判断当前是否 macOS 平台
function isMacOS() {
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform) || navigator.userAgent.includes('Mac OS');
}

// 匹配下载资源（便携版/安装版/兜底）
async function resolveDownloadAsset(data) {
  let isPortable = false;
  if (window?.go?.main?.App?.IsPortableVersion) {
    isPortable = await window.go.main.App.IsPortableVersion();
  }
  if (data.assets && data.assets.length > 0) {
    let targetAsset = null;

    // macOS: Release 使用 DMG 分发，忽略配套的 .sha256 文件
    if (isMacOS()) {
      targetAsset = data.assets.find(a => a.name.toLowerCase().endsWith('.dmg'));
      if (targetAsset) {
        return { url: targetAsset.browser_download_url, filename: targetAsset.name };
      }
    }

    // Linux: 优先选取 .deb 包，其次 .rpm
    if (isLinux()) {
      targetAsset = data.assets.find(a => a.name.endsWith('.deb'));
      if (!targetAsset) {
        targetAsset = data.assets.find(a => a.name.endsWith('.rpm'));
      }
      if (targetAsset) {
        return { url: targetAsset.browser_download_url, filename: targetAsset.name };
      }
    }

    // Windows: 原有逻辑
    if (isPortable) {
      targetAsset = data.assets.find(a => !/installer|setup/i.test(a.name) && a.name.endsWith('.exe'));
    } else {
      targetAsset = data.assets.find(a => /setup|installer/i.test(a.name) && a.name.endsWith('.exe'));
    }
    if (!targetAsset) {
      targetAsset = data.assets.find(a => a.name.endsWith('.exe'));
    }
    if (targetAsset) {
      return { url: targetAsset.browser_download_url, filename: targetAsset.name };
    }
  }
  const fallbackName = isMacOS() ? 'update.dmg' : (isLinux() ? 'update.deb' : 'update.exe');
  return { url: data.html_url || '', filename: fallbackName };
}

/**
 * 自动更新检查 Hook，封装 GitHub Releases 检查、资源匹配、下载进度、应用更新逻辑
 * @param {Object} options
 * @param {Function} [options.onResult] - (result) => void, result = { hasUpdate, latestVersion, url, filename }
 * @param {Function} [options.onError] - (err) => void
 */
export function useUpdateChecker({ onResult, onError } = {}) {
  const [checking, setChecking] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(-1);

  const cbRef = useRef({ onResult, onError });
  cbRef.current = { onResult, onError };

  useEffect(() => {
    const off = EventsOn('app-update-progress', (progress) => {
      if (typeof progress === 'number') setDownloadProgress(progress);
    });
    return off;
  }, []);

  const checkUpdate = useCallback(async () => {
    setChecking(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const res = await fetch(RELEASE_API, { signal: controller.signal });
      if (!res.ok) throw new Error('API request failed');
      const data = await res.json();
      if (!data || !data.tag_name) return null;

      const latest = data.tag_name.replace(/^v+/i, '');
      const { url, filename } = await resolveDownloadAsset(data);
      const hasUpdate = compareVersions(latest, APP_VERSION);
      const result = { hasUpdate, latestVersion: latest, url, filename };
      cbRef.current.onResult?.(result);
      return result;
    } catch (err) {
      cbRef.current.onError?.(err);
      return null;
    } finally {
      clearTimeout(timeout);
      setChecking(false);
    }
  }, []);  // Empty deps - stable reference

  const applyUpdate = useCallback(async (updateInfo) => {
    if (!updateInfo || !updateInfo.url) return;
    if (downloadProgress >= 0) return;
    // 非平台安装包的链接直接打开浏览器
    const packageName = (updateInfo.filename || updateInfo.url).toLowerCase();
    if (!/\.(exe|deb|rpm|dmg)$/.test(packageName)) {
      window.runtime?.BrowserOpenURL(updateInfo.url);
      return;
    }
    setDownloadProgress(0);
    let defaultName = 'update.exe';
    if (updateInfo.url.endsWith('.deb')) defaultName = 'update.deb';
    else if (updateInfo.url.endsWith('.rpm')) defaultName = 'update.rpm';
    else if (updateInfo.url.endsWith('.dmg')) defaultName = 'update.dmg';
    try {
      await AppGo.UpdateApp(updateInfo.url, updateInfo.filename || defaultName);
    } catch (err) {
      setDownloadProgress(-1);
      throw err;
    }
  }, [downloadProgress]);

  return { checking, downloadProgress, checkUpdate, applyUpdate };
}
