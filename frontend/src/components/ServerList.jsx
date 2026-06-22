import { useState, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from '../i18n.js';
import { Monitor, Pencil, Link, Trash2, X, SquarePen } from 'lucide-react';
import { clampMenuPosition } from '../utils/menuPosition.js';

const MENU_ESTIMATED_WIDTH = 196;
const MENU_ESTIMATED_HEIGHT = 132;

const LATENCY_CLASS = (ms) => {
  if (ms === null || ms === undefined) return 'offline';
  if (ms < 0) return 'good';     // -1 = <1ms (proxy/local)
  if (ms <= 300) return 'good';  // 0-300ms 绿色
  if (ms <= 400) return 'warn';  // 301-400ms 黄色
  return 'bad';                  // >400ms 红色
};

const UbuntuIcon = () => <svg viewBox="0 0 256 256" width="22" height="22"><path d="M255.637 127.683c0 70.514-57.165 127.68-127.683 127.68C57.434 255.363.27 198.197.27 127.683.27 57.165 57.436 0 127.954 0c70.519 0 127.683 57.165 127.683 127.683z" fill="#DD4814"/><path d="M41.133 110.633c-9.419 0-17.05 7.631-17.05 17.05 0 9.414 7.631 17.046 17.05 17.046 9.415 0 17.046-7.632 17.046-17.046 0-9.419-7.631-17.05-17.046-17.05zm121.715 77.478c-8.153 4.71-10.95 15.13-6.24 23.279 4.705 8.154 15.125 10.949 23.279 6.24 8.153-4.705 10.949-15.125 6.24-23.28-4.705-8.148-15.131-10.943-23.279-6.239zm-84.686-60.428c0-16.846 8.368-31.73 21.171-40.742L86.87 66.067c-14.914 9.97-26.012 25.204-30.624 43.047 5.382 4.39 8.826 11.075 8.826 18.568 0 7.489-3.444 14.174-8.826 18.565C60.852 164.094 71.95 179.33 86.87 189.3l12.463-20.88c-12.803-9.007-21.171-23.89-21.171-40.737zm49.792-49.797c26.013 0 47.355 19.944 49.595 45.38l24.29-.358c-1.194-18.778-9.398-35.636-22.002-48.032-6.482 2.449-13.97 2.074-20.44-1.656-6.483-3.741-10.548-10.052-11.659-16.902a74.26 74.26 0 0 0-19.785-2.69 73.787 73.787 0 0 0-32.819 7.663l11.845 21.227a49.596 49.596 0 0 1 20.975-4.632zm0 99.59a49.601 49.601 0 0 1-20.974-4.632l-11.845 21.225a73.712 73.712 0 0 0 32.82 7.671 74.04 74.04 0 0 0 19.784-2.697c1.111-6.85 5.177-13.155 11.658-16.902 6.476-3.737 13.959-4.105 20.44-1.656 12.605-12.396 20.808-29.254 22.004-48.032l-24.297-.358c-2.235 25.443-23.576 45.38-49.59 45.38zm34.888-110.231c8.154 4.708 18.575 1.92 23.279-6.234 4.71-8.154 1.92-18.575-6.234-23.285-8.154-4.704-18.574-1.91-23.285 6.244-4.703 8.15-1.908 18.57 6.24 23.275z" fill="#FFF"/></svg>;
const DebianIcon = () => <svg viewBox="0 0 256 317" width="22" height="22"><g fill="#A80030"><path d="M152.797 167.425c-5.251.073.993 2.706 7.848 3.761a70.171 70.171 0 0 0 5.143-4.43c-4.269 1.046-8.614 1.07-12.991.67M180.98 160.4c3.127-4.315 5.406-9.04 6.21-13.926-.702 3.483-2.593 6.49-4.372 9.663-9.815 6.18-.923-3.67-.006-7.413-10.554 13.284-1.45 7.966-1.832 11.677M191.382 133.33c.635-9.455-1.86-6.466-2.7-2.857.98.508 1.754 6.665 2.7 2.858M132.886 4.088c2.802.503 6.054.888 5.598 1.557 3.066-.672 3.761-1.291-5.598-1.557M138.484 5.645l-1.98.41 1.843-.164.137-.246"/><path d="M225.866 136.916c.312 8.492-2.484 12.612-5.006 19.905l-4.538 2.268c-3.714 7.211.36 4.579-2.3 10.315-5.797 5.154-17.593 16.13-21.368 17.132-2.756-.062 1.867-3.253 2.472-4.503-7.761 5.33-6.227 8-18.097 11.238l-.347-.771c-29.274 13.771-69.937-13.52-69.402-50.76-.313 2.364-.889 1.774-1.537 2.73-1.511-19.16 8.848-38.405 26.319-46.262 17.088-8.46 37.122-4.988 49.362 6.42-6.724-8.808-20.107-18.144-35.968-17.27-15.536.245-30.07 10.12-34.921 20.837-7.96 5.012-8.883 19.318-12.352 21.936-4.666 34.296 8.778 49.114 31.52 66.544 3.58 2.414 1.009 2.78 1.494 4.617-7.557-3.539-14.476-8.88-20.165-15.42 3.018 4.419 6.276 8.714 10.487 12.089-7.124-2.414-16.641-17.264-19.42-17.868 12.281 21.988 49.827 38.562 69.486 30.34-9.096.335-20.653.186-30.874-3.592-4.293-2.209-10.13-6.785-9.088-7.641 26.83 10.023 54.546 7.591 77.762-11.02 5.906-4.599 12.358-12.424 14.222-12.532-2.808 4.222.48 2.03-1.677 5.76 5.885-9.491-2.557-3.864 6.083-16.39l3.191 4.394c-1.186-7.878 9.783-17.444 8.67-29.904 2.516-3.81 2.808 4.1.137 12.866 3.706-9.725.976-11.288 1.929-19.312 1.029 2.697 2.379 5.564 3.071 8.41-2.414-9.398 2.478-15.826 3.688-21.288-1.193-.528-3.726 4.156-4.305-6.945.085-4.822 1.342-2.528 1.827-3.714-.947-.544-3.43-4.24-4.941-11.33 1.095-1.665 2.927 4.32 4.418 4.565-.959-5.637-2.61-9.935-2.677-14.26-4.354-9.099-1.54 1.213-5.073-3.906-4.634-14.456 3.846-3.355 4.419-9.924 7.024 10.178 11.03 25.951 12.868 32.485-1.402-7.966-3.67-15.683-6.437-23.149 2.133.897-3.436-16.39 2.773-4.94-6.633-24.406-28.388-47.21-48.401-57.91 2.449 2.24 5.54 5.055 4.43 5.496-9.953-5.926-8.202-6.388-9.628-8.892-8.109-3.299-8.64.266-14.012.006-15.282-8.106-18.227-7.244-32.291-12.322l.64 2.99c-10.125-3.373-11.797 1.279-22.74.01-.666-.52 3.507-1.881 6.94-2.38-9.789 1.29-9.33-1.93-18.909.356 2.361-1.657 4.857-2.753 7.376-4.161-7.983.485-19.058 4.646-15.64.862-13.02 5.809-36.145 13.964-49.122 26.132l-.41-2.727c-5.945 7.14-25.93 21.32-27.522 30.565l-1.59.371c-3.094 5.24-5.096 11.177-7.55 16.568-4.047 6.896-5.932 2.654-5.356 3.735-7.96 16.138-11.914 29.7-15.33 40.821 2.435 3.638.059 21.9.98 36.517-3.998 72.187 50.662 142.275 110.41 158.458 8.757 3.132 21.78 3.012 32.858 3.334-13.07-3.738-14.76-1.981-27.49-6.42-9.185-4.325-11.198-9.263-17.702-14.908l2.574 4.55c-12.758-4.515-7.42-5.588-17.798-8.875l2.75-3.591c-4.135-.313-10.953-6.97-12.817-10.654l-4.523.178c-5.435-6.706-8.331-11.54-8.12-15.282l-1.462 2.603c-1.657-2.843-19.995-25.15-10.481-19.957-1.768-1.616-4.117-2.63-6.665-7.259l1.937-2.215c-4.579-5.89-8.427-13.441-8.135-15.957 2.443 3.299 4.138 3.915 5.815 4.48-11.563-28.69-12.211-1.581-20.969-29.204l1.853-.149c-1.42-2.139-2.282-4.462-3.425-6.74l.807-8.037c-8.325-9.625-2.33-40.926-1.128-58.093.832-6.98 6.948-14.412 11.6-26.065l-2.834-.488c5.417-9.45 30.933-37.952 42.75-36.485 5.724-7.19-1.137-.026-2.256-1.838 12.573-13.012 16.527-9.193 25.013-11.533 9.151-5.432-7.855 2.118-3.516-2.072 15.82-4.041 11.212-9.187 31.85-11.238 2.178 1.239-5.051 1.914-6.866 3.521 13.181-6.449 41.712-4.982 60.244 3.58 21.504 10.049 45.663 39.754 46.616 67.704l1.084.292c-.55 11.11 1.7 23.958-2.198 35.76l2.654-5.587"/><path d="M95.483 174.634l-.736 3.682c3.45 4.687 6.189 9.765 10.595 13.43-3.17-6.19-5.525-8.746-9.859-17.112M103.642 174.313c-1.827-2.02-2.908-4.45-4.117-6.873 1.157 4.257 3.526 7.916 5.733 11.636l-1.616-4.763M248.003 142.936l-.771 1.934c-1.414 10.046-4.468 19.987-9.15 29.203 5.173-9.725 8.519-20.36 9.921-31.137M133.923 1.57c3.55-1.301 8.728-.714 12.495-1.57-4.91.412-9.795.657-14.62 1.28l2.125.29M9.282 67.847c.819 7.574-5.698 10.514 1.444 5.52 3.828-8.623-1.496-2.381-1.444-5.52M.89 102.9c1.645-5.049 1.943-8.082 2.572-11.004C-1.085 97.708 1.37 98.946.89 102.9"/></g></svg>;
const CentosIcon = () => <svg viewBox="0 0 256 256" width="22" height="22" fill="none"><path d="M107.86 118.641l9.229 9.177-9.229 9.175H42.901v30.571L3.286 127.818l39.615-39.08v29.903h64.96zm28.554-78.068h78.929v78.93h-78.929v-78.93z" fill="#932279"/><path d="M137.275 107.86l-9.175 9.229-9.175-9.229V42.901H88.352L128.1 3.286l39.077 39.615h-29.902v64.96zm-.86 28.554h78.928v78.93h-78.929v-78.93z" fill="#EFA724"/><path d="M148.057 137.275l-9.23-9.175 9.23-9.175h64.958V88.352l39.617 39.748-39.617 39.077v-29.902h-64.958zm-107.484-.86h78.929v78.93H40.573v-78.93z" fill="#262577"/><path d="M118.641 148.057l9.175-9.23 9.177 9.23v64.96h30.571l-39.748 39.615-39.076-39.615h29.901v-64.96zM40.573 40.573h78.929v78.93H40.573v-78.93z" fill="#9CCD2A"/></svg>;
const WinIcon = () => <svg viewBox="0 0 256 257" width="22" height="22"><path d="M0 36.357L104.62 22.11l.045 100.914-104.57.595L0 36.358zm104.57 98.293l.08 101.002L.081 221.275l-.006-87.302 104.494.677zm12.682-114.405L255.968 0v121.74l-138.716 1.1V20.246zM256 135.6l-.033 121.191-138.716-19.578-.194-101.84L256 135.6z" fill="#00ADEF"/></svg>;
const AppleIcon = () => <svg viewBox="0 0 512 512" width="22" height="22"><path d="M433,179.67c-36.28,22.64-54.1,55.35-51.24,98.09s26,72.16,64.12,91.23c-1.93,5.46-3.67,11-5.82,16.36-11.61,29-27.93,55.21-48.05,79.09-7.66,9.1-16,17.46-26.35,23.53-14.73,8.62-30.3,9.47-46.25,4.44-9.8-3.1-19.34-7-29.09-10.31-14.28-4.79-28.79-6.64-43.92-4.41-14.52,2.15-27.59,8.38-41.24,13-10.44,3.54-21,6.53-32.25,4.81-12.29-1.88-22.58-7.91-31.37-16.28-27.28-26-47.55-56.88-62.52-91.31a315.87,315.87,0,0,1-19.68-62.2,238.91,238.91,0,0,1-4.69-63.59c2-31.38,11.34-60.46,31.25-85.28a114.72,114.72,0,0,1,64.75-40.94c13.12-3.11,26.17-4.19,39.2-1.22,9.84,2.25,19.39,5.88,29,9s18.89,6.57,28.44,9.51c5.66,1.74,11.3.4,16.78-1.51,14.3-5,28.51-10.26,43-14.8,15-4.7,30.23-6.6,46.08-4.28,15,2.21,29.28,6.27,42.75,13.16,14.69,7.51,26.29,18.58,36.13,31.64A12,12,0,0,1,433,179.67Z" fill="#bac2d3"/><path d="M250.57,126.44C243.07,82.06,283.51,22,346.13,16c0,5.69.39,11.35-.07,16.93-2.37,28.68-15.65,52-36.11,71.52-12.71,12.12-27.88,19.68-45.4,21.9C260,126.92,255.37,126.44,250.57,126.44Z" fill="#dae1ea"/></svg>;
const LinuxIcon = () => <img src="/linux.svg" width="22" height="22" alt="Linux" />;

const KaliIcon       = () => <img src="/kali.svg" width="22" height="22" alt="Kali" />;
const AlmaIcon = () => <svg viewBox="-.186 -.269 61.4 60" width="22" height="22" fill="none"><path d="m56.114 33.731c2.6-.2 4.7 1.5 4.9 4.1.2 2.7-1.7 4.9-4.3 5.1-2.5.2-4.7-1.7-4.9-4.2-.2-2.7 1.6-4.7 4.3-5z" fill="#86da2f"/><path d="m24.514 55.031c0-2.6 2-4.6 4.4-4.6s4.7 2.2 4.7 4.7c0 2.4-2 4.5-4.3 4.6-2.9 0-4.8-1.8-4.8-4.7z" fill="#24c2ff"/><path d="m31.614 25.831c-.4.2-.6-.1-.7-.4-3.7-6.9-2.6-15.6 3.9-20.8 1.7-1.4 4.9-1.7 6.3-.3.6.5.7 1.1.8 1.8.2 1.5.5 3 1.5 4.2 1.1 1.3 2.5 1.8 4.1 1.7 1.4 0 2.8-.2 3.7 1.4.5.9.3 4.4-.5 5.1-.4.3-.7.1-1 0-2.3-.9-4.7-.9-7.1-.5-.8.1-1.2-.1-1.2-1-.1-1.5-.4-2.9-1.2-4.2-1.5-2.7-4.3-2.8-6.1-.3-1.5 2-1.9 4.4-2.3 6.8-.4 2.1-.3 4.3-.2 6.5z" fill="#ffcb12"/><path d="m34.114 27.331c-.2-.3-.1-.6.2-.8 5.7-5.2 14.2-6.2 20.8-1.1 1.7 1.4 2.8 4.3 1.9 6-.4.7-.9 1-1.5 1.2-1.4.6-2.7 1.2-3.6 2.5s-1.1 2.8-.7 4.4c.3 1.3.8 2.7-.5 3.9-.7.7-4.1 1.3-5 .7-.4-.3-.3-.6-.2-1 .3-2.5-.3-4.8-1.2-7-.3-.8-.2-1.2.6-1.4 1.4-.4 2.7-1.1 3.7-2.1 2.2-2.1 1.7-4.8-1.2-6-2.3-1-4.7-.8-7-.6-2.2.1-4.3.7-6.3 1.3z" fill="#86da2f"/><path d="m32.814 29.931c.3-.3.5-.2.8 0 6.6 4 10 11.9 7 19.6-.8 2-3.4 4-5.3 3.5-.8-.2-1.2-.6-1.6-1.1-.9-1.2-1.9-2.3-3.4-2.8-1.6-.5-3-.2-4.4.6-1.2.7-2.4 1.6-3.9.7-.9-.5-2.4-3.6-2.1-4.6.2-.4.6-.4 1-.4 2.5-.4 4.5-1.6 6.4-3.2.6-.5 1.1-.5 1.6.2.8 1.2 1.8 2.2 3.1 2.9 2.6 1.5 5.1.2 5.4-2.8.3-2.5-.6-4.7-1.4-6.9-.9-2-2-3.9-3.2-5.7z" fill="#24c2ff"/><path d="m29.614 30.531c-.4 2-1.3 3.9-2.5 5.6-3.6 5.4-8.8 7.6-15.2 7-2.3-.2-4.2-2.1-4.4-4-.1-.8.1-1.4.6-2 .7-.9 1.3-1.7 1.6-2.8.6-2.2-.2-4-1.8-5.6-2.2-2.2-1.9-4.2.7-5.8.3-.2.7-.4 1.1-.6.6-.3 1.1-.3 1.3.4.9 2.3 2.7 4 4.7 5.4.7.6.7 1 .1 1.7-1.2 1.3-1.9 2.9-2 4.7-.2 2.2 1.1 3.6 3.3 3.6 1.4 0 2.7-.5 3.9-1.1 3.1-1.6 5.5-3.9 7.8-6.3.3-.1.4-.3.8-.2z" fill="#0069da"/><path d="m13.214 9.531c.2 0 .7.1 1.2.2 3.7.7 6-.6 7.2-4.1.8-2.3 2.5-3 4.7-1.8.1 0 .1.1.2.1 2.3 1.3 2.3 1.5.9 3.5-1.2 1.6-1.8 3.4-2.1 5.3-.2 1.1-.6 1.3-1.6.9-1.6-.6-3.3-.6-5 0-1.9.6-2.7 2.3-2.1 4.2.8 2.5 3 3.6 4.9 4.9s4.1 2 6.2 2.9c.3.1.8.1.7.6-.1.3-.5.3-.9.3-4.5.2-8.8-.5-12.3-3.5-3.3-2.7-5.7-6-5.3-10.6.3-1.5 1.4-2.6 3.3-2.9z" fill="#ff4649"/><path d="m5.014 37.631c-2.4.3-4.8-1.7-5-4.2-.2-2.4 1.8-4.8 4.1-5 2.6-.3 5 1.5 5.2 3.9.1 2.3-1.4 5.1-4.3 5.3z" fill="#0069da"/><path d="m47.014 2.031c2.5-.2 4.9 1.8 5.1 4.3.2 2.4-1.8 4.7-4.2 4.9-2.6.2-4.9-1.7-5.1-4.2s1.6-4.8 4.2-5z" fill="#ffcb12"/><path d="m20.914 3.931c.3 2.6-1.5 4.8-4.2 5.2-2.3.3-4.7-1.6-5-3.8-.3-2.9 1.3-5 4-5.3 2.5-.3 4.9 1.6 5.2 3.9z" fill="#ff4649"/></svg>;
const RockyIcon = () => <svg viewBox="0 0.28 799.99 799.44" width="22" height="22"><path d="M777.73 531.82c14.42-41.27 22.26-85.63 22.26-131.82C799.99 179.24 620.9.28 399.99.28S0 179.24 0 400c0 109.23 43.85 208.23 114.91 280.38l405.74-405.47 100.17 100.11zm-73.06 127.19L520.65 475.12 232.49 763.09c50.95 23.51 107.69 36.63 167.5 36.63 122.04 0 231.31-54.61 304.68-140.71z" fill="#10b981"/></svg>;
const OracleIcon     = () => <img src="/oracle.svg" width="22" height="22" alt="Oracle" />;
const AnolisIcon     = () => <img src="/Anolis.png" width="22" height="22" alt="Anolis" />;
const OpenCloudIcon  = () => <img src="/OpenCloudOS.ico" width="22" height="22" alt="OpenCloudOS" />;
const OpenEulerIcon  = () => <img src="/openEuler.ico" width="22" height="22" alt="openEuler" />;
const OpenSuseIcon   = () => <img src="/openSUSE.ico" width="22" height="22" alt="openSUSE" />;
const NixosIcon      = () => <img src="/nixos.svg" width="22" height="22" alt="NixOS" />;
const GentooIcon     = () => <img src="/gentoo.svg" width="22" height="22" alt="Gentoo" />;
const AoscIcon       = () => <img src="/aosc.svg" width="22" height="22" alt="AOSC" />;
const RhelIcon       = () => <img src="/rhel.svg" width="22" height="22" alt="RHEL" />;
const FedoraIcon     = () => <img src="/fedora.svg" width="22" height="22" alt="Fedora" />;
const ArchIcon       = () => <img src="/arch.svg" width="22" height="22" alt="Arch" />;
const AlpineIcon = () => <svg viewBox="0 0 512 512" width="22" height="22"><path d="M384.0214844,34.2768898H127.978508L0,255.9999084L127.978508,477.723114h256.0429688L512,255.9999084L384.0214844,34.2768898z M147.1620636,295.4020996l38.8415833-38.8828735v53.9402161C172.375,310.1666565,159.3208008,303.9169312,147.1620636,295.4020996z M299.767334,305.9755859c-23.7467957-24.4812622-54.3271942-55.1417084-87.5346832-88.1777344l-88.9374542,87.9747314C109.2761688,315.6438599,85.875,308.75,67.474205,295.3641663L212.593811,151.8847504c45.9142151,48.2947998,93.569458,96.1930847,143.0358276,143.6788788C331.7724915,312.664978,310.25,313.875,299.767334,305.9755859z M384.5819397,305.9755859l-71.3183899-71.0779419l-7.1147766,7.1147919l-33.2984924-32.9348145l40.4304199-40.4402924c43.1062317,43.4316711,85.4614258,86.1768494,127.1635132,126.9263C419.875,310.3125,397.0625,315.375,384.5819397,305.9755859z" fill="#0d597f"/></svg>;
const FreeBSDIcon = () => <svg viewBox="0 0 256 252" width="22" height="22"><g fill="#B5010F"><path d="M252.723 5.11c13.508 13.5-23.939 72.848-30.27 79.182-6.33 6.321-22.409.505-35.91-13-13.508-13.5-19.327-29.583-12.996-35.914 6.327-6.333 65.671-43.777 79.176-30.269M63.305 19.394c-20.622-11.7-49.966-24.716-59.3-15.38-9.458 9.454 4.034 39.458 15.858 60.117a126.812 126.812 0 0 1 43.442-44.737"/><path d="M232.123 79.636c1.899 6.44 1.558 11.76-1.522 14.834-7.193 7.196-26.624-.464-44.14-17.134a89.383 89.383 0 0 1-3.627-3.428c-6.334-6.336-11.262-13.08-14.414-19.291-6.135-11.006-7.67-20.726-3.033-25.364 2.527-2.524 6.57-3.212 11.502-2.325 3.216-2.034 7.013-4.3 11.176-6.621-16.929-8.83-36.176-13.817-56.593-13.817C63.753 6.49 8.854 61.38 8.854 129.105c0 67.713 54.9 122.61 122.618 122.61 67.72 0 122.616-54.897 122.616-122.61 0-21.87-5.74-42.377-15.767-60.156-2.167 3.955-4.274 7.578-6.198 10.687"/></g></svg>;
const TencentIcon = () => <img src="/TencentOS.svg" width="22" height="22" alt="TencentOS" />;
const AlibabaIcon = () => <img src="/Alibaba.svg" width="22" height="22" alt="Alibaba" />;

// 检测OS，支持静态名称匹配和动态 osInfo 对象
// 使用模块级缓存避免每次渲染都创建新 JSX 元素（性能优化）
const _osInfoCache = new Map();
const getOSInfo = (name = '', os = '', osInfo = null) => {
  // 优先用连接后实际查询到的系统信息
  const dynStr = (osInfo?.os || osInfo?.platform || '').toLowerCase();
  const n = dynStr || (name + ' ' + (os || '')).toLowerCase();
  // 缓存键：仅依赖输入字符串，JSX 元素可安全复用
  if (_osInfoCache.has(n)) return _osInfoCache.get(n);
  let result;
  // ── 发行版检测（按优先级排列）──
  if (n.includes('ubuntu'))       result = { icon: <UbuntuIcon />, bg: 'var(--surface-overlay)', label: 'Ubuntu' };
  else if (n.includes('debian'))       result = { icon: <DebianIcon />, bg: 'var(--surface-overlay)', label: 'Debian' };
  else if (n.includes('kali'))         result = { icon: <KaliIcon />, bg: 'var(--surface-overlay)', label: 'Kali' };
  else if (n.includes('centos stream'))result = { icon: <CentosIcon />, bg: 'var(--surface-overlay)', label: 'CentOS Stream' };
  else if (n.includes('tencent'))     result = { icon: <TencentIcon />, bg: 'var(--surface-overlay)', label: 'TencentOS' };
  else if (n.includes('centos'))       result = { icon: <CentosIcon />, bg: 'var(--surface-overlay)', label: 'CentOS' };
  else if (n.includes('rhel'))         result = { icon: <RhelIcon />, bg: 'var(--surface-overlay)', label: 'RHEL' };
  else if (n.includes('almalinux'))    result = { icon: <AlmaIcon />, bg: 'var(--surface-overlay)', label: 'AlmaLinux' };
  else if (n.includes('rocky'))        result = { icon: <RockyIcon />, bg: 'var(--surface-overlay)', label: 'Rocky' };
  else if (n.includes('oracle'))       result = { icon: <OracleIcon />, bg: 'var(--surface-overlay)', label: 'Oracle' };
  else if (n.includes('alibaba') || n.includes('aliyun')) result = { icon: <AlibabaIcon />, bg: 'var(--surface-overlay)', label: 'Alibaba' };
  else if (n.includes('anolis'))       result = { icon: <AnolisIcon />, bg: 'var(--surface-overlay)', label: 'Anolis' };
  else if (n.includes('opencloudos'))  result = { icon: <OpenCloudIcon />, bg: 'var(--surface-overlay)', label: 'OpenCloudOS' };
  else if (n.includes('openeuler'))    result = { icon: <OpenEulerIcon />, bg: 'var(--surface-overlay)', label: 'openEuler' };
  else if (n.includes('fedora'))       result = { icon: <FedoraIcon />, bg: 'var(--surface-overlay)', label: 'Fedora' };
  else if (n.includes('opensuse'))     result = { icon: <OpenSuseIcon />, bg: 'var(--surface-overlay)', label: 'openSUSE' };
  else if (n.includes('arch'))         result = { icon: <ArchIcon />, bg: 'var(--surface-overlay)', label: 'Arch' };
  else if (n.includes('nixos'))        result = { icon: <NixosIcon />, bg: 'var(--surface-overlay)', label: 'NixOS' };
  else if (n.includes('alpine'))       result = { icon: <AlpineIcon />, bg: 'var(--surface-overlay)', label: 'Alpine' };
  else if (n.includes('gentoo'))       result = { icon: <GentooIcon />, bg: 'var(--surface-overlay)', label: 'Gentoo' };
  else if (n.includes('aosc'))         result = { icon: <AoscIcon />, bg: 'var(--surface-overlay)', label: 'AOSC' };
  else if (n.includes('freebsd'))      result = { icon: <FreeBSDIcon />, bg: 'var(--surface-overlay)', label: 'FreeBSD' };
  // ── 非 Linux 系统 ──
  else if (n.includes('windows'))      result = { icon: <WinIcon />, bg: 'var(--surface-overlay)', label: 'Windows' };
  else if (n.includes('mac') || n.includes('darwin')) result = { icon: <AppleIcon />, bg: 'var(--surface-overlay)', label: 'macOS' };
  // ── 环境关键词（基于服务器名称）──
  else if (n.includes('prod') || n.includes('生产'))  result = { icon: <LinuxIcon />, bg: '#059669', label: 'Prod' };
  else if (n.includes('dev') || n.includes('开发'))   result = { icon: <LinuxIcon />, bg: '#7c3aed', label: 'Dev' };
  else if (n.includes('test') || n.includes('测试'))  result = { icon: <LinuxIcon />, bg: '#dc2626', label: 'Test' };
  else if (n.includes('db') || n.includes('数据'))    result = { icon: <LinuxIcon />, bg: '#b45309', label: 'DB' };
  else if (n.includes('web') || n.includes('nginx'))  result = { icon: <LinuxIcon />, bg: '#0891b2', label: 'Web' };
  else result = { icon: <LinuxIcon />, bg: 'var(--surface-sunken)', label: 'Linux' };
  _osInfoCache.set(n, result);
  return result;
};

export default function ServerList({
  servers,
  pings,
  sessions,
  activeSessionId,
  viewMode = 'grid',
  hideSensitive = false,
  onConnect,
  onEdit,
  onDelete,
}) {
  const { t } = useTranslation();
  const [menuServer, setMenuServer] = useState(null);
  const [menuPos, setMenuPos] = useState({ x: 0, y: 0 });
  const [hoveredId, setHoveredId] = useState(null);
  const menuRef = useRef(null);

  // 预计算已连接会话的 Map，将 O(n×m) 查找优化为 O(1)
  const connectedSessionMap = useMemo(() => {
    const m = new Map();
    sessions.forEach(s => {
      if (s.status === 'connected') m.set(s.serverId, s);
    });
    return m;
  }, [sessions]);

  const mask = (text) => hideSensitive ? String(text || '').replace(/[^@.:\/\s-]/g, '*') : text;

  // Close context menu on outside click
  useEffect(() => {
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuServer(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  useEffect(() => {
    if (!menuServer || !menuRef.current) return;

    const { offsetWidth, offsetHeight } = menuRef.current;
    setMenuPos((prev) => {
      const next = clampMenuPosition(prev.x, prev.y, offsetWidth, offsetHeight);
      if (next.x === prev.x && next.y === prev.y) return prev;
      return next;
    });
  }, [menuServer]);

  const handleContextMenu = (e, server) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuServer(server);
    setMenuPos(clampMenuPosition(e.clientX, e.clientY, MENU_ESTIMATED_WIDTH, MENU_ESTIMATED_HEIGHT));
  };

  const isActive = (server) => {
    const session = sessions.find(
      (s) => s.serverId === server.id && s.status !== 'closed'
    );
    return session && session.id === activeSessionId;
  };

  const hasSession = (server) =>
    sessions.some((s) => s.serverId === server.id && s.status !== 'closed');

  if (servers.length === 0) {
    return (
      <div className="empty-state" style={{ marginTop: 20 }}>
        <div className="empty-state-icon" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Monitor size={48} strokeWidth={1.5} /></div>
        <div className="empty-state-text">
          {t('暂无服务器')}
          <br />
          {t('点击右上角「添加」开始')}
        </div>
      </div>
    );
  }

  return (
    <>
      {viewMode === 'grid' ? (
      <div className="server-grid">
        {servers.map((server) => {
          const ping = pings[server.id];
          const latClass = ping ? LATENCY_CLASS(ping.latency) : 'offline';
          const active = isActive(server);
          const connected = hasSession(server);
          // 优先用实际查询到的 osInfo
          const sessionForServer = connectedSessionMap.get(server.id);
          const osInfo = getOSInfo(server.name, server.os, sessionForServer?.osInfo || null);
          const isHovered = hoveredId === server.id;

          return (
            <div
              key={server.id}
              className={`server-card ${active ? 'active' : ''}`}
              onClick={() => onConnect(server)}
              onContextMenu={(e) => handleContextMenu(e, server)}
              onMouseEnter={() => setHoveredId(server.id)}
              onMouseLeave={() => setHoveredId(null)}
              title={`${server.username}@${server.host}:${server.port || 22}`}
              style={{
                margin: 0,
                // 亚克力效果
                background: active
                  ? 'var(--success-dim)'
                  : isHovered
                  ? 'var(--surface-hover)'
                  : 'var(--surface-sunken)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                border: active
                  ? '1px solid var(--success-glow)'
                  : '1px solid var(--border)',
                transition: 'all 0.18s ease',
                boxShadow: active
                  ? '0 4px 20px rgba(var(--success-rgb), 0.15)'
                  : isHovered
                  ? 'var(--shadow-lg)'
                  : 'var(--shadow-md)',
              }}
            >
              {/* OS 系统图标 */}
              <div style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                background: osInfo.bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 22,
                flexShrink: 0,
                boxShadow: `0 4px 12px ${osInfo.bg}55`,
              }}>
                {osInfo.icon}
              </div>

              <div className="server-info" style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1, minWidth: 0 }}>
                <div className="server-name" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, color: 'var(--text-primary)', fontWeight: 500 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {server.name || server.host}
                  </span>
                  {connected && (
                    <span style={{ fontSize: 8, color: 'var(--success)', fontFamily: 'var(--font-mono)', flexShrink: 0 }}>
                      ● {t('已连接')}
                    </span>
                  )}
                </div>
                <div className="server-host" style={{ color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {hideSensitive ? mask(`${server.username}@${server.host}`) : `${server.username}@${server.host}:${server.port || 22}`}
                </div>
              </div>

              {/* 右侧：延迟 + 编辑按钮 */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                {ping?.online && ping?.latency !== undefined && ping?.latency !== null ? (
                  <>
                    <span style={{
                      fontSize: 11,
                      fontFamily: 'var(--font-mono)',
                      color: latClass === 'good' ? 'var(--success)'
                           : latClass === 'warn' ? 'var(--warning)'
                           : 'var(--danger)',
                    }}>
                      {ping.latency === -1 ? t('<1毫秒') : `${ping.latency}${t('毫秒')}`}
                    </span>
                    <div style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: latClass === 'good' ? 'var(--success)'
                                : latClass === 'warn' ? 'var(--warning)'
                                : 'var(--danger)',
                      boxShadow: latClass === 'good' ? '0 0 8px var(--success-glow)'
                               : latClass === 'warn' ? '0 0 8px var(--warning)'
                               : '0 0 8px var(--danger-glow)',
                    }} />
                  </>
                ) : (
                  ping !== undefined && !ping?.online ? (
                    <span style={{ fontSize: 14, color: 'var(--danger)', fontWeight: 'bold', lineHeight: 1 }} title={t('服务器离线或不可达')}><X size={14} /></span>
                  ) : null
                )}

                {/* 编辑按钮 */}
                <button
                  onClick={(e) => { e.stopPropagation(); onEdit(server); }}
                  title={t('编辑服务器')}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    padding: '4px 6px',
                    borderRadius: 6,
                    color: isHovered ? 'var(--text-primary)' : 'var(--text-muted)',
                    fontSize: 14,
                    opacity: isHovered ? 1 : 0,
                    transition: 'all 0.15s',
                    display: 'flex',
                    alignItems: 'center',
                  }}
                >
                  <SquarePen size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      ) : (
      <div className="server-table-container">
        <table className="server-table">
          <thead>
            <tr>
              <th>{t('系统')}</th>
              <th>{t('别名')}</th>
              <th>{t('主机地址')}</th>
              <th>{t('用户名')}</th>
              <th>{t('状态')}</th>
              <th>{t('操作')}</th>
            </tr>
          </thead>
          <tbody>
            {servers.map((server) => {
              const ping = pings[server.id];
              const latClass = ping ? LATENCY_CLASS(ping.latency) : 'offline';
              const active = isActive(server);
              const connected = hasSession(server);
              const sessionForServer = connectedSessionMap.get(server.id);
              const osInfo = getOSInfo(server.name, server.os, sessionForServer?.osInfo || null);
              const isHovered = hoveredId === server.id;

              return (
                <tr
                  key={server.id}
                  className={`server-table-row ${active ? 'active' : ''}`}
                  onClick={() => onConnect(server)}
                  onContextMenu={(e) => handleContextMenu(e, server)}
                  onMouseEnter={() => setHoveredId(server.id)}
                  onMouseLeave={() => setHoveredId(null)}
                >
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 20, height: 20, color: osInfo.bg }}>{osInfo.icon}</div>
                      <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{osInfo.label}</span>
                    </div>
                  </td>
                  <td style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                    {server.name || server.host}
                    {connected && <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--success)', padding: '2px 4px', background: 'var(--success-dim)', borderRadius: 4 }}>{t('已连接')}</span>}
                  </td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-secondary)' }}>
                    {hideSensitive ? mask(server.host) : `${server.host}:${server.port || 22}`}
                  </td>
                  <td style={{ color: 'var(--text-secondary)' }}>{hideSensitive ? mask(server.username) : server.username}</td>
                  <td>
                    {ping?.online && ping?.latency !== undefined && ping?.latency !== null ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <div style={{
                          width: 8, height: 8, borderRadius: '50%',
                          background: latClass === 'good' ? 'var(--success)' : latClass === 'warn' ? 'var(--warning)' : 'var(--danger)'
                        }} />
                        <span style={{ fontSize: 12, color: latClass === 'good' ? 'var(--success)' : latClass === 'warn' ? 'var(--warning)' : 'var(--danger)', fontFamily: 'var(--font-mono)' }}>
                          {ping.latency === -1 ? t('<1毫秒') : `${ping.latency}${t('毫秒')}`}
                        </span>
                      </div>
                    ) : (
                      ping !== undefined && !ping?.online ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--danger)' }}>
                          <X size={14} />
                          <span style={{ fontSize: 12 }}>{t('离线')}</span>
                        </div>
                      ) : <span style={{ color: 'var(--text-muted)' }}>-</span>
                    )}
                  </td>
                  <td>
                    <button
                      onClick={(e) => { e.stopPropagation(); onEdit(server); }}
                      className="btn btn-ghost btn-sm"
                      style={{ padding: '4px 8px', fontSize: 12 }}
                    >
                      {t('编辑')}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {/* Context Menu */}
      {menuServer && (
        <div
          ref={menuRef}
          className="context-menu"
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          <div
            className="context-menu-item"
            onClick={() => { onConnect(menuServer); setMenuServer(null); }}
          >
            <Link size={14} style={{ marginRight: 8 }} /> {t('连接')}
          </div>
          <div
            className="context-menu-item"
            onClick={() => { onEdit(menuServer); setMenuServer(null); }}
          >
            <SquarePen size={14} style={{ marginRight: 8 }} /> {t('编辑配置')}
          </div>
          <div className="context-menu-divider" />
          <div
            className="context-menu-item danger"
            onClick={async () => {
              if (await window.luminDialog?.confirm(`${t('确定删除服务器')}「${menuServer.name || menuServer.host}」？`)) {
                onDelete(menuServer.id);
              }
              setMenuServer(null);
            }}
          >
            <Trash2 size={14} style={{ marginRight: 8 }} /> {t('删除')}
          </div>
        </div>
      )}
    </>
  );
}
