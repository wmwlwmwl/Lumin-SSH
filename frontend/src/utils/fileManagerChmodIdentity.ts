// chmod 八进制 <-> 权限矩阵换算，以及属主/属组身份候选项解析

export interface ChmodPerms {
  user: { r: boolean; w: boolean; x: boolean }
  group: { r: boolean; w: boolean; x: boolean }
  other: { r: boolean; w: boolean; x: boolean }
}

export interface IdentityPresetOption {
  id: string
  name: string
}

export interface IdentityOption extends IdentityPresetOption {
  label: string
  searchText: string
}

export function normalizeChmodMode(value: unknown) {
  const cleaned = String(value || '').replace(/[^0-7]/g, '');
  if (cleaned.length === 4 && cleaned[0] === '0') {
    return cleaned.slice(1);
  }
  return cleaned.slice(0, 3);
}

export function calcChmodOctal(perms: ChmodPerms) {
  const u = (perms.user.r ? 4 : 0) + (perms.user.w ? 2 : 0) + (perms.user.x ? 1 : 0);
  const g = (perms.group.r ? 4 : 0) + (perms.group.w ? 2 : 0) + (perms.group.x ? 1 : 0);
  const o = (perms.other.r ? 4 : 0) + (perms.other.w ? 2 : 0) + (perms.other.x ? 1 : 0);
  return `${u}${g}${o}`;
}

export function permsFromChmodMode(modeStr: unknown): ChmodPerms {
  const normalized = normalizeChmodMode(modeStr) || '644';
  const u = parseInt(normalized[0], 8);
  const g = parseInt(normalized[1], 8);
  const o = parseInt(normalized[2], 8);
  return {
    user: { r: !!(u & 4), w: !!(u & 2), x: !!(u & 1) },
    group: { r: !!(g & 4), w: !!(g & 2), x: !!(g & 1) },
    other: { r: !!(o & 4), w: !!(o & 2), x: !!(o & 1) },
  };
}

export const CHMOD_OWNER_PRESET_OPTIONS = [
  { id: '0', name: 'root' },
  { id: '26', name: 'postgres' },
  { id: '27', name: 'mysql' },
  { id: '33', name: 'www-data' },
  { id: '101', name: 'nginx' },
  { id: '999', name: 'redis' },
  { id: '1000', name: 'ubuntu' },
  { id: '65534', name: 'nobody' },
];

export const CHMOD_GROUP_PRESET_OPTIONS = [
  { id: '0', name: 'root' },
  { id: '4', name: 'adm' },
  { id: '10', name: 'wheel' },
  { id: '27', name: 'sudo' },
  { id: '33', name: 'www-data' },
  { id: '101', name: 'nginx' },
  { id: '999', name: 'redis' },
  { id: '1000', name: 'users' },
  { id: '65534', name: 'nogroup' },
];

export function normalizeIdentityId(value: unknown) {
  const trimmed = String(value ?? '').trim();
  return trimmed && trimmed !== '-' ? trimmed : '';
}

export function formatIdentityDisplay(name: unknown, id: unknown) {
  const normalizedId = normalizeIdentityId(id);
  if (!normalizedId) {
    return '-';
  }
  const trimmedName = String(name || '').trim();
  return trimmedName ? `${trimmedName}(${normalizedId})` : normalizedId;
}

export function formatPermissionDisplay(permission: unknown) {
  return String(permission || '-').trim() || '-';
}

export function buildIdentityOptionList(currentId: unknown, presets: IdentityPresetOption[]): IdentityOption[] {
  const normalizedCurrentId = normalizeIdentityId(currentId);
  const presetOptions = Array.isArray(presets) ? presets : [];
  const currentOption = normalizedCurrentId
    ? (presetOptions.find((item) => normalizeIdentityId(item.id) === normalizedCurrentId) || { id: normalizedCurrentId, name: '' })
    : null;
  const options = currentOption
    ? [currentOption, ...presetOptions.filter((item) => normalizeIdentityId(item.id) !== normalizedCurrentId)]
    : presetOptions;
  const seen = new Set();
  return options
    .map((item) => {
      const id = normalizeIdentityId(item.id);
      if (!id) {
        return null;
      }
      const name = String(item.name || '').trim();
      const label = formatIdentityDisplay(name, id);
      return {
        id,
        name,
        label,
        searchText: `${name} ${id} ${label}`.toLowerCase(),
      };
    })
    .filter((item): item is IdentityOption => {
      if (!item || seen.has(item.label)) {
        return false;
      }
      seen.add(item.label);
      return true;
    });
}

export function resolveIdentityInputValue(currentId: unknown, presets: IdentityPresetOption[]) {
  const normalizedCurrentId = normalizeIdentityId(currentId);
  if (!normalizedCurrentId) {
    return '-';
  }
  const matched = (Array.isArray(presets) ? presets : []).find((item) => normalizeIdentityId(item.id) === normalizedCurrentId);
  return formatIdentityDisplay(matched?.name || '', normalizedCurrentId);
}

export function resolveIdentityInputSpec(value: unknown, options: IdentityPresetOption[], fallbackId: unknown = '') {
  const trimmed = String(value ?? '').trim();
  const candidates = Array.isArray(options) ? options : [];
  if (!trimmed || trimmed === '-') {
    return normalizeIdentityId(fallbackId);
  }
  const matched = candidates.find((item) => {
    const normalizedId = normalizeIdentityId(item.id);
    const label = formatIdentityDisplay(item.name, normalizedId);
    return trimmed === label || trimmed === String(item.name || '').trim() || trimmed === normalizedId;
  });
  if (matched) {
    return String(matched.name || '').trim() || normalizeIdentityId(matched.id);
  }
  const labelMatch = trimmed.match(/^(.*)\(([^()]+)\)$/);
  if (labelMatch) {
    const name = String(labelMatch[1] || '').trim();
    const id = normalizeIdentityId(labelMatch[2]);
    return name || id || normalizeIdentityId(fallbackId);
  }
  return trimmed;
}

export function resolveIdentityCompareKey(value: unknown, options: IdentityPresetOption[], fallbackId: unknown = '') {
  const trimmed = String(value ?? '').trim();
  const fallback = normalizeIdentityId(fallbackId);
  const candidates = Array.isArray(options) ? options : [];
  if (!trimmed || trimmed === '-') {
    return fallback ? `id:${fallback}` : '';
  }
  const matched = candidates.find((item) => {
    const normalizedId = normalizeIdentityId(item.id);
    const label = formatIdentityDisplay(item.name, normalizedId);
    return trimmed === label || trimmed === String(item.name || '').trim() || trimmed === normalizedId;
  });
  if (matched) {
    const normalizedId = normalizeIdentityId(matched.id);
    if (normalizedId) {
      return `id:${normalizedId}`;
    }
    const normalizedName = String(matched.name || '').trim().toLowerCase();
    return normalizedName ? `name:${normalizedName}` : '';
  }
  const labelMatch = trimmed.match(/^(.*)\(([^()]+)\)$/);
  if (labelMatch) {
    const name = String(labelMatch[1] || '').trim().toLowerCase();
    const id = normalizeIdentityId(labelMatch[2]);
    if (id) {
      return `id:${id}`;
    }
    return name ? `name:${name}` : '';
  }
  if (/^\d+$/.test(trimmed)) {
    return `id:${trimmed}`;
  }
  return `name:${trimmed.toLowerCase()}`;
}
