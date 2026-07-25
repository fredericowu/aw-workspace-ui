

const ANSI_REGEX = /\x1b\[([0-9;]*)m/g;

const CODE_MAP = {
  '0': '',
  '1': 'ansi-bold',
  '2': 'ansi-dim',
  '4': 'ansi-underline',
  '30': 'ansi-black',
  '31': 'ansi-red',
  '32': 'ansi-green',
  '33': 'ansi-yellow',
  '34': 'ansi-blue',
  '35': 'ansi-magenta',
  '36': 'ansi-cyan',
  '37': 'ansi-white',
  '90': 'ansi-bright-black',
  '91': 'ansi-bright-red',
  '92': 'ansi-bright-green',
  '93': 'ansi-bright-yellow',
  '94': 'ansi-bright-blue',
  '95': 'ansi-bright-magenta',
  '96': 'ansi-bright-cyan',
  '97': 'ansi-bright-white',
  '40': 'ansi-bg-black',
  '41': 'ansi-bg-red',
  '42': 'ansi-bg-green',
  '43': 'ansi-bg-yellow',
  '44': 'ansi-bg-blue',
  '45': 'ansi-bg-magenta',
  '46': 'ansi-bg-cyan',
  '47': 'ansi-bg-white',
};

export function parseAnsi(text) {
  const spans = [];
  let currentClasses = [];
  let lastIndex = 0;

  text.replace(ANSI_REGEX, (match, codes, offset) => {
    if (offset > lastIndex) {
      spans.push({
        text: text.slice(lastIndex, offset),
        className: currentClasses.join(' '),
      });
    }
    lastIndex = offset + match.length;
    const codeList = codes.split(';').filter(Boolean);
    for (const code of codeList) {
      if (code === '0' || code === '') {
        currentClasses = [];
      } else if (CODE_MAP[code]) {
        currentClasses.push(CODE_MAP[code]);
      }
    }
    return match;
  });
  if (lastIndex < text.length) {
    spans.push({
      text: text.slice(lastIndex),
      className: currentClasses.join(' '),
    });
  }

  return spans;
}
