interface TerminalEncodingOption {
  value: string;
  label: string;
}

export interface TerminalEncodingGroup {
  label: string;
  options: TerminalEncodingOption[];
}

export const TERMINAL_ENCODING_GROUPS: TerminalEncodingGroup[] = [
  {
    label: 'Unicode',
    options: [
      { value: 'utf-8', label: 'UTF-8' }
    ]
  },
  {
    label: 'ASCII',
    options: [
      { value: 'us-ascii', label: 'US-ASCII' }
    ]
  },
  {
    label: '简体中文',
    options: [
      { value: 'gb18030', label: 'GB18030' },
      { value: 'gbk', label: 'GBK' },
      { value: 'hz-gb-2312', label: 'HZ-GB-2312' }
    ]
  },
  {
    label: '繁体中文',
    options: [
      { value: 'big5', label: 'Big5' }
    ]
  },
  {
    label: '日文',
    options: [
      { value: 'shift_jis', label: 'Shift_JIS' },
      { value: 'euc-jp', label: 'EUC-JP' },
      { value: 'iso-2022-jp', label: 'ISO-2022-JP' }
    ]
  },
  {
    label: '韩文',
    options: [
      { value: 'euc-kr', label: 'EUC-KR' }
    ]
  },
  {
    label: 'ISO-8859',
    options: [
      { value: 'iso-8859-1', label: 'ISO-8859-1' },
      { value: 'iso-8859-2', label: 'ISO-8859-2' },
      { value: 'iso-8859-3', label: 'ISO-8859-3' },
      { value: 'iso-8859-4', label: 'ISO-8859-4' },
      { value: 'iso-8859-5', label: 'ISO-8859-5' },
      { value: 'iso-8859-6', label: 'ISO-8859-6' },
      { value: 'iso-8859-6-e', label: 'ISO-8859-6-E' },
      { value: 'iso-8859-6-i', label: 'ISO-8859-6-I' },
      { value: 'iso-8859-7', label: 'ISO-8859-7' },
      { value: 'iso-8859-8', label: 'ISO-8859-8' },
      { value: 'iso-8859-8-e', label: 'ISO-8859-8-E' },
      { value: 'iso-8859-8-i', label: 'ISO-8859-8-I' },
      { value: 'iso-8859-9', label: 'ISO-8859-9' },
      { value: 'iso-8859-10', label: 'ISO-8859-10' },
      { value: 'iso-8859-13', label: 'ISO-8859-13' },
      { value: 'iso-8859-14', label: 'ISO-8859-14' },
      { value: 'iso-8859-15', label: 'ISO-8859-15' },
      { value: 'iso-8859-16', label: 'ISO-8859-16' }
    ]
  },
  {
    label: 'Windows',
    options: [
      { value: 'windows-874', label: 'windows-874' },
      { value: 'windows-1250', label: 'windows-1250' },
      { value: 'windows-1251', label: 'windows-1251' },
      { value: 'windows-1252', label: 'windows-1252' },
      { value: 'windows-1253', label: 'windows-1253' },
      { value: 'windows-1254', label: 'windows-1254' },
      { value: 'windows-1255', label: 'windows-1255' },
      { value: 'windows-1256', label: 'windows-1256' },
      { value: 'windows-1257', label: 'windows-1257' },
      { value: 'windows-1258', label: 'windows-1258' }
    ]
  },
  {
    label: 'Cyrillic',
    options: [
      { value: 'koi8-r', label: 'KOI8-R' },
      { value: 'koi8-u', label: 'KOI8-U' }
    ]
  },
  {
    label: 'Mac',
    options: [
      { value: 'macintosh', label: 'Macintosh' }
    ]
  },
  {
    label: 'IBM/OEM/EBCDIC',
    options: [
      { value: 'ibm037', label: 'IBM037' },
      { value: 'ibm437', label: 'IBM437' },
      { value: 'ibm850', label: 'IBM850' },
      { value: 'ibm852', label: 'IBM852' },
      { value: 'ibm855', label: 'IBM855' },
      { value: 'ibm858', label: 'IBM858' },
      { value: 'ibm860', label: 'IBM860' },
      { value: 'ibm862', label: 'IBM862' },
      { value: 'ibm863', label: 'IBM863' },
      { value: 'ibm865', label: 'IBM865' },
      { value: 'ibm866', label: 'IBM866' },
      { value: 'ibm1047', label: 'IBM1047' },
      { value: 'ibm01140', label: 'IBM01140' }
    ]
  }
]
