'use strict';

function inRange(code, start, end) {
  return code >= start && code <= end;
}

function isLatinLetter(character) {
  const code = character.codePointAt(0);
  return inRange(code, 0x0041, 0x005A)
    || inRange(code, 0x0061, 0x007A)
    || inRange(code, 0x00C0, 0x02AF)
    || inRange(code, 0x1D00, 0x1EFF)
    || inRange(code, 0x2C60, 0x2C7F)
    || inRange(code, 0xA720, 0xA7FF)
    || inRange(code, 0xAB30, 0xAB6F)
    || inRange(code, 0xFF21, 0xFF3A)
    || inRange(code, 0xFF41, 0xFF5A);
}

function isLetter(character) {
  if (!character) return false;
  if (isLatinLetter(character)) return true;
  if (character.toLowerCase() !== character.toUpperCase()) return true;
  const code = character.codePointAt(0);
  return inRange(code, 0x0590, 0x08FF)
    || inRange(code, 0x0E00, 0x0E7F)
    || inRange(code, 0x3040, 0x30FF)
    || inRange(code, 0x3400, 0x9FFF)
    || inRange(code, 0xAC00, 0xD7AF)
    || inRange(code, 0x20000, 0x3134F);
}

function isNumber(character) {
  const code = character.codePointAt(0);
  return inRange(code, 0x0030, 0x0039)
    || inRange(code, 0x0660, 0x0669)
    || inRange(code, 0x06F0, 0x06F9)
    || inRange(code, 0x0966, 0x096F)
    || inRange(code, 0xFF10, 0xFF19);
}

function keepLettersAndNumbers(value) {
  return Array.from(String(value || ''))
    .filter(character => isLetter(character) || isNumber(character))
    .join('');
}

module.exports = { isLatinLetter, isLetter, isNumber, keepLettersAndNumbers };
