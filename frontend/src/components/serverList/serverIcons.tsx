import type React from 'react';

export const LATENCY_CLASS = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined) return 'offline';
  if (ms < 0) return 'good';     // -1 = <1ms (proxy/local)
  if (ms <= 300) return 'good';  // 0-300ms 绿色
  if (ms <= 400) return 'warn';  // 301-400ms 黄色
  return 'bad';                  // >400ms 红色
};

const osIcon = (src: string, alt: string) => <img src={src} width="22" height="22" alt={alt} />;
export const UbuntuIcon     = () => osIcon('/ubuntu.svg', 'Ubuntu');
export const DebianIcon     = () => osIcon('/debian.svg', 'Debian');
export const CentosIcon     = () => osIcon('/centos.svg', 'CentOS');
export const WinIcon        = () => osIcon('/windows.svg', 'Windows');
export const AppleIcon      = () => osIcon('/macos.svg', 'macOS');
export const LinuxIcon      = () => osIcon('/linux.svg', 'Linux');
export const KaliIcon       = () => osIcon('/kali.svg', 'Kali');
export const AlmaIcon       = () => osIcon('/almalinux.svg', 'AlmaLinux');
export const RockyIcon      = () => osIcon('/rocky.svg', 'Rocky');
export const OracleIcon     = () => osIcon('/oracle.svg', 'Oracle');
export const AnolisIcon     = () => osIcon('/Anolis.png', 'Anolis');
export const OpenCloudIcon  = () => osIcon('/OpenCloudOS.png', 'OpenCloudOS');
export const OpenEulerIcon  = () => osIcon('/openEuler.svg', 'openEuler');
export const OpenSuseIcon   = () => osIcon('/openSUSE.svg', 'openSUSE');
export const NixosIcon      = () => osIcon('/nixos.svg', 'NixOS');
export const GentooIcon     = () => osIcon('/gentoo.svg', 'Gentoo');
export const AoscIcon       = () => osIcon('/aosc.svg', 'AOSC');
export const RhelIcon       = () => osIcon('/rhel.svg', 'RHEL');
export const FedoraIcon     = () => osIcon('/fedora.svg', 'Fedora');
export const ArchIcon       = () => osIcon('/arch.svg', 'Arch');
export const AlpineIcon     = () => osIcon('/alpine.svg', 'Alpine');
export const FreeBSDIcon    = () => osIcon('/freebsd.svg', 'FreeBSD');
export const TencentIcon    = () => osIcon('/TencentOS.svg', 'TencentOS');
export const AlibabaIcon    = () => osIcon('/Alibaba.svg', 'Alibaba');

export interface OSInfoResult {
  icon: React.ReactNode;
  bg: string;
  accent: string;
  accentRgb?: string;
  label: string;
}

const _osInfoCache = new Map<string, OSInfoResult>();
export const getOSInfo = (name = '', os = '', osInfo: Record<string, unknown> | null = null): OSInfoResult => {
  const dynStr = String(osInfo?.os || osInfo?.platform || '').toLowerCase();
  const n = dynStr || (name + ' ' + (os || '')).toLowerCase();
  if (_osInfoCache.has(n)) return _osInfoCache.get(n) as OSInfoResult;
  let result: OSInfoResult;
  const distroBg = 'var(--surface-overlay)';
  const distroAccent = 'var(--text-secondary)';
  if (n.includes('ubuntu'))            result = { icon: <UbuntuIcon />, bg: distroBg, accent: distroAccent, label: 'Ubuntu' };
  else if (n.includes('debian'))       result = { icon: <DebianIcon />, bg: distroBg, accent: distroAccent, label: 'Debian' };
  else if (n.includes('kali'))         result = { icon: <KaliIcon />, bg: distroBg, accent: distroAccent, label: 'Kali' };
  else if (n.includes('centos stream'))result = { icon: <CentosIcon />, bg: distroBg, accent: distroAccent, label: 'CentOS Stream' };
  else if (n.includes('tencent'))      result = { icon: <TencentIcon />, bg: distroBg, accent: distroAccent, label: 'TencentOS' };
  else if (n.includes('centos'))       result = { icon: <CentosIcon />, bg: distroBg, accent: distroAccent, label: 'CentOS' };
  else if (n.includes('rhel'))         result = { icon: <RhelIcon />, bg: distroBg, accent: distroAccent, label: 'RHEL' };
  else if (n.includes('almalinux'))    result = { icon: <AlmaIcon />, bg: distroBg, accent: distroAccent, label: 'AlmaLinux' };
  else if (n.includes('rocky'))        result = { icon: <RockyIcon />, bg: distroBg, accent: distroAccent, label: 'Rocky' };
  else if (n.includes('oracle'))       result = { icon: <OracleIcon />, bg: distroBg, accent: distroAccent, label: 'Oracle' };
  else if (n.includes('alibaba') || n.includes('aliyun')) result = { icon: <AlibabaIcon />, bg: distroBg, accent: distroAccent, label: 'Alibaba' };
  else if (n.includes('anolis'))       result = { icon: <AnolisIcon />, bg: distroBg, accent: distroAccent, label: 'Anolis' };
  else if (n.includes('opencloudos'))  result = { icon: <OpenCloudIcon />, bg: distroBg, accent: distroAccent, label: 'OpenCloudOS' };
  else if (n.includes('openeuler'))    result = { icon: <OpenEulerIcon />, bg: distroBg, accent: distroAccent, label: 'openEuler' };
  else if (n.includes('fedora'))       result = { icon: <FedoraIcon />, bg: distroBg, accent: distroAccent, label: 'Fedora' };
  else if (n.includes('opensuse'))     result = { icon: <OpenSuseIcon />, bg: distroBg, accent: distroAccent, label: 'openSUSE' };
  else if (n.includes('arch'))         result = { icon: <ArchIcon />, bg: distroBg, accent: distroAccent, label: 'Arch' };
  else if (n.includes('nixos'))        result = { icon: <NixosIcon />, bg: distroBg, accent: distroAccent, label: 'NixOS' };
  else if (n.includes('alpine'))       result = { icon: <AlpineIcon />, bg: distroBg, accent: distroAccent, label: 'Alpine' };
  else if (n.includes('gentoo'))       result = { icon: <GentooIcon />, bg: distroBg, accent: distroAccent, label: 'Gentoo' };
  else if (n.includes('aosc'))         result = { icon: <AoscIcon />, bg: distroBg, accent: distroAccent, label: 'AOSC' };
  else if (n.includes('freebsd'))      result = { icon: <FreeBSDIcon />, bg: distroBg, accent: distroAccent, label: 'FreeBSD' };
  else if (n.includes('windows'))      result = { icon: <WinIcon />, bg: distroBg, accent: distroAccent, label: 'Windows' };
  else if (n.includes('mac') || n.includes('darwin')) result = { icon: <AppleIcon />, bg: distroBg, accent: distroAccent, label: 'macOS' };
  else if (n.includes('prod') || n.includes('生产'))  result = { icon: <LinuxIcon />, bg: 'rgba(var(--success-rgb),0.15)', accent: 'var(--success)', accentRgb: 'var(--success-rgb)', label: 'Prod' };
  else if (n.includes('dev') || n.includes('开发'))   result = { icon: <LinuxIcon />, bg: 'rgba(var(--info-rgb),0.15)', accent: 'var(--info)', accentRgb: 'var(--info-rgb)', label: 'Dev' };
  else if (n.includes('test') || n.includes('测试'))  result = { icon: <LinuxIcon />, bg: 'rgba(var(--danger-rgb),0.15)', accent: 'var(--danger)', accentRgb: 'var(--danger-rgb)', label: 'Test' };
  else if (n.includes('db') || n.includes('数据'))    result = { icon: <LinuxIcon />, bg: 'rgba(var(--warning-rgb),0.15)', accent: 'var(--warning)', accentRgb: 'var(--warning-rgb)', label: 'DB' };
  else if (n.includes('web') || n.includes('nginx'))  result = { icon: <LinuxIcon />, bg: 'rgba(var(--accent-rgb),0.15)', accent: 'var(--accent)', accentRgb: 'var(--accent-rgb)', label: 'Web' };
  else result = { icon: <LinuxIcon />, bg: 'var(--surface-sunken)', accent: 'var(--text-secondary)', accentRgb: '128,128,128', label: 'Linux' };
  _osInfoCache.set(n, result);
  return result;
};
